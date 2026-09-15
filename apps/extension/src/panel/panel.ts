/**
 * Side-panel entry point.
 *
 * This is where the inspected content actually lives. It is held in a local variable for the
 * lifetime of one inspection, replaced wholesale by the next, and gone when the panel closes.
 * Nothing is written to chrome.storage, and no detector registered here transmits anything.
 */

import { DetectorRegistry } from '@provenance/evidence';
import { synthIdReferenceDetector } from '@provenance/detector-synthid';
import { anthropicStatusDetector } from '@provenance/detector-anthropic-status';

import { EMPTY_SELECTION_MESSAGE, type InspectionRequest } from '../shared/messages.ts';
import { InspectionRunner, type InspectionState } from './inspection.ts';
import { renderMessage, renderState } from './render.ts';

const container = document.getElementById('content') as HTMLElement;
const footer = document.getElementById('interpretation') as HTMLElement;

const registry = new DetectorRegistry().register(
  synthIdReferenceDetector,
  anthropicStatusDetector,
);

const runner = new InspectionRunner(registry);
let latest: InspectionState | null = null;

function handleUpdate(state: InspectionState): void {
  if (!runner.isCurrent(state.inspectionId)) return;
  latest = state;
  renderState(container, footer, state, {
    onCopyJson: () => {
      if (!latest) return;
      void navigator.clipboard.writeText(JSON.stringify(latest.report, null, 2));
    },
  });
}

async function handleRequest(request: InspectionRequest): Promise<void> {
  if (request.problem === 'empty-selection') {
    latest = null;
    renderMessage(container, footer, 'Nothing selected', EMPTY_SELECTION_MESSAGE);
    return;
  }
  if (request.problem === 'extraction-failed') {
    latest = null;
    renderMessage(
      container,
      footer,
      'Could not read this page',
      'Chrome does not allow extensions to read its own pages or the Web Store. Try the same ' +
        'selection on an ordinary web page.',
    );
    return;
  }
  await runner.run(request, handleUpdate);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'inspection-request') {
    void handleRequest(message.request as InspectionRequest);
  }
  return undefined;
});

// The panel usually opens a moment after the click, so the first request is collected rather
// than received.
void chrome.runtime
  .sendMessage({ type: 'panel-ready' })
  .then((response: { pending: InspectionRequest | null } | undefined) => {
    if (response?.pending) void handleRequest(response.pending);
  })
  .catch(() => undefined);
