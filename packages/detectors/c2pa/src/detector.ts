/**
 * C2PA Content Credential verification for a page asset.
 *
 * The discipline this detector has to maintain is scope. A credential says something about
 * the bytes of one image; it says nothing whatsoever about the article the image sits in, the
 * caption beneath it, or the claims in the surrounding text. Every piece of evidence it emits
 * is therefore scoped to `asset`, and the reconciliation precedence keeps an asset-scoped
 * positive from becoming the headline when the selected text has its own evidence.
 *
 * The second discipline is the difference between "valid" and "trusted". A signature can
 * verify perfectly against a certificate nobody vouches for. The library reports these as
 * distinct states and so does this detector.
 */

import type { Detector, DetectorContext, Evidence, InspectionInput } from '@provenance/evidence';
import type { Manifest, Reader as ManifestStore } from '@contentauth/c2pa-types';

import { NoCredentialError, verifyAsset } from './sdk.ts';

export const DETECTOR_ID = 'c2pa-asset';
const DETECTOR_NAME = 'C2PA Content Credentials';
const DETECTOR_VERSION = '0.1.0';

const SCOPE_LIMITATION =
  'This claim covers the inspected image only. It does not extend to the page text, the ' +
  'caption, or any other asset on the page.';

const ALWAYS: string[] = [
  SCOPE_LIMITATION,
  'A Content Credential records what a signer asserted about an asset. It is evidence that ' +
    'the signer made those claims about these bytes, not that the claims are true.',
];

interface Summarized {
  issuer?: string;
  generator?: string;
  assertions: string[];
  title?: string;
  signedAt?: string;
}

function summarizeManifest(manifest: Manifest | undefined): Summarized {
  if (!manifest) return { assertions: [] };
  const signature = manifest.signature_info ?? undefined;
  const assertions = (manifest.assertions ?? [])
    .map((a) => a.label)
    .filter((label): label is string => typeof label === 'string');
  return {
    issuer: signature?.issuer ?? undefined,
    generator:
      manifest.claim_generator_info?.[0]?.name ?? (manifest.claim_generator as string | undefined),
    assertions,
    title: manifest.title ?? undefined,
    signedAt: signature?.time ?? undefined,
  };
}

/** Human-readable validation failure codes, kept short enough for a card. */
function failureCodes(store: ManifestStore): string[] {
  const legacy = (store.validation_status ?? []).map((s) => s.code).filter(Boolean) as string[];
  const results = store.validation_results?.activeManifest;
  const modern = [
    ...(results?.failure ?? []),
    ...(results?.informational ?? []),
  ]
    .map((s) => (s as { code?: string }).code)
    .filter((c): c is string => typeof c === 'string');
  return [...new Set([...legacy, ...modern])];
}

export const c2paDetector: Detector = {
  id: DETECTOR_ID,
  name: DETECTOR_NAME,
  version: DETECTOR_VERSION,
  evidenceKind: 'signature',
  remote: false,

  supports(input: InspectionInput): boolean {
    // Bytes, not a URL: this detector never fetches anything itself.
    return input.kind === 'image' && input.bytes !== undefined && input.bytes.byteLength > 0;
  },

  async detect(input: InspectionInput, context: DetectorContext): Promise<Evidence[]> {
    const base = {
      id: `${DETECTOR_ID}:${input.id}`,
      detector: { id: DETECTOR_ID, name: DETECTOR_NAME, version: DETECTOR_VERSION },
      kind: 'signature' as const,
      scope: 'asset' as const,
      observedAt: context.now(),
    };

    const format = input.mimeType ?? 'image/jpeg';

    let store: ManifestStore;
    try {
      store = await verifyAsset(format, input.bytes!);
    } catch (cause) {
      // An asset with no C2PA data at all is a real finding — "no credential" — not a
      // detector malfunction, so it is reported as a negative rather than an error card.
      // Anything else genuinely failed, and is rethrown for the registry to contain.
      if (!(cause instanceof NoCredentialError)) throw cause;
      const message = cause.detail;
      return [
        {
          ...base,
          result: 'negative',
          strength: 'descriptive',
          summary: 'No Content Credential was found in this image.',
          limitations: [
            'Most images on the web carry no Content Credential. Its absence says nothing ' +
              'about how the image was made.',
            'Credentials are commonly stripped by resizing, re-encoding, screenshotting, and ' +
              'by platforms that re-process uploads.',
            ...ALWAYS,
          ],
          details: { readerMessage: message },
          observedAt: context.now(),
        },
      ];
    }

    const activeLabel = store.active_manifest ?? undefined;
    const active = activeLabel ? store.manifests?.[activeLabel] : undefined;
    const summary = summarizeManifest(active);
    const state = store.validation_state ?? null;
    const codes = failureCodes(store);

    const details = {
      validationState: state,
      activeManifestLabel: activeLabel ?? null,
      manifestCount: Object.keys(store.manifests ?? {}).length,
      issuer: summary.issuer ?? null,
      claimGenerator: summary.generator ?? null,
      signedAt: summary.signedAt ?? null,
      assertions: summary.assertions,
      validationCodes: codes,
    };

    if (!activeLabel) {
      return [
        {
          ...base,
          result: 'negative',
          strength: 'descriptive',
          summary: 'No active Content Credential manifest was found in this image.',
          limitations: [
            'Absence of a credential is not evidence about how the image was made.',
            ...ALWAYS,
          ],
          details,
          observedAt: context.now(),
        },
      ];
    }

    // A credential is present but does not validate: the bytes no longer match what was
    // signed, or the signature itself is bad. This must never render as verified, and it is
    // materially different from finding nothing at all.
    if (state === 'Invalid') {
      return [
        {
          ...base,
          result: 'negative',
          strength: 'cryptographic',
          issuer: summary.issuer,
          claim: summary.title,
          summary:
            'A Content Credential is present but did not validate. The image does not match ' +
            'what was signed, or the signature is invalid.' +
            (codes.length ? ` Reported: ${codes.slice(0, 3).join(', ')}.` : ''),
          limitations: [
            'This is not a verified credential and must not be read as one.',
            'An invalid credential can mean tampering, but also benign re-encoding by a tool ' +
              'that did not preserve the manifest.',
            ...ALWAYS,
          ],
          details,
          observedAt: context.now(),
        },
      ];
    }

    const trusted = state === 'Trusted';
    const issuerPhrase = summary.issuer ? ` issued by ${summary.issuer}` : '';

    return [
      {
        ...base,
        result: 'positive',
        strength: 'cryptographic',
        issuer: summary.issuer,
        claim: summary.title,
        summary:
          `The image carries a cryptographically valid Content Credential${issuerPhrase}` +
          (summary.generator ? `, generated by ${summary.generator}` : '') +
          `. ${
            trusted
              ? 'The signing certificate chains to a configured trust anchor.'
              : 'The signing certificate was not checked against a trust list, so the signer ' +
                'is asserted rather than vouched for.'
          }`,
        limitations: [
          ...(trusted
            ? []
            : [
                'Validation state is "Valid", not "Trusted": the signature verifies, but no ' +
                  'trust list was consulted. Anyone can sign an asset with a certificate they ' +
                  'generated themselves.',
              ]),
          'A valid credential proves the asset matches what was signed. It does not establish ' +
            'that the depicted events occurred, or that the signer is who they claim to be.',
          ...ALWAYS,
        ],
        details,
        observedAt: context.now(),
      },
    ];
  },
};
