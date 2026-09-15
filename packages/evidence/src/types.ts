/**
 * The evidence vocabulary.
 *
 * These types are the contract between detectors, the aggregator, and the panel. They are
 * deliberately shaped so that a detector cannot express an authorship verdict: there is no
 * "isAiGenerated" field and no probability-of-authorship anywhere in the model. A detector
 * reports what it observed, how strong that observation is, and what it does not cover.
 */

export type ContentKind = 'text' | 'image' | 'audio' | 'video';

export interface InspectionInput {
  id: string;
  kind: ContentKind;
  text?: string;
  bytes?: ArrayBuffer;
  mimeType?: string;
  source: {
    pageUrl: string;
    pageTitle?: string;
    assetUrl?: string;
    extractionMethod: 'selection' | 'asset';
  };
  digest: {
    algorithm: 'SHA-256';
    value: string;
  };
}

export type EvidenceKind = 'watermark' | 'signature' | 'metadata' | 'heuristic';

export type EvidenceResult =
  | 'positive'
  | 'negative'
  | 'indeterminate'
  | 'unavailable'
  | 'error';

/**
 * How much weight the result can bear.
 *
 * `cryptographic` means a signature verified against a key. `statistical` means a score
 * compared against a null distribution. `descriptive` means self-asserted metadata that
 * nothing vouches for. The aggregator uses this to order the summary and the panel uses it
 * to style the card; neither is permitted to promote one to another.
 */
export type EvidenceStrength = 'cryptographic' | 'statistical' | 'descriptive';

/** What the claim actually covers. An image credential never silently covers page text. */
export type EvidenceScope = 'selected-content' | 'asset' | 'page';

export interface Evidence {
  id: string;
  detector: {
    id: string;
    name: string;
    version: string;
  };
  kind: EvidenceKind;
  result: EvidenceResult;
  strength: EvidenceStrength;
  scope: EvidenceScope;
  issuer?: string;
  claim?: string;
  score?: number;
  threshold?: number;
  sampleSize?: number;
  summary: string;
  /** Never empty in practice: a result with no stated limitations is a result overclaiming. */
  limitations: string[];
  details?: Record<string, unknown>;
  observedAt: string;
}

export type SummaryLabel =
  | 'verified-provenance'
  | 'watermark-evidence'
  | 'no-supported-signal'
  | 'indeterminate';

export interface InspectionReport {
  schemaVersion: '0.1';
  inspectionId: string;
  input: Omit<InspectionInput, 'bytes'>;
  evidence: Evidence[];
  summary: {
    strongestSignal?: Evidence['id'];
    label: SummaryLabel;
    text: string;
  };
  createdAt: string;
}

export interface DetectorContext {
  signal?: AbortSignal;
  now(): string;
}

export interface Detector {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly evidenceKind: EvidenceKind;
  /** True when this detector transmits content off-device. Declared before execution. */
  readonly remote?: boolean;

  /** Synchronous and side-effect free, by contract. */
  supports(input: InspectionInput): boolean;
  detect(input: InspectionInput, context: DetectorContext): Promise<Evidence[]>;
}
