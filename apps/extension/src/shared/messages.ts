/**
 * The one message contract between the service worker and the side panel.
 *
 * Content never passes through storage — only through these runtime messages, held in memory
 * on both ends. The service worker keeps at most one pending request so that a panel opening
 * a moment after the click can collect it; a new inspection replaces it outright.
 */

export interface InspectionRequest {
  /** Monotonic per-session id. The panel ignores results belonging to a superseded id. */
  inspectionId: string;
  kind: 'text' | 'image';
  text?: string;
  assetUrl?: string;
  /** Asset bytes as base64. Runtime messages are JSON, so bytes cannot travel as-is. */
  assetBase64?: string;
  assetMimeType?: string;
  pageUrl: string;
  pageTitle?: string;
  /** Why no content was captured, when that is the outcome. */
  problem?: 'empty-selection' | 'extraction-failed' | 'asset-fetch-failed';
  requestedAt: string;
}

export type PanelMessage =
  | { type: 'inspection-request'; request: InspectionRequest }
  | { type: 'panel-ready' };

export type BackgroundResponse = { pending: InspectionRequest | null };

export const EMPTY_SELECTION_MESSAGE =
  'Select a passage, then choose Inspect provenance again.';
