/**
 * SynthID-text detection, behind the Detector interface.
 *
 * This file is an adapter and nothing else: the scoring lives in ../vendor, ported from
 * google-deepmind/synthid-text and pinned to Python-generated vectors. Everything here is
 * about turning a score into an honest piece of evidence — which mostly means deciding when
 * NOT to answer, and attaching the limitations that keep a positive from reading as a
 * verdict about a person.
 */

import type { Detector, DetectorContext, Evidence, InspectionInput } from '@provenance/evidence';

import { scoreTokens } from '../vendor/watermark/score.ts';
import { binomialUpperTail, normalApproximation } from '../vendor/watermark/frequentist.ts';
import { depth } from '../vendor/watermark/params.ts';
import {
  ALPHA,
  CONFIGURATION_ID,
  DETECTOR_ID,
  DETECTOR_NAME,
  DETECTOR_VERSION,
  MIN_SCORED_POSITIONS,
  MODEL_ID,
  REFERENCE_COMMIT,
  TOKENIZER_ID,
  referenceConfiguration,
} from './config.ts';

/** Limitations attached to every result this detector produces, whatever the outcome. */
const ALWAYS: string[] = [
  'This is a controlled reference configuration using the demonstration keys published with ' +
    'google-deepmind/synthid-text. It does not detect any production Google, Gemini, or ' +
    'Anthropic deployment, whose keys are secret.',
  'Detection is keyed. Text watermarked under different keys, a different context width, or a ' +
    'different g-value construction scores as unmarked here.',
  'The scoring statistic is the mean g-value, not the learned Bayesian detector the reference ' +
    'implementation also ships. It is weaker, and reported as such.',
  `Tokenization is ${TOKENIZER_ID}. Text generated with a different tokenizer will not line up ` +
    'with this detector regardless of watermark configuration.',
];

/** What a negative specifically does not license anyone to conclude. */
const NEGATIVE_LIMITATIONS: string[] = [
  'A negative result does not establish human authorship.',
  'Paraphrasing, translation, summarization, heavy editing, and truncation all degrade or ' +
    'remove a watermark that was present at generation.',
];

/** The score a mean-g result must exceed for significance at ALPHA and this sample size. */
function scoreThresholdFor(gValueCount: number): number {
  // Normal approximation of the Binomial(n, 1/2) upper tail, on the mean-g scale. Used for
  // display only; the reported p-value is the exact tail.
  const z = 4.7534243088229; // one-sided normal quantile at 1e-6
  return 0.5 + z * Math.sqrt(0.25 / gValueCount);
}

export const synthIdReferenceDetector: Detector = {
  id: DETECTOR_ID,
  name: DETECTOR_NAME,
  version: DETECTOR_VERSION,
  evidenceKind: 'watermark',
  remote: false,

  supports(input: InspectionInput): boolean {
    return input.kind === 'text' && typeof input.text === 'string' && input.text.trim().length > 0;
  },

  async detect(input: InspectionInput, context: DetectorContext): Promise<Evidence[]> {
    const text = input.text ?? '';
    const { tokenizer, params, construction } = referenceConfiguration();

    const tokenIds = tokenizer.encode(text);
    const scored = scoreTokens(tokenIds, params, construction, tokenizer.eosTokenId);

    const base = {
      id: `${DETECTOR_ID}:${input.id}`,
      detector: { id: DETECTOR_ID, name: DETECTOR_NAME, version: DETECTOR_VERSION },
      kind: 'watermark' as const,
      strength: 'statistical' as const,
      scope: 'selected-content' as const,
      observedAt: context.now(),
    };

    const sharedDetails = {
      configurationId: CONFIGURATION_ID,
      referenceCommit: REFERENCE_COMMIT,
      constructionId: scored.constructionId,
      modelId: MODEL_ID,
      tokenizerId: TOKENIZER_ID,
      ngramLen: params.ngramLen,
      watermarkingDepth: depth(params),
      tokenCount: scored.tokenCount,
      candidatePositions: scored.candidatePositions,
      scoredPositions: scored.scoredPositions,
      maskedRepeatedContext: scored.maskedRepeatedContext,
      maskedAfterEos: scored.maskedAfterEos,
      minimumScoredPositions: MIN_SCORED_POSITIONS,
      alpha: ALPHA,
    };

    // Too little to say anything with. This is the branch the product exists to get right:
    // a short passage yields `indeterminate`, never a negative dressed up as reassurance.
    if (scored.score === null || scored.scoredPositions < MIN_SCORED_POSITIONS) {
      return [
        {
          ...base,
          result: 'indeterminate',
          sampleSize: scored.scoredPositions,
          summary:
            `Not enough content to test. ${scored.scoredPositions} scorable positions were ` +
            `available; this detector requires at least ${MIN_SCORED_POSITIONS} ` +
            `(roughly ${Math.ceil(MIN_SCORED_POSITIONS * 0.75)} words of English prose).`,
          limitations: [
            'Short selections cannot distinguish a weak watermark from chance. This is not a ' +
              'negative result.',
            ...ALWAYS,
          ],
          details: sharedDetails,
        },
      ];
    }

    const gValueCount = scored.scoredPositions * scored.depth;
    const tail = binomialUpperTail(scored.gSum, gValueCount);
    const normal = normalApproximation(scored.score, scored.scoredPositions, scored.depth);
    const threshold = scoreThresholdFor(gValueCount);

    const details = {
      ...sharedDetails,
      gSum: scored.gSum,
      gValueCount,
      meanGValue: scored.score,
      pValue: tail.pValue,
      log10PValue: tail.log10PValue,
      nullExpectedMean: 0.5,
      z: normal?.z ?? null,
      standardError: normal?.standardError ?? null,
    };

    if (tail.pValue < ALPHA) {
      return [
        {
          ...base,
          result: 'positive',
          score: scored.score,
          threshold,
          sampleSize: scored.scoredPositions,
          claim: `Watermark consistent with configuration ${CONFIGURATION_ID}`,
          summary:
            `Mean g-value ${scored.score.toFixed(4)} over ${scored.scoredPositions} scored ` +
            `positions at depth ${scored.depth}, against a null expectation of 0.5 ` +
            `(p < 1e-6; log10 p = ${tail.log10PValue.toFixed(1)}).`,
          limitations: [
            'This is evidence of generation under a compatible watermark configuration. It is ' +
              'not proof of authorship, and says nothing about who prompted, edited, or ' +
              'published the text.',
            'A watermark survives some editing. A positive result does not mean the text is ' +
              'unedited or wholly machine-written.',
            ...ALWAYS,
          ],
          details,
        },
      ];
    }

    return [
      {
        ...base,
        result: 'negative',
        score: scored.score,
        threshold,
        sampleSize: scored.scoredPositions,
        summary:
          `Mean g-value ${scored.score.toFixed(4)} over ${scored.scoredPositions} scored ` +
          `positions is consistent with unmarked text under this configuration ` +
          `(p = ${tail.pValue.toExponential(2)}).`,
        limitations: [...NEGATIVE_LIMITATIONS, ...ALWAYS],
        details,
      },
    ];
  },
};
