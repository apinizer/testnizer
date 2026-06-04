---
title: JWT Debugger
description: Decode, encode, verify, and inspect JSON Web Tokens entirely offline — no website, no network call.
order: 1
section: Tools
---

The JWT Debugger is the "I need to look at — or generate — this token right
now" tool. Open **Tools → JWT Debugger** and choose between two tabs:

- **JWT Decoder** — paste a token and inspect it
- **JWT Encoder** — build and sign a token from scratch

A **Generate example** dropdown at the top right produces a working sample
for any algorithm (HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512,
EdDSA). For asymmetric algorithms it generates a fresh keypair, signs a
sample token, and prefills the Verify / Sign fields — useful for
experimenting without hunting for keys.

## Decoder

Testnizer splits the token on the two `.` delimiters and decodes each part
immediately:

### Header

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "2024-01-key"
}
```

`alg` and `kid` are highlighted — these are the fields that control how
verification works.

### Payload

Two display modes available — toggle with the JSON / Table buttons in the
section header.

JSON mode pretty-prints the payload with syntax highlighting. Table mode
shows one row per claim with three columns:

- **Claim** — the key name
- **Value** — the raw value; numeric date claims (`iat`, `exp`, `nbf`,
  `auth_time`) are followed by their ISO 8601 rendering
- **Description** — built-in description for standard registered claims
  (RFC 7519 §4.1) and common public claims (`name`, `email`, `scope`,
  `roles`, etc.) — useful when you don't remember what `azp` or `cty`
  means

| Claim | Display |
|---|---|
| `exp` | Unix timestamp + ISO 8601 + **expired** badge if in the past |
| `iat` | Unix timestamp + ISO 8601 |
| `nbf` | Unix timestamp + ISO 8601 + **not yet valid** badge if in the future |
| `sub` | String, value shown as-is |
| `iss` | String, value shown as-is |
| `aud` | String or array, all values shown |

A **Valid JWT** badge confirms the structure parsed successfully. Expired
or not-yet-valid tokens get extra coloured badges next to it.

### Signature

The raw signature bytes are shown in Base64URL encoding. If verification is
enabled (see below), a ✓ or ✗ badge appears here with the failure reason on
mismatch (algorithm mismatch, wrong key, malformed header, etc.).

## Signature verification

Paste or select a key in the **Verify** panel on the right:

### HMAC (HS256 / HS384 / HS512)

Paste the base64-encoded or plain-text shared secret. Testnizer computes the
HMAC and compares it with the signature in the token.

### RSA (RS256 / RS384 / RS512 / PS256 / PS384 / PS512)

Paste the RSA public key in any of these formats:

- `-----BEGIN PUBLIC KEY-----` (PKCS#8 / SubjectPublicKeyInfo)
- `-----BEGIN RSA PUBLIC KEY-----` (PKCS#1)
- JSON Web Key (`{"kty":"RSA","n":"...","e":"..."}`)

### ECDSA (ES256 / ES384 / ES512)

Paste the EC public key:

- `-----BEGIN PUBLIC KEY-----`
- JSON Web Key (`{"kty":"EC","crv":"P-256","x":"...","y":"..."}`)

### EdDSA (Ed25519)

Paste the Ed25519 public key in PEM or JWK format.

### JWKS endpoint

If the token's `kid` header is present and you want to fetch the key from the
issuer's JWKS endpoint, enable **Allow JWKS fetch** in **Settings → JWT**
(off by default). With it on, you can paste a JWKS URL and Testnizer will:

1. Fetch the JWKS over HTTPS
2. Match the `kid` from the token header
3. Verify the signature with the matched key

This is the only network call the JWT debugger can make, and only when you
explicitly turn it on. The setting is per-project, not global.

## Why not jwt.io?

[jwt.io](https://jwt.io) is convenient, but it sends your token to a remote
service to parse and display. For a production auth token that means:

- Your user ID, roles, and entitlements are in Postman's (or jwt.io's) logs
- The `sub` claim can often be reverse-mapped to an account
- If the token contains a session-level secret in a custom claim, it's gone

Testnizer's debugger runs entirely in the main process. The token string goes
from your clipboard into an in-process parser and back to the renderer for
display. No HTTP request is made.

## Reading tokens from variables

If you're building or receiving a token in a request, you can read it into
the JWT debugger without copy-pasting. In the token input area, click
**From variable** and pick the environment variable that holds the token
(e.g. `{{accessToken}}`). Testnizer resolves the variable and parses it.

This is useful when a login request returns a token that you've stored with
`pm.environment.set('accessToken', ...)` — just switch to the JWT tool and
inspect the current token without leaving the app.

## Encoder

The **JWT Encoder** tab builds and signs a token from scratch. It mirrors
the Decoder but in reverse:

- **Header** — JSON editor pre-populated with `{ "alg": "HS256", "typ": "JWT" }`.
  Changing the algorithm dropdown automatically syncs the `alg` field.
- **Payload** — JSON editor with the claims you want to embed
- **Sign JWT** — choose an algorithm and provide either a shared secret
  (HS\*) or a PEM-encoded private key (RS / PS / ES / EdDSA)
- **Encoded JWT** — output pane with three-color highlighting (header,
  payload, signature) and a copy button

Click **Sign & Encode** to produce a token. The Encoder produces standards-
compliant JWTs (RFC 7519) signed with the algorithm you choose.

For asymmetric algorithms, the **Generate example** dropdown gives you a
shortcut: it generates a fresh PKCS#8 private key + matching SPKI public
key, signs a sample payload, and pre-fills both. You can then copy the
signed token into the Decoder tab, paste the public key in the Verify
panel, and round-trip the verification — handy for quickly checking a
client / server signature pair.

### Programmatic token generation in scripts

For generating test tokens during a request flow, use the `crypto` module
in a pre-request script:

```js
// Pre-request script — sign a JWT with HS256
const crypto = require('crypto')
const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const payload = Buffer.from(JSON.stringify({
  sub:  pm.environment.get('userId'),
  iat:  Math.floor(Date.now() / 1000),
  exp:  Math.floor(Date.now() / 1000) + 3600,
})).toString('base64url')
const secret  = pm.environment.get('signingSecret')
const sig     = crypto.createHmac('sha256', secret)
                      .update(`${header}.${payload}`)
                      .digest('base64url')
pm.environment.set('testToken', `${header}.${payload}.${sig}`)
```

The resulting `{{testToken}}` variable can then be used in request headers
and inspected in the JWT debugger using **From variable**.
