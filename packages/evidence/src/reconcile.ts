/**
 * Turning several detectors' findings into one summary line without averaging them.
 *
 * The rule the whole design hangs on: a negative from one detector never cancels a positive
 * from another, because they test different schemes. An unwatermarked-looking text carrying
 * a valid signature is not a contradiction to be resolved — it is two true statements about
 * two different things, and both stay visible in the card list. Precedence here only chooses
 * which sentence leads.
 */

import type { Evidence, InspectionReport, SummaryLabel } from './types.ts';
import { GLOBAL_INTERPRETATION_NOTE, SUMMARY_TEXT, verifiedCredentialText } from './language.ts';

const isPositive = (e: Evidence) => e.result === 'positive';
const coversContent = (e: Evidence) => e.scope === 'selected-content';

/**
 * Precedence for the summary only, straight from the brief:
 *   1. cryptographically verified positive scoped to the inspected content
 *   2. known watermark positive scoped to the inspected content
 *   3. verified positive scoped only to an associated asset
 *   4. no positive evidence, with one or more completed detectors
 *   5. all applicable detectors indeterminate, unavailable, or errored
 */
export function selectSummary(evidence: readonly Evidence[]): {
  label: SummaryLabel;
  strongestSignal?: string;
  text: string;
} {
  const cryptoOnContent = evidence.find(
    (e) => isPositive(e) && coversContent(e) && e.strength === 'cryptographic',
  );
  if (cryptoOnContent) {
    return {
      label: 'verified-provenance',
      strongestSignal: cryptoOnContent.id,
      text: verifiedCredentialText(cryptoOnContent.issuer),
    };
  }

  const watermarkOnContent = evidence.find(
    (e) => isPositive(e) && coversContent(e) && e.kind === 'watermark',
  );
  if (watermarkOnContent) {
    return {
      label: 'watermark-evidence',
      strongestSignal: watermarkOnContent.id,
      text: SUMMARY_TEXT['watermark-evidence'].body,
    };
  }

  const verifiedAsset = evidence.find(
    (e) => isPositive(e) && e.scope === 'asset' && e.strength === 'cryptographic',
  );
  if (verifiedAsset) {
    return {
      label: 'verified-provenance',
      strongestSignal: verifiedAsset.id,
      text: verifiedCredentialText(verifiedAsset.issuer),
    };
  }

  // A detector that reached a conclusion is one that ran to completion with a real answer.
  // `unavailable` and `error` are not conclusions, and neither is `indeterminate`.
  const concluded = evidence.some((e) => e.result === 'negative' || e.result === 'positive');
  if (concluded) {
    return { label: 'no-supported-signal', text: SUMMARY_TEXT['no-supported-signal'].body };
  }

  return { label: 'indeterminate', text: SUMMARY_TEXT.indeterminate.body };
}

export function summaryHeading(label: SummaryLabel): string {
  return SUMMARY_TEXT[label].heading;
}

export { GLOBAL_INTERPRETATION_NOTE };

export function buildReport(
  inspectionId: string,
  input: InspectionReport['input'],
  evidence: Evidence[],
  createdAt: string,
): InspectionReport {
  return {
    schemaVersion: '0.1',
    inspectionId,
    input,
    evidence,
    summary: selectSummary(evidence),
    createdAt,
  };
}
