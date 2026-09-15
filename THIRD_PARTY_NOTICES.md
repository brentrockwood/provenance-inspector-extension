# Third-party notices

## crypto-lab-token-tell — MIT

`packages/detectors/synthid-reference/vendor/` is copied from
<https://github.com/systemslibrarian/crypto-lab-token-tell> (Copyright (c) 2026 Paul Clark),
used under the MIT License. The full licence text is at
`packages/detectors/synthid-reference/vendor/LICENSE.upstream`. See that directory's
`README.md` for what was copied and why.

That project is itself a port of the construction published in
<https://github.com/google-deepmind/synthid-text> (Apache-2.0), at commit `addb4a1`, and
carries pinned test vectors and generation records produced with it.

## SynthID-text

The watermarking scheme is described in Dathathri et al., "Scalable watermarking for
identifying large language model outputs", *Nature* 634 (2024). The watermarking keys used in
this build are the `DEFAULT_WATERMARKING_CONFIG` demonstration keys published in the reference
repository. They are public, and this build makes no claim to detect any deployment that uses
private keys.

## c2pa-js — MIT

Content Credential verification uses the `c2pa` package from
<https://github.com/contentauth/c2pa-js>, maintained by the Content Authenticity Initiative.
