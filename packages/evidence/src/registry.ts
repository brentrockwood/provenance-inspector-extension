/**
 * The detector registry: applicability, concurrent dispatch, and failure containment.
 *
 * Two rules do most of the work here. A detector that throws produces `error` evidence
 * rather than taking the inspection down with it, because one broken plugin must not be able
 * to hide another's valid result. And a detector that declines to run produces nothing at
 * all — "not applicable" is silence, not a negative, since a text detector saying "negative"
 * about a JPEG would be a false reassurance.
 */

import type { Detector, DetectorContext, Evidence, InspectionInput } from './types.ts';

export class DetectorRegistry {
  private readonly detectors: Detector[] = [];

  register(...detectors: Detector[]): this {
    for (const d of detectors) {
      if (this.detectors.some((existing) => existing.id === d.id)) {
        throw new Error(`Duplicate detector id: ${d.id}`);
      }
      this.detectors.push(d);
    }
    return this;
  }

  all(): readonly Detector[] {
    return this.detectors;
  }

  applicable(input: InspectionInput): Detector[] {
    return this.detectors.filter((d) => {
      try {
        return d.supports(input);
      } catch {
        // supports() is specified as side-effect free and total. One that throws is a broken
        // detector, and a broken detector is excluded rather than allowed to abort dispatch.
        return false;
      }
    });
  }

  /**
   * Run every applicable detector concurrently, emitting each detector's evidence as it
   * arrives so the panel can render progressively.
   */
  async run(
    input: InspectionInput,
    context: DetectorContext,
    onEvidence?: (evidence: Evidence[], detector: Detector) => void,
  ): Promise<Evidence[]> {
    const detectors = this.applicable(input);
    const collected: Evidence[] = [];

    await Promise.all(
      detectors.map(async (detector) => {
        let evidence: Evidence[];
        try {
          evidence = await detector.detect(input, context);
        } catch (cause) {
          evidence = [errorEvidence(detector, context, cause)];
        }
        collected.push(...evidence);
        onEvidence?.(evidence, detector);
      }),
    );

    return collected;
  }
}

/** A thrown detector failure, rendered as evidence instead of as an exception. */
export function errorEvidence(
  detector: Detector,
  context: DetectorContext,
  cause: unknown,
): Evidence {
  const message = cause instanceof Error ? cause.message : String(cause);
  return {
    id: `${detector.id}:error`,
    detector: { id: detector.id, name: detector.name, version: detector.version },
    kind: detector.evidenceKind,
    result: 'error',
    strength: 'descriptive',
    scope: 'selected-content',
    summary: `${detector.name} failed to run: ${message}`,
    limitations: [
      'This detector did not complete, so it contributes no evidence either way.',
      'A failed detector is not a negative result.',
    ],
    details: { error: message },
    observedAt: context.now(),
  };
}

export function defaultContext(signal?: AbortSignal): DetectorContext {
  return { signal, now: () => new Date().toISOString() };
}
