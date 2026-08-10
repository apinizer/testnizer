---
title: SAML 2.0
description: Build, sign with XML-DSig, and validate SAML assertions and responses offline — with a validator that proves which element was actually signed.
order: 4
section: Tools
---

**Tools → SAML** builds SAML 2.0 messages, signs them, and validates what comes
back. All of it offline.

## Build

Two shapes:

- **AuthnRequest** — what a service provider sends to an identity provider.
- **Response / Assertion** — what comes back, which is what you usually need to
  fake while the real IdP is not ready yet.

You set the issuer, destination, subject, audience, the validity window
(`NotBefore` / `NotOnOrAfter`, with skew), and any attributes. The window is
checked as you build it — a `NotOnOrAfter` that lands before `NotBefore`
produces an assertion that can never be valid, so it is refused rather than
generated.

## Sign

XML-DSig, with the key from either a PEM you paste or an entry in a
**[keystore](/docs/keystore-studio)**. When a keystore entry is selected the PEM
fields are disabled, so it is never ambiguous which key is signing.

You choose the digest and signature algorithms and the canonicalisation method,
and whether the signature goes on the assertion, the response, or both.

## Validate

This is the part that most tools skip, and it is the reason this one exists.

Validation does not stop at "there is a `<Signature>` element and it verifies".
It reports **which element the signature actually covers**, and refuses the
document when that is not what it claims to be:

- **Signature wrapping** — a document with a valid signature over a *different*
  element than the one being consumed is rejected, and the report names both.
- **Algorithm confusion** — an HMAC algorithm where an asymmetric one is
  required is refused rather than verified against the public key.
- **SHA-1** — refused, with the reason.
- **XXE** — external entities are not resolved.
- **Expired or not-yet-valid** — the bearer condition window is evaluated,
  including clock skew, and reported as a cause rather than a generic failure.

Every rejection states its cause. A validator that only says "invalid" moves
the work to you.

## Bindings

The **Binding** tab produces the encoded form for the transport you are using:

- **HTTP-Redirect** — deflate + base64 + URL encoding, as the binding requires.
- **HTTP-POST** — base64 only.

The encoding follows the binding you picked; a setting that does not apply to
the selected binding is not quietly left switched on underneath.

## Freshness

Change the XML, the certificate or the key source and the previous verdict
disappears. A green "Valid" left on screen next to a document you have since
edited is a wrong security answer, and a wrong security answer is worse than no
answer — so the verdict is cleared the moment its input changes.

## What leaves the machine

Nothing. Building, signing and validating all run in the app's process.
