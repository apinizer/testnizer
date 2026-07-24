---
title: "Testnizer Security & Crypto Suite — Big-Picture Plan"
status: "Planning. Faz 0 (Keystore Studio crypto core) in flight; this plan sequences everything on top."
issues: ["#59 Keystore Studio", "#60 Key Material Provider", "#61 JWK", "#62 Website", "#63 JOSE/JWT", "#64 TLS inspector", "#65 SAML"]
primary_specs:
  - docs/design/keystore-studio-design.md
  - /Users/mhy/IdeaProjects/apinizer/KEYSTORE-STUDIO-TESTNIZER-PORT.md
---

# Testnizer Security & Crypto Suite — Big-Picture Plan

> **The differentiator.** No other API test client ships a built-in, **offline**, enterprise-grade security & crypto toolkit. Testnizer already has WSS-Security, mTLS, OAuth2, JWT (decode), HMAC/Hash, OTP, and secure at-rest storage. Keystore Studio (#59) adds first-class PKI. This plan turns that collection into **one coherent system**: a central **Key Material Provider** that every security operation draws from via a shared selection dialog. That is the "all-in-one test client" story, and the sharp edge no competitor can easily copy.

---

## 1. The shape: producers → provider → consumers

```
   PRODUCERS                      HUB (#60)                        CONSUMERS
 ┌────────────────┐        ┌────────────────────────┐        ┌──────────────────────────┐
 │ #59 Keystore    │───────▶│  Key Material Provider  │───────▶│ WSS-Security             │
 │    Studio       │        │  • shared resolver      │        │   sign / encrypt /       │
 │    (Model B      │        │    (PEM/DER/Buffer/JWK) │        │   decrypt / validate     │
 │    encrypted lib)│        │  • reusable selection   │───────▶│ mTLS / client-cert       │
 │ #61 JWK          │───────▶│    dialog               │        │   (Send + Runner)        │
 │ #64 TLS inspector│──┐     │  • main-process only    │───────▶│ #63 JOSE / JWT           │
 └────────────────┘  │     │    (no secret to render)│        │   sign / verify / JWS/JWE│
                     │     └────────────────────────┘───────▶│ #65 SAML (XML-DSig)      │
   (view a live cert, add it as trusted) ──────────────┘        └──────────────────────────┘
                                    #62 website: sell this differentiator
```

**One rule that makes the whole thing cohere:** key material is resolved and used **only in the main process**. The renderer selects *which* material (a keystore alias id, a library row id) via the selection dialog and never receives a private key or password. This is the OTP/secure-storage discipline generalized to every consumer.

---

## 2. The Key Material Provider (#60) — the hub

### 2.1 The resolver (generalizes design-doc §5 "Model C")

`src/main/lib/keystore-bridge.ts` (a.k.a. the key-material resolver). One function, four output shapes, so we never build a second bridge:

```ts
type MaterialSource =
  | { kind: 'keystore'; keystoreId: string; alias: string }   // Model B library row (#59)
  | { kind: 'certRow'; certificateId: string }                 // existing certificates table
  | { kind: 'file'; path: string }                             // ad-hoc file (rails: readCertFile)
  | { kind: 'inline'; pem: string; keyPem?: string }           // pasted PEM

type MaterialNeed = 'pem' | 'buffer' | 'jwk' | 'keyObject'

resolveKeyMaterial(source, need): {
  certPem: string; keyPem?: string; chainPem?: string[];
  certDer?: Buffer; keyDer?: Buffer;              // need = 'buffer'
  jwk?: JsonWebKey; publicJwk?: JsonWebKey;       // need = 'jwk'  (via jose)
  keyObject?: KeyObject;                          // need = 'keyObject' (node:crypto)
  passphrase?: string;
}
```

- **mTLS** wants Buffers → `Buffer.from(certPem)` / `Buffer.from(keyPem)` onto `https.Agent` (`http.engine.ts:1128-1140`).
- **WSSE / SAML** want **PEM strings** → `SignConfig.privateKeyPem` / `certPem` (`wsse.engine.ts:87-93`, xml-crypto).
- **JOSE / JWT / JWK** want a **JWK or Node KeyObject** → `jose` `importPKCS8`/`importX509` (already a dep).

Prefer Node `crypto` (`X509Certificate`, `createPrivateKey`) for PKCS12→PEM to avoid dragging an ESM-only dep into the externalized main bundle. **Re-impose the `readCertFile` safety rails** (symlink-resolve, extension whitelist, size cap) that keystore-backed rows bypass (design-doc R12).

### 2.2 The selection dialog (reusable renderer primitive)

One `<KeyMaterialPicker>` component reused by every consumer's config UI:

```
[ From keystore library ▾ ]  → pick keystore → pick alias
[ From certificate store ▾ ] → pick cert row
[ From file ]                → native picker
[ Paste PEM ]                → textarea
```

Returns an opaque `MaterialSource` (ids/paths only — never key bytes) that the consumer stores in its config and the **main-process** resolver dereferences at execution time. This single component is the visible payoff of the whole suite: "use my key here" everywhere.

### 2.3 Schema (extend `certificates`, add nothing renderer-visible)

Per design-doc §5.1: `ALTER TABLE certificates ADD source TEXT DEFAULT 'file'` (`'file'|'keystore'`), `keystore_id TEXT`, `keystore_alias TEXT`; **mirror in `tests/main/handlers/helpers.ts` SCHEMA_SQL in the same commit** (CLAUDE.md gotcha). Store password on the future `keystores` row (#59 Model B), per-alias key password on the cert row, both `encryptSecret`-encrypted (**resolve R11/Q4 first**).

---

## 3. Per-issue design sketch

### #59 Keystore Studio — the primary producer (in flight)
Main-process engine + Model B encrypted library (add/delete/list). Authoritative design: `docs/design/keystore-studio-design.md`. Faz 0 (crypto core + interop gate) running now.

### #60 Key Material Provider — §2 above
Files: `src/main/lib/keystore-bridge.ts` (resolver), `src/renderer/components/shared/KeyMaterialPicker.tsx`, ALTER migration + helpers mirror. Wires: mTLS (`request.handler.ts#loadCertificatesFor:139-164` branch on `source==='keystore'`), **Runner** (`runner.handler.ts:847,1390` — route through the shared resolver, closing the pre-existing no-client-cert gap → **documented behavior change**, R5), WSSE (`WsSignConfig` in `types/index.ts:373` gains a `{keystoreId,alias}`/`{certificateId}` alternative, resolved in main at `soap.engine.ts:786`).

### #61 JWK — producer + consumer feed
Files: `src/renderer/lib/tools/jwk.ts` (PEM↔JWK via `jose`), `JwkTool.tsx`, optional JWKS-set builder + mock-endpoint serve (reuse mock server). Consumes the provider for "alias → JWK". Feeds #63.

### #63 JOSE/JWT full — extend the existing decode-only tool
`jwt.ts` is decode-only today (`decodeJwt`, `isExpired`, no sign/verify). Add (crypto in **main**, key via provider `need:'keyObject'`): JWT **sign** (HS/RS/PS/ES families), **verify** (+claim checks), **JWS** compact/detached, **JWE** encrypt/decrypt. New handler `src/main/ipc/jose.handler.ts` + engine; renderer JWT tool gains sign/verify tabs. `jose` already a dep.

### #64 TLS/SSL inspector — near-standalone, schedule opportunistically
`src/main/ipc/tls-inspect.handler.ts` (`tls.connect` → presented chain, TLS version, negotiated cipher, cert fields, expiry coloring, chain/hostname validation, HSTS). Renderer `TlsInspectorTool.tsx`. Low dependency (only the "add viewed cert as trusted" link touches #59) → **can be built in parallel with Keystore Studio as an early quick win**.

### #65 SAML — reuse the xml-crypto/WSSE infra
`src/main/ipc/saml.handler.ts` + `saml.engine.ts` (SAML 2.0 Assertion/Response build; XML-DSig enveloped sign via provider PEM; verify against signing cert; SAMLRequest/Response base64+deflate encode/decode). Reuses `xml-crypto`/`xml-encryption` (already deps; `wsse.engine.ts` precedent). Key material via provider `need:'pem'`.

### #62 Website — after features ship (no vaporware)
`website/`: "Security & Crypto" section + comparison-table rows. Publish **synced to feature ship**, not before.

---

## 4. Unified phased roadmap

| Faz | Scope | Issue | Depends on | Gate |
|---|---|---|---|---|
| **0** (running) | Keystore engine core + JKS writer + multi-alias PKCS12 + Model B schema/repo + **real keytool/openssl interop** | #59 | — | interop green (else Option A pivot) |
| **1** | Keystore Studio read-only UI + Model B **library CRUD UI** (add/delete/list) | #59 | Faz 0 | open/inspect/library round-trip; no-leak tests |
| **2** | Generate (key pair + self-signed cert; AES secret) | #59 | Faz 1 | keytool opens generated cert |
| **3** | Import (PKCS12/PKCS8/OpenSSL/PEM/trusted) + key-cert match | #59 | Faz 1 | negative mismatch test |
| **4** | Edit / Export (DER/PEM/PKCS7/PkiPath) / Convert (JKS⇄PKCS12) / Save | #59 | Faz 1–3 | convert round-trip interop → **Keystore Studio feature-complete** |
| **5** | **Key Material Provider**: resolver + `<KeyMaterialPicker>`; wire **mTLS (Send+Runner)** + **WSSE** | #60 | Faz 4 | mTLS works on Send≡Run; WSSE signs from a keystore alias |
| **6** | **JWK** (#61) + **JOSE/JWT full** (#63): sign/verify/JWS/JWE via provider | #61,#63 | Faz 5 | sign→verify round-trip; JWKS verify |
| **7** | **SAML** (#65): build/sign/validate | #65 | Faz 5 | assertion sign→validate; external-tool interop |
| **∥** | **TLS/SSL inspector** (#64) — independent; slot as an early quick win, parallel to Faz 1–4 | #64 | — | live endpoint chain + validation |
| **web** | Website differentiator section | #62 | Faz 4+ | synced to ship |

**Critical path:** Faz 0 → 1 → 4 (Keystore Studio) → 5 (Provider) → then 6/7 fan out. #64 is off the critical path (do it whenever convenient). #62 trails.

---

## 5. Security model (invariant across all consumers)

1. **Main-process only.** Resolver + all crypto in main; renderer holds ids/paths, never key bytes or passwords. DevTools/XSS/extension surface stays clean.
2. **Encrypted at rest.** Keystore blobs + store passwords `encryptSecret` (`safeStorage`, `enc:v1:`) — the OTP/certificate precedent. "Remember password" **opt-in, default OFF** (enterprise posture).
3. **Fail loud.** An unresolvable alias fails the request/sign **loudly** (existing `{error}` contract), never silently unauthenticated.
4. **Rails everywhere.** The resolver re-imposes `readCertFile`'s symlink/extension/size checks for keystore-backed rows (R12).
5. **No leak in logs.** No private key / password / keystore bytes in any log or error, including stack traces (design-doc §10).
6. **Double-password model.** Store password vs per-alias key password modeled explicitly (R11/Q4) before Faz 5.

---

## 6. Open decisions (carry into the design workflow)

- **Runner cert-attach behavior change (R5):** routing Runner through the resolver switches on file-based client certs for existing Runner runs. Ship as a documented, opt-in-for-one-release change? (Faz 5.)
- **secp256k1 / Ed25519 (revived by JOSE/SAML):** cut for Keystore Studio (halil D2), but JOSE commonly uses EdDSA. Add when Faz 6 needs it (`@noble/curves` / `jose`), engine message already exists.
- **JWKS serving:** does #61 mock a live `.well-known/jwks.json` via the existing mock server, or export a static set only?
- **Double-password schema (Q4):** store-pw on `keystores` row vs both on cert row — lock before Faz 5.
- **Faz-0 outcome:** if the pure-TS JKS writer fails keytool, the Option A (native binary) pivot changes packaging (not this architecture). Reconcile after Faz 0 lands.

---

## 7. Test strategy (per layer)

- **Provider resolver:** unit — each `MaterialSource` × each `MaterialNeed` yields correct PEM/Buffer/JWK/KeyObject; rails reject oversized/untrusted; no-leak assertion on every return.
- **mTLS:** Send **and** Runner attach a keystore-backed client cert (Send≡Run parity); interop against a local TLS server requiring client auth.
- **WSSE/SAML:** sign with a keystore alias → validate the signature externally (xmlsec1 / openssl) — real interop, not self-round-trip.
- **JOSE:** sign → verify round-trip across HS/RS/PS/ES; JWE encrypt→decrypt; verify against a JWKS.
- **TLS inspector:** known-cert endpoint chain assertions; expired/self-signed/hostname-mismatch detection.
- **Security spine (all):** no handler response ever contains a private key or password; renderer never receives key bytes.

---

## 8. What happens when Faz 0 lands

1. I run the gate (typecheck/test/build/smoke) and report the real interop result (Option C confirmed vs Option A pivot).
2. Reconcile §4 Faz-0 row + §6 last bullet with the outcome.
3. Optionally deepen this plan into per-consumer detailed test cases via a design workflow (the earlier Keystore Studio pattern) — but this plan is already implementation-orienting on its own.
