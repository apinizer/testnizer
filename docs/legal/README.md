# Testnizer — Legal Documents

**Status:** FINAL — pending counsel review
**Last harmonized:** 2026-05-07

This directory contains the **authoritative legal text** for the Testnizer
application. These documents are surfaced to the end-user through the
in-application consent gate (`<EulaConsentGate>`) on first launch and
again whenever either document changes.

## Files

- `eula.md` — End-User License Agreement, governing the **binary
  distribution** of the Software. The source code is governed separately by
  the MIT License in the repository root (`LICENSE`).
- `privacy-policy.md` — How Testnizer handles data: it does not collect any
  by default, with a small number of well-defined opt-in or user-initiated
  exceptions (auto-update, optional Sentry telemetry, AI Chat).

## Source of truth

**`docs/legal/eula.md` and `docs/legal/privacy-policy.md` are the
authoritative legal text.** The website at
`https://www.testnizer.com/license/` MUST mirror the contents of these two
documents verbatim (or with a faithful translation when a Turkish version
is added). Any change to either document requires a corresponding update
to the website. The website should also expose `/privacy/` as a separate
page mirroring `privacy-policy.md`.

## Consent-gate behavior

The Software computes a SHA-256 hash of each document at build time and
stores the hash the user accepted. When either document changes:

1. The new build ships with new hashes.
2. On next launch, the consent gate detects the mismatch and re-prompts
   the user to accept the updated text.
3. If the user declines, the application exits.

This means: **any edit to either document — even a typo fix — invalidates
the previous consent and forces a re-prompt.** Coordinate edits with
release planning so users are not re-prompted unnecessarily.

## Counsel review

Although these documents are written to be internally consistent, factually
accurate, and reflect actual application behavior, they have not yet been
reviewed by qualified legal counsel. Before publishing to the website or
shipping a new version that materially relies on them, the user should
have these documents reviewed by counsel familiar with:

- Republic of Türkiye law (the chosen governing jurisdiction)
- EU GDPR (for European users)
- US consumer-protection law (for US distribution)
- Export-control law (Türkiye, EU, US)

## Where these are surfaced in-app

- First-launch consent gate (`<EulaConsentGate>`)
- About modal — links to both documents
- Settings → Legal — full-text viewer
