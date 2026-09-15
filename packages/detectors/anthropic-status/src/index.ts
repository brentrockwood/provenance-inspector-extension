/**
 * A capability that is registered but not operational.
 *
 * This detector exists so the panel can be honest about the shape of the gap. Anthropic's
 * text watermark detector is a private preview; this build has no access to it, no key, and
 * no endpoint. The temptation in a demo is to leave such a provider out entirely, which
 * quietly implies the tool covered everything it could — or worse, to stub a plausible
 * result. It does neither: it names the provider, states that authorized access is what is
 * missing, and produces no finding.
 */

import type { Detector, DetectorContext, Evidence, InspectionInput } from '@provenance/evidence';
import { UNAVAILABLE_BODY } from '@provenance/evidence';

export const DETECTOR_ID = 'anthropic-text-watermark';
const DETECTOR_NAME = 'Anthropic text watermark';
const DETECTOR_VERSION = '0.0.0-unavailable';

export const anthropicStatusDetector: Detector = {
  id: DETECTOR_ID,
  name: DETECTOR_NAME,
  version: DETECTOR_VERSION,
  evidenceKind: 'watermark',
  remote: false,

  supports(input: InspectionInput): boolean {
    // Applicable in principle to any text, which is exactly why its absence is worth stating.
    return input.kind === 'text';
  },

  async detect(input: InspectionInput, context: DetectorContext): Promise<Evidence[]> {
    return [
      {
        id: `${DETECTOR_ID}:${input.id}`,
        detector: { id: DETECTOR_ID, name: DETECTOR_NAME, version: DETECTOR_VERSION },
        kind: 'watermark',
        result: 'unavailable',
        strength: 'descriptive',
        scope: 'selected-content',
        summary: 'Unavailable: authorized detector access required.',
        limitations: [
          UNAVAILABLE_BODY,
          'No request was made and no content was transmitted. This entry records a gap in ' +
            'coverage, not a finding.',
          'Because this detector did not run, text watermarked by this provider would not be ' +
            'detected by any other detector in this build either.',
        ],
        details: { reason: 'private-preview', transmitted: false },
        observedAt: context.now(),
      },
    ];
  },
};
