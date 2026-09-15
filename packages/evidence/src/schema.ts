/**
 * Report validation.
 *
 * Hand-written rather than pulled from a JSON Schema library: the extension ships this code
 * to the browser, the shape is small, and the acceptance criterion is only that exported
 * JSON validates against the documented model. Keeping it dependency-free also means the
 * validator runs in the service worker without a bundling exception.
 */

import type { Evidence, InspectionReport } from './types.ts';

const EVIDENCE_KINDS = ['watermark', 'signature', 'metadata', 'heuristic'];
const RESULTS = ['positive', 'negative', 'indeterminate', 'unavailable', 'error'];
const STRENGTHS = ['cryptographic', 'statistical', 'descriptive'];
const SCOPES = ['selected-content', 'asset', 'page'];
const LABELS = [
  'verified-provenance',
  'watermark-evidence',
  'no-supported-signal',
  'indeterminate',
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function checkEvidence(e: Evidence, index: number, errors: string[]): void {
  const at = `evidence[${index}]`;
  if (typeof e.id !== 'string' || !e.id) errors.push(`${at}.id must be a non-empty string`);
  if (!e.detector || typeof e.detector.id !== 'string') errors.push(`${at}.detector.id missing`);
  if (!e.detector || typeof e.detector.version !== 'string') {
    errors.push(`${at}.detector.version missing`);
  }
  if (!EVIDENCE_KINDS.includes(e.kind)) errors.push(`${at}.kind invalid: ${e.kind}`);
  if (!RESULTS.includes(e.result)) errors.push(`${at}.result invalid: ${e.result}`);
  if (!STRENGTHS.includes(e.strength)) errors.push(`${at}.strength invalid: ${e.strength}`);
  if (!SCOPES.includes(e.scope)) errors.push(`${at}.scope invalid: ${e.scope}`);
  if (typeof e.summary !== 'string' || !e.summary) errors.push(`${at}.summary must be non-empty`);
  if (!Array.isArray(e.limitations)) errors.push(`${at}.limitations must be an array`);
  if (typeof e.observedAt !== 'string') errors.push(`${at}.observedAt must be an ISO string`);
  if (e.score !== undefined && typeof e.score !== 'number') errors.push(`${at}.score must be a number`);
}

export function validateReport(report: unknown): ValidationResult {
  const errors: string[] = [];
  const r = report as InspectionReport;

  if (!r || typeof r !== 'object') return { valid: false, errors: ['report must be an object'] };
  if (r.schemaVersion !== '0.1') errors.push(`schemaVersion must be "0.1"`);
  if (typeof r.inspectionId !== 'string' || !r.inspectionId) errors.push('inspectionId missing');
  if (typeof r.createdAt !== 'string') errors.push('createdAt must be an ISO string');

  if (!r.input || typeof r.input !== 'object') {
    errors.push('input missing');
  } else {
    if (typeof r.input.id !== 'string') errors.push('input.id missing');
    if (!['text', 'image', 'audio', 'video'].includes(r.input.kind)) errors.push('input.kind invalid');
    if (!r.input.digest || r.input.digest.algorithm !== 'SHA-256') {
      errors.push('input.digest.algorithm must be SHA-256');
    } else if (!/^[0-9a-f]{64}$/.test(r.input.digest.value)) {
      errors.push('input.digest.value must be 64 lowercase hex characters');
    }
    if (!r.input.source || typeof r.input.source.pageUrl !== 'string') {
      errors.push('input.source.pageUrl missing');
    }
    if ((r.input as { bytes?: unknown }).bytes !== undefined) {
      errors.push('input.bytes must not be present in an exported report');
    }
  }

  if (!Array.isArray(r.evidence)) {
    errors.push('evidence must be an array');
  } else {
    r.evidence.forEach((e, i) => checkEvidence(e, i, errors));
  }

  if (!r.summary || typeof r.summary !== 'object') {
    errors.push('summary missing');
  } else {
    if (!LABELS.includes(r.summary.label)) errors.push(`summary.label invalid: ${r.summary.label}`);
    if (typeof r.summary.text !== 'string' || !r.summary.text) errors.push('summary.text missing');
    if (
      r.summary.strongestSignal !== undefined &&
      Array.isArray(r.evidence) &&
      !r.evidence.some((e) => e.id === r.summary.strongestSignal)
    ) {
      errors.push('summary.strongestSignal does not name any evidence entry');
    }
  }

  return { valid: errors.length === 0, errors };
}
