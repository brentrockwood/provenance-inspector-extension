# Provenance Inspector

## Product brief

**Status:** Build-ready v0 specification  
**Target:** Working Chrome extension and proposal-quality screenshot in one day  
**Working name:** Provenance Inspector  
**Owner:** Rockwood Lab

## One-sentence description

A browser extension that inspects selected web content for verifiable provenance signals and reports the evidence it can establish—without pretending that absence of evidence proves human authorship.

## Why this exists

Most “AI detectors” collapse weak statistical inference into a confident authorship verdict. That is technically misleading and increasingly inadequate as generators adopt watermarking, signed credentials, and other machine-readable provenance mechanisms.

Provenance Inspector treats detection as an evidence problem:

1. Extract content from the page.
2. Run every applicable detector.
3. Preserve each detector’s evidence and limitations.
4. Present the results without converting them into an unsupported binary judgment.

The immediate product is a useful browser tool. The larger research artifact is a reference architecture for composing heterogeneous provenance claims.

## Product principles

1. **Evidence, not verdicts.** The product reports observable signals. It does not declare that content was “written by AI” or “written by a human.”
2. **Strong signals first.** Signed credentials and known watermark matches are visually and semantically distinct from heuristic classifications.
3. **Absence proves little.** A negative or indeterminate result must explain that short passages, edits, transformations, unsupported issuers, and older generators can remove or prevent detectable signals.
4. **Detectors are plugins.** Provider- and media-specific logic lives behind a small stable interface.
5. **Local by default.** Content stays in the browser unless a detector explicitly requires a remote service and the user opts into it.
6. **No fake integrations.** A provider detector is labeled operational only when we possess the necessary implementation, configuration, key, or authorized API access.
7. **Reproducible evidence.** Results include detector version, input digest, timestamp, and relevant parameters so a test can be repeated.

## Target user

The v0 user is a technically literate reader, researcher, journalist, investigator, or security practitioner who encounters suspicious or consequential content on the web and wants to know what provenance evidence is actually available.

## The v0

The extension supports one primary action:

> Select text on a web page → right-click → **Inspect provenance**

It opens a compact side panel containing:

- a neutral summary of the evidence;
- one card per detector;
- the inspected character and word counts;
- an input SHA-256 digest;
- limitations and interpretation guidance;
- an option to copy the evidence report as JSON.

### Required detectors

#### 1. Controlled SynthID-text detector

Implement a real local detector using an available open implementation and a known watermark configuration. Use it against fixtures generated with that same configuration.

This proves the detector pipeline end to end. It does **not** claim universal Gemini, Google, or Claude detection. The UI must identify it as a controlled/reference configuration unless a deployment-specific configuration is legitimately available.

Expected outcomes:

- positive for a sufficiently long watermarked fixture generated with the matching configuration;
- negative or indeterminate for an unwatermarked fixture;
- indeterminate when the selection is below the detector’s minimum useful length.

#### 2. C2PA page-asset inspector

Inspect the page’s selected or associated image, when present, for a C2PA Content Credential using a maintained verification library. Report whether a credential exists, whether its signature validates, the claimed issuer/generator, and a compact list of assertions.

C2PA evidence applies to the inspected asset, not automatically to neighboring page text. The UI must preserve that scope.

#### 3. Capability/status detectors

Register non-operational provider integrations—such as Anthropic’s private-preview text watermark detector—as unavailable capabilities. Show them only in the detailed detector list, clearly labeled **Unavailable: authorized detector access required**. Do not simulate results.

### Explicitly excluded from v0

- generic AI-writing classifiers;
- an “AI probability” percentage;
- accounts, authentication, subscriptions, billing, or telemetry;
- databases or retained browsing history;
- whole-site crawling;
- automatic scanning of every page;
- Firefox or Safari support;
- a backend, unless an unavoidable detector runtime cannot execute locally;
- polished onboarding or marketing pages;
- production claims about proprietary provider watermarks;
- automated enforcement, blocking, moderation, or content hiding.

## User experience

### Happy path

1. The user selects a sufficiently long passage.
2. The user chooses **Inspect provenance** from the context menu.
3. The extension captures the selected text, page URL, page title, and any explicitly associated media reference.
4. Applicable detectors run concurrently.
5. The side panel renders completed cards as results arrive.
6. The summary describes the strongest evidence without overstating it.
7. The user can copy a machine-readable report.

### Empty selection

If no text is selected, the extension should explain:

> Select a passage, then choose Inspect provenance again.

Do not silently inspect the entire page in v0.

### Short selection

If a watermark detector cannot draw a useful conclusion from the selected length, return `indeterminate` with its required or recommended minimum. Do not return a negative.

## Result language

The following language is normative.

### Strong positive

> **Watermark signal detected**  
> The selected text matches the configured SynthID-text detector with a statistically significant score. This is evidence of generation using a compatible watermark configuration; it is not proof of authorship or of an unedited generation history.

### Verified signed asset

> **Valid Content Credential**  
> The inspected image contains a cryptographically valid C2PA credential issued by {issuer}. This claim applies to the image asset, not automatically to surrounding text.

### No supported signal

> **No supported provenance signal detected**  
> This result does not establish human authorship. The content may be unwatermarked, too short, edited, transformed, generated by an unsupported system, or created before marking was enabled.

### Indeterminate

> **Not enough evidence**  
> This detector could not produce a meaningful result for the available content.

### Unavailable integration

> **Detector unavailable**  
> This provider requires authorized detector access or deployment-specific configuration that is not present in this build.

## Evidence model

```ts
type ContentKind = "text" | "image" | "audio" | "video";

interface InspectionInput {
  id: string;
  kind: ContentKind;
  text?: string;
  bytes?: ArrayBuffer;
  mimeType?: string;
  source: {
    pageUrl: string;
    pageTitle?: string;
    assetUrl?: string;
    extractionMethod: "selection" | "asset";
  };
  digest: {
    algorithm: "SHA-256";
    value: string;
  };
}

type EvidenceKind =
  | "watermark"
  | "signature"
  | "metadata"
  | "heuristic";

type EvidenceResult =
  | "positive"
  | "negative"
  | "indeterminate"
  | "unavailable"
  | "error";

interface Evidence {
  id: string;
  detector: {
    id: string;
    name: string;
    version: string;
  };
  kind: EvidenceKind;
  result: EvidenceResult;
  strength: "cryptographic" | "statistical" | "descriptive";
  scope: "selected-content" | "asset" | "page";
  issuer?: string;
  claim?: string;
  score?: number;
  threshold?: number;
  sampleSize?: number;
  summary: string;
  limitations: string[];
  details?: Record<string, unknown>;
  observedAt: string;
}

interface InspectionReport {
  schemaVersion: "0.1";
  inspectionId: string;
  input: Omit<InspectionInput, "bytes">;
  evidence: Evidence[];
  summary: {
    strongestSignal?: Evidence["id"];
    label:
      | "verified-provenance"
      | "watermark-evidence"
      | "no-supported-signal"
      | "indeterminate";
    text: string;
  };
  createdAt: string;
}
```

## Detector interface

```ts
interface DetectorContext {
  signal?: AbortSignal;
  now(): string;
}

interface Detector {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly evidenceKind: EvidenceKind;

  supports(input: InspectionInput): boolean;
  detect(
    input: InspectionInput,
    context: DetectorContext,
  ): Promise<Evidence[]>;
}
```

Detector rules:

- A detector never mutates the input.
- `supports()` is synchronous and side-effect free.
- Expected lack of evidence is a result, not an exception.
- Runtime failure returns `error` evidence and does not fail the inspection.
- Each detector owns its minimum sample requirements and documents them in the result.
- Remote detectors declare that fact in their metadata before execution.
- Detector IDs and versions are stable and included in exported reports.

## Evidence reconciliation

The aggregator does not average incompatible scores.

Use this precedence for the summary only:

1. cryptographically verified positive scoped to the inspected content;
2. known watermark positive scoped to the inspected content;
3. verified positive scoped only to an associated asset;
4. no positive evidence, with one or more completed detectors;
5. all applicable detectors indeterminate, unavailable, or errored.

Conflicting results remain visible. A negative result from one detector never cancels a positive result from another because the detectors may test different schemes.

## Architecture

### Chrome extension components

- **Manifest V3 service worker:** creates the context-menu action, coordinates inspections, and stores only transient results.
- **Content script:** extracts the current selection and basic page context.
- **Side panel:** renders progressive results and exports the report.
- **Detector registry:** discovers applicable detector modules and runs them concurrently.
- **Shared evidence package:** types, validation, reconciliation, digesting, and deterministic test fixtures.

Suggested repository layout:

```text
provenance-inspector/
├── apps/
│   └── extension/
│       ├── manifest.json
│       └── src/
│           ├── background/
│           ├── content/
│           └── panel/
├── packages/
│   ├── evidence/
│   └── detectors/
│       ├── synthid-reference/
│       ├── c2pa/
│       └── anthropic-status/
├── fixtures/
│   ├── text/
│   └── images/
└── README.md
```

### Privacy boundary

The extension requests the minimum Chrome permissions necessary for the selected-text flow. It does not request browsing-history access. Inspection content is held in memory and discarded when the side panel closes or a new inspection begins. Export occurs only on explicit user action.

If a future remote detector is enabled, the panel must show the destination provider and require explicit consent before transmitting content.

## Build sequence

### Phase 1 — vertical slice

- Scaffold a TypeScript Chrome Manifest V3 extension.
- Add the context-menu action.
- Extract selected text.
- Open a side panel.
- Run a deterministic fixture detector through the real registry.
- Render an evidence card and export JSON.

### Phase 2 — real reference watermark

- Integrate the controlled SynthID-text implementation.
- Add matching watermarked and unwatermarked fixtures.
- Record score, threshold, sample size, configuration identifier, and implementation version.
- Confirm that insufficient samples return `indeterminate`.

### Phase 3 — C2PA

- Add image-asset inspection using a maintained verifier.
- Include one valid signed fixture, one unsigned fixture, and one tampered fixture.
- Keep image claims scoped to the asset.

### Phase 4 — proposal polish

- Add unavailable-provider capability cards.
- Tighten language and visual hierarchy.
- Capture the screenshot from a controlled fixture page.
- Write a short README containing installation, demo, limitations, and architecture.

## Acceptance criteria

The v0 is complete when all of the following are true:

- The unpacked extension installs in current Chrome without errors.
- Selecting text and choosing **Inspect provenance** opens the side panel.
- The panel displays the exact inspected word and character counts.
- The input SHA-256 digest is computed locally and exported.
- At least one real controlled watermarked fixture produces a positive result.
- An unwatermarked fixture does not produce a false positive at the configured threshold.
- A too-short fixture produces `indeterminate`, not `negative`.
- A detector failure does not prevent other detector results from rendering.
- A valid C2PA fixture verifies and names its claimed issuer when available.
- A tampered or invalid credential is not rendered as verified.
- Every result names the detector and version.
- The exported JSON validates against the evidence schema.
- No selected content leaves the browser during the demo.
- The UI never displays an unsupported “AI-generated” verdict or probability.
- The screenshot can be reproduced from checked-in fixtures and documented steps.

## Tests

### Unit tests

- detector applicability;
- reconciliation precedence;
- conflicting evidence preservation;
- minimum-length behavior;
- digest determinism;
- schema validation;
- provider-unavailable behavior;
- safe error conversion.

### Integration tests

- selected text reaches the detector unchanged;
- results arrive progressively and remain associated with the correct inspection;
- a superseded inspection cancels or ignores late results;
- report export matches visible evidence;
- panel state is cleared between inspections.

### Fixture matrix

| Fixture | Expected result |
| --- | --- |
| Long text, matching controlled watermark config | Watermark `positive` |
| Long text, no watermark | Watermark `negative` or documented `indeterminate` |
| Short text | Watermark `indeterminate` |
| Valid signed C2PA image | Signature `positive`, cryptographic |
| Unsigned image | Signature `negative` |
| Credential-bearing image modified after signing | Signature invalid/error, never verified |
| Anthropic detector without access | `unavailable` |

## Screenshot specification

Use a normal-looking fixture article page, not a developer console. Select roughly 800–1,500 words of controlled watermarked text. The side panel should show:

> **Provenance evidence**  
> **Watermark signal detected**  
> SynthID Text — controlled reference configuration  
> Strong statistical signal · 1,126 words inspected  
>  
> **C2PA**  
> No associated signed asset inspected  
>  
> Evidence is not equivalent to authorship. Editing and transformation may alter detectable signals.

The screenshot must include a small **Reference configuration** label so it cannot be mistaken for detection of a proprietary production deployment.

## After v0

Only after the reference implementation works:

- authorized Anthropic detector integration;
- deployment-specific SynthID configurations;
- additional text, image, audio, and video detectors;
- W3C Verifiable Credentials or other signed claim formats;
- evidence bundles suitable for research datasets;
- transformation-chain experiments: copying, summarization, translation, paraphrasing, OCR, screenshots, and mixed-source documents;
- conflict and propagation semantics across composed content;
- an ACS adapter or policy hook that consumes provenance evidence without granting it authority it does not possess.

## Open research questions

- How should provenance claims survive composition when a page contains material from several origins?
- What scope should a claim retain after summarization, quotation, translation, or formatting?
- How should a consumer combine cryptographic, watermark, metadata, and heuristic evidence without false precision?
- How can a trusted component avoid laundering an untrusted claim while transforming content?
- What is the smallest interoperable evidence vocabulary that preserves issuer, scope, transformation history, uncertainty, and detector provenance?
- Which user-interface language helps non-specialists distinguish “no signal” from “evidence of absence”?

These questions connect the browser artifact to the broader provenance and agent-security proposal without making the v0 depend on solving them.

## Definition of success today

By the end of the build session we have:

1. an installable extension;
2. a controlled fixture page;
3. one honest positive watermark result;
4. one verified or correctly rejected C2PA fixture;
5. exported evidence JSON;
6. automated tests for the core semantics;
7. a proposal-quality screenshot; and
8. a public or shareable repository with limitations stated plainly.
