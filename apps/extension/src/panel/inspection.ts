/**
 * Running an inspection, independent of the DOM.
 *
 * Split out from the rendering so the ordering guarantees can be tested without a browser.
 * The one that matters: a second inspection supersedes the first, and any result that arrives
 * late from the superseded run is discarded rather than merged into the visible report. A
 * panel that mixed two inspections' evidence would be attributing one page's findings to
 * another's content, which is the worst failure this product could have.
 */

import {
  DetectorRegistry,
  buildReport,
  countContent,
  defaultContext,
  digestText,
  type ContentCounts,
  type Evidence,
  type InspectionInput,
  type InspectionReport,
} from '@provenance/evidence';

import type { InspectionRequest } from '../shared/messages.ts';

export interface InspectionState {
  inspectionId: string;
  input: InspectionInput;
  counts: ContentCounts;
  evidence: Evidence[];
  pendingDetectors: number;
  report: InspectionReport;
}

export function buildInput(request: InspectionRequest): InspectionInput {
  const text = request.text ?? '';
  return {
    id: request.inspectionId,
    kind: request.kind,
    text: request.kind === 'text' ? text : undefined,
    source: {
      pageUrl: request.pageUrl,
      pageTitle: request.pageTitle,
      assetUrl: request.assetUrl,
      extractionMethod: request.kind === 'image' ? 'asset' : 'selection',
    },
    digest: digestText(text),
  };
}

/** The input as it appears in an exported report: never carrying raw bytes. */
export function exportableInput(input: InspectionInput): InspectionReport['input'] {
  const { bytes: _bytes, ...rest } = input;
  return rest;
}

export class InspectionRunner {
  private currentId: string | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly registry: DetectorRegistry) {}

  /** True while this id is the inspection the panel is showing. */
  isCurrent(inspectionId: string): boolean {
    return this.currentId === inspectionId;
  }

  async run(
    request: InspectionRequest,
    onUpdate: (state: InspectionState) => void,
  ): Promise<InspectionState | null> {
    // Supersede whatever was running. Detectors that honour the signal stop; those that do
    // not are ignored on arrival by the isCurrent() guard below.
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    this.currentId = request.inspectionId;

    const input = buildInput(request);
    const counts = countContent(request.text ?? '');
    const context = defaultContext(abort.signal);
    const applicable = this.registry.applicable(input);

    const state: InspectionState = {
      inspectionId: request.inspectionId,
      input,
      counts,
      evidence: [],
      pendingDetectors: applicable.length,
      report: buildReport(request.inspectionId, exportableInput(input), [], context.now()),
    };
    onUpdate(state);

    await this.registry.run(input, context, (evidence) => {
      if (!this.isCurrent(request.inspectionId)) return;
      state.evidence.push(...evidence);
      state.pendingDetectors = Math.max(0, state.pendingDetectors - 1);
      // Detector order is arrival order, so the strongest evidence is chosen by precedence
      // rather than by whoever happened to finish first.
      state.report = buildReport(
        request.inspectionId,
        exportableInput(input),
        sortEvidence(state.evidence),
        context.now(),
      );
      onUpdate(state);
    });

    if (!this.isCurrent(request.inspectionId)) return null;

    state.pendingDetectors = 0;
    state.report = buildReport(
      request.inspectionId,
      exportableInput(input),
      sortEvidence(state.evidence),
      context.now(),
    );
    onUpdate(state);
    return state;
  }
}

const RESULT_ORDER: Record<Evidence['result'], number> = {
  positive: 0,
  negative: 1,
  indeterminate: 2,
  error: 3,
  unavailable: 4,
};

const STRENGTH_ORDER: Record<Evidence['strength'], number> = {
  cryptographic: 0,
  statistical: 1,
  descriptive: 2,
};

/**
 * Display order for the card list: strongest evidence first, unavailable capabilities last.
 *
 * This is presentation only. It never changes a result, and the summary is still chosen by
 * the reconciliation precedence rather than by this ordering.
 */
export function sortEvidence(evidence: readonly Evidence[]): Evidence[] {
  return [...evidence].sort((a, b) => {
    const byResult = RESULT_ORDER[a.result] - RESULT_ORDER[b.result];
    if (byResult !== 0) return byResult;
    return STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength];
  });
}
