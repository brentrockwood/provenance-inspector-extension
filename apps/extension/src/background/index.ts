/**
 * Service worker: context menu, selection capture, and handoff to the panel.
 *
 * It deliberately does no detection. Detectors run in the side panel because that is where
 * the inspected content is displayed and where it dies when the panel closes — and because
 * C2PA verification needs WebAssembly and a worker, neither of which an MV3 service worker
 * can host. Keeping the coordinator thin also keeps the privacy claim simple: this file
 * holds one pending request in memory and writes nothing to storage.
 */

import type { InspectionRequest } from '../shared/messages.ts';

const MENU_ID = 'inspect-provenance';

let pending: InspectionRequest | null = null;
let counter = 0;

function nextInspectionId(): string {
  counter += 1;
  return `insp-${Date.now().toString(36)}-${counter}`;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Inspect provenance',
      contexts: ['selection', 'image'],
    });
  });
});

/**
 * Pull the live selection out of the page.
 *
 * `info.selectionText` from the context menu is truncated by Chrome at around 1KB, far short
 * of the passage lengths a watermark detector needs — so the real selection is read from the
 * page itself. This runs under `activeTab`, granted only for the tab the user just acted in
 * and only because they invoked the menu; the extension holds no host permissions and cannot
 * read any page it was not invited into.
 */
function readSelection(): { text: string; title: string; url: string } {
  const selection = globalThis.getSelection?.();
  return {
    text: selection ? selection.toString() : '',
    title: document.title,
    url: location.href,
  };
}

/**
 * Read the image bytes from inside the page.
 *
 * Fetching the asset from the panel instead would need host permissions for every site the
 * user might inspect — a permanent, broad grant for an occasional action. Fetching it in the
 * page's own context under `activeTab` keeps the extension's standing access at nothing, and
 * usually hits the browser cache rather than the network. The cost is that a cross-origin
 * image the page itself cannot re-fetch is not inspectable, which is reported rather than
 * worked around.
 */
async function readAsset(srcUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const response = await fetch(srcUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { base64, mimeType: blob.type || 'image/jpeg' };
  } catch {
    return null;
  }
}

async function captureAsset(
  tabId: number,
  srcUrl: string,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readAsset,
      args: [srcUrl],
    });
    return (result?.result as { base64: string; mimeType: string } | null) ?? null;
  } catch {
    return null;
  }
}

async function captureSelection(
  tabId: number,
): Promise<{ text: string; title: string; url: string } | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readSelection,
    });
    return (result?.result as { text: string; title: string; url: string } | undefined) ?? null;
  } catch {
    // Chrome refuses injection on its own pages and on the Web Store. That is a capture
    // failure, reported as such, and not the same thing as an empty selection.
    return null;
  }
}

function publish(request: InspectionRequest): void {
  pending = request;
  // The panel may not be listening yet; it collects `pending` on startup instead.
  void chrome.runtime.sendMessage({ type: 'inspection-request', request }).catch(() => undefined);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  // Opening the panel has to happen while the user gesture is still live.
  await chrome.sidePanel.open({ tabId: tab.id });

  const inspectionId = nextInspectionId();
  const requestedAt = new Date().toISOString();
  const pageUrl = info.pageUrl ?? tab.url ?? '';

  if (info.mediaType === 'image' && info.srcUrl && !info.selectionText) {
    const asset = await captureAsset(tab.id, info.srcUrl);
    publish({
      inspectionId,
      kind: 'image',
      assetUrl: info.srcUrl,
      assetBase64: asset?.base64,
      assetMimeType: asset?.mimeType,
      pageUrl,
      pageTitle: tab.title,
      problem: asset ? undefined : 'asset-fetch-failed',
      requestedAt,
    });
    return;
  }

  const captured = await captureSelection(tab.id);

  if (captured === null) {
    publish({
      inspectionId,
      kind: 'text',
      pageUrl,
      pageTitle: tab.title,
      problem: 'extraction-failed',
      requestedAt,
    });
    return;
  }

  if (captured.text.trim().length === 0) {
    publish({
      inspectionId,
      kind: 'text',
      pageUrl: captured.url || pageUrl,
      pageTitle: captured.title || tab.title,
      problem: 'empty-selection',
      requestedAt,
    });
    return;
  }

  publish({
    inspectionId,
    kind: 'text',
    text: captured.text,
    assetUrl: info.mediaType === 'image' ? info.srcUrl : undefined,
    pageUrl: captured.url || pageUrl,
    pageTitle: captured.title || tab.title,
    requestedAt,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'panel-ready') {
    sendResponse({ pending });
    // Handed over. The worker keeps no copy of the inspected content.
    pending = null;
    return true;
  }
  return undefined;
});
