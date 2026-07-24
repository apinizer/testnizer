---
title: Consumers — Grounding Reconcile Notes
status: authoritative correction layer
applies_before: implementation phases (Faz C-WSSE, Faz F-TLS, Faz D1-JWK, Faz E-SAML)
corrects: docs/design/security-suite-consumers-design.md
issues: ["#60 (WSSE provider wiring)", "#61 (JWK / JWKS-serve)", "#64 (TLS Inspector)", "#65 (SAML)"]
generated: 2026-07-23
---

# Consumers — Grounding Reconcile Notes

This document is the **authoritative correction layer** that each implementation
phase must apply **before writing code**. It reconciles the claims in
[`security-suite-consumers-design.md`](./security-suite-consumers-design.md)
against the **real code** and records, per phase:

1. **Verified points** — integration points confirmed against source (with line
   citations).
2. **Corrections** — a *design-said → code-reality → fix* table for every place
   the design over-reached, cited the wrong shape, or missed a junction.
3. **Additive-invariant regression surface** — the existing paste/file input
   paths that **must keep working**; each needs a regression test so a new
   "Use from keystore / Security" option is strictly *additive*, never a
   replacement.

> Why this exists: prior GROUND agents failed to reconcile the #64 (TLS) and #65
> (SAML) sections, and the WSSE/JWK sections carried completeness gaps. The
> line citations in the design are *mostly accurate*; the failures are about
> **architecture completeness** (duplicated type trees, missed second wiring
> junctions, non-existent primitives) and **API shape** (wrong return types,
> merge-vs-replace semantics, ESM/CJS reality). Treat the fixes below as
> overriding the design wherever they conflict.

---

## Global additive invariant

Every phase adds a keystore/Security **material source** as **one more option**.
The invariant across all four phases:

- **Inline PEM copy-paste must keep working, unchanged, as the default path.**
- **Direct CRT/KEY/PFX file selection must keep working where it already exists**
  (that is mTLS only — see Faz F; WSSE and SAML have **no** file/PFX path today).
- The new "Use from keystore / Security" branch is a `keySource?: MaterialSource`
  discriminated union arm; when absent, behavior is byte-for-byte the old path.
- **Fail loud** when neither a resolvable `keySource` nor pasted PEM is present.
- Each existing paste/file surface gets its **own** regression test — several are
  duplicated across two components/two stores and must each be pinned.

---

## Faz C — Provider WSSE wiring (#60)

Reconciles design **§2.5 EDIT 3** + **§3 WSSE** against
`soap.handler.ts`, `soap.engine.ts`, `wsse.engine.ts`, and the two renderer PEM
surfaces. Line citations in the design are essentially accurate; the corrections
are about **completeness** (two duplicated type trees, a second missed wiring
junction) and the **additive surface** (PEM-paste in two components/stores; no
file/PFX path exists in WSSE today).

### Verified integration points

| Claim | Location |
|---|---|
| `soap.handler.ts` passes `wsSecurity: payload.wsSecurity` straight into `executeSoap` (assignment at :73, options built :64-76, `executeSoap` called :78). Design's ":60-78" is off-by-two; `ipcMain.handle('soap:execute')` opens at :62. | `src/main/ipc/soap.handler.ts:62-78` |
| `soap.engine.ts` runs `migrateLegacyConfig` then `applyWsSecurity`, gated on `options.wsSecurity?.enabled`. | `src/main/protocols/soap.engine.ts:785-787` |
| `xml-crypto` consumes `SignConfig.privateKeyPem/certPem`. Engine `SignConfig` interface at :87-93; `SignedXml` fed `privateKey: config.privateKeyPem` at :363, `publicCert: config.certPem` at :364; cert base64 at :351. | `src/main/protocols/wsse.engine.ts:87-93, 351, 362-369` |
| Renderer `WsSignConfig` exists with required `privateKeyPem`/`certPem`. | `src/renderer/types/index.ts:373-379` |
| `migrateLegacyConfig` passes a modern (modes-bearing) config through untouched, so a `sign.keySource` added to a modern config survives; resolution at `soap.engine.ts:786` runs **after** migrate, so `keySource` is intact when resolved. | `src/main/protocols/wsse.engine.ts:597-599` |

### Corrections (design-said → code-reality → fix)

**C-1 — There are TWO duplicated type trees, not one.**
- **Design said:** EDIT 3 treats "extend `WsSignConfig` (types/index.ts:373) so
  `privateKeyPem`/`certPem` become optional and add `keySource?: MaterialSource`"
  as **one** type edit.
- **Code reality:** Two parallel, non-shared type trees. The renderer
  `WsSignConfig` (`types/index.ts:373`) is what the UI/store binds and is sent
  over IPC as opaque config. The **main engine** has its **own** `SignConfig`
  interface (`wsse.engine.ts:87-93`) — this is what `applySignature`/`SignedXml`
  actually reads (`privateKey` :363, `publicCert` :364). `applyWsSecurity` takes
  the engine's `WsSecurityConfig` (`wsse.engine.ts:103`), **not** the renderer
  type. `soap.engine.ts` even re-declares a **third** union
  `WsSecurityConfig = legacy | WsseConfig` (`soap.engine.ts:60-69`).
- **Fix:** Make `privateKeyPem`/`certPem` optional **and** add
  `keySource?: MaterialSource` in **both** places — renderer `WsSignConfig`
  (`types/index.ts:373-379`) for the UI/store, and engine `SignConfig`
  (`wsse.engine.ts:87-93`) for what the signer reads. Keep them structurally
  mirrored (they are hand-kept in sync today). The `soap.engine.ts:60-69` union
  already tolerates the extra field via its `WsseConfig` arm. Editing only the
  renderer type leaves the engine still requiring the two PEM strings.

**C-2 — A SECOND wiring junction the design missed (standalone tool).**
- **Design said:** EDIT 3 names exactly **one** resolution point: "Resolve it in
  main at `soap.engine.ts:786` (or in `soap.handler` before `executeSoap`)."
- **Code reality:** `applyWsSecurity` has a second, independent entrypoint:
  the standalone WS-Security tool. `WsSecurityTool.tsx` calls
  `window.api.wsse.apply` → ipc `'wsse:apply'` (`wsse.handler.ts:32-42`) →
  `applyWsSecurity(payload.envelope, payload.config)` directly, **bypassing
  `soap.engine` entirely**. This is the tab UI with the Certificate + Private
  Key PEM textareas — the exact additive-invariant surface. A `keySource`
  resolved only at `soap.engine.ts:786` works for a saved SOAP request, but the
  tool's Sign tab would **silently ignore** "Use from keystore".
- **Fix:** Resolve `keySource` at **both** junctions via a **shared helper**:
  (1) the SOAP-request path (`soap.engine.ts:786`, or `soap.handler` before :78),
  and (2) the standalone-tool path in `wsse.handler.ts:36` (`'wsse:apply'`)
  before calling `applyWsSecurity`. Same Send-vs-Tool parity class CLAUDE.md
  flags for runner-verdict / header-assertion / env-var — resolve once, call
  from both handlers.

**C-3 — WSSE additive invariant is PEM-paste ONLY.**
- **Design said:** ADDITIVE INVARIANT frames keeping *both* "PEM copy-paste"
  and "file selection (Client Certificate CRT/KEY/PFX)" working for WSSE.
- **Code reality:** WSSE has **no** file/PFX input path today — that belongs to
  mTLS (EDIT 1, `request.handler.ts loadCertificatesFor`). For WSSE the **only**
  existing key-input path is PEM-paste, living in **two** components backed by
  **two** stores:
  - (a) standalone tool `WsSecurityTool.tsx` — Sign `certPem` (:340) +
    `privateKeyPem` (:346), Verify `verifyCert` (:353-355), Encrypt
    `recipientCertPem` (:391-395), Decrypt `decryptKey` (:402-404) +
    `decryptPass` (:411), all backed by `useWsseToolStore`
    (`wsse-tool.store.ts`, persisted across tab switches per issue #19);
  - (b) SOAP request editor `SoapSecuritySection.tsx` — Sign `certPem`
    (:286-291) + `privateKeyPem` (:295-300), backed by the endpoint's persisted
    `wsSecurity` config.
- **Fix:** Scope the WSSE additive invariant to **PEM-paste only**; require a
  regression test for **each** of the two paste surfaces (see below). Drop the
  CRT/KEY/PFX file path from EDIT 3's regression scope — that is EDIT 1 (mTLS),
  not WSSE.

**C-4 — Resolve keySource in orchestration, keep `applyWsSecurity` pure.**
- **Design said:** Implies `keySource`-awareness can live at the engine boundary
  ("Resolve it in main at `soap.engine.ts:786`").
- **Code reality:** `applyWsSecurity`/`applySignature` is a deliberately **pure,
  IPC-free** engine (header comment `wsse.engine.ts:1-9`) shared verbatim by the
  tool path and the SOAP path — that sharing is its whole reason for existing.
  `applySignature` reads `config.sign.privateKeyPem/certPem` with **no guard**
  (:351 `pemToBase64`, :362-364 `SignedXml`).
- **Fix:** Resolve `keySource` in the **orchestration layer** — populate
  `SignConfig.privateKeyPem/certPem` **before** calling `applyWsSecurity`, in a
  shared helper invoked from `wsse.handler` (`'wsse:apply'`) and from
  `executeSoap`/`soap.handler` — **not** inside `applyWsSecurity`. Keep the
  engine pure so it doesn't drag a keystore bridge into the shared code and the
  tool/SOAP paths stay identical. Guard for `sign` being undefined and for the
  case where neither `keySource` nor pasted PEM is present (**fail loud**, per
  invariant).

### Additive-invariant regression surface (WSSE)

| Surface | Path | Backing store | Required regression test |
|---|---|---|---|
| Standalone tool — Sign tab Cert + Private Key PEM | `WsSecurityTool.tsx:337-347` | `wsse-tool.store.ts` | `wsse:apply` with pasted PEM still returns signed XML (anchor near `tests/main/wsse-engine.test.ts` + `tests/e2e/wsse/engine.spec.ts`) |
| Standalone tool — Verify cert PEM | `WsSecurityTool.tsx:353-355` (`verifyCert`) | `wsse-tool.store.ts` | verify with pasted cert unchanged |
| Standalone tool — Encrypt recipient cert PEM | `WsSecurityTool.tsx:391-395` | `wsse-tool.store.ts` | encrypt with pasted recipient cert unchanged |
| Standalone tool — Decrypt key PEM + passphrase | `WsSecurityTool.tsx:402-411` | `wsse-tool.store.ts` | decrypt with pasted key + pass unchanged |
| SOAP editor — Sign Cert + Private Key PEM | `SoapSecuritySection.tsx:286-300` | endpoint persisted `wsSecurity.sign` | `soap:execute` with pasted PEM still signs (anchor near `tests/main/soap-send-headers.test.ts` / `soap-envelope.test.ts`) |
| `wsse:apply` entrypoint accepting inline PEM | `wsse.handler.ts:32-42` | — | keeps accepting inline PEM config |
| SOAP entrypoint accepting inline PEM | `soap.handler.ts:62-78` → `soap.engine.ts:785-787` | — | keeps accepting inline `wsSecurity.sign` PEM |

---

## Faz F — TLS Inspector (#64)

The #64 section is directionally right (public-only `tls.connect` probe,
present-vs-validate discipline, `buildCertificateInfo` reuse for the chain) but
has **six code-level errors** that must be fixed before implementation.

### Verified integration points

| Claim | Location |
|---|---|
| Shared TLS module exports `getCipherPreset(modern/intermediate/legacy)`, `normaliseTlsVersion`, `isLegacyTlsVersion`, and `TlsOptions{minVersion,maxVersion,ciphers}` — the single source the HTTP/SOAP engines already use. | `src/main/lib/tls-presets.ts:79-134` |
| HTTP engine TLS config: `rejectUnauthorized` defaults **true** (`options.sslVerification !== false`); min/max run through `normaliseTlsVersion`, applied to `https.Agent` **only when not legacy**; ciphers verbatim. No independent hostname check — relies on Node's default `checkServerIdentity` via `rejectUnauthorized`. | `src/main/protocols/http.engine.ts:1127-1159` |
| Electron 33 BoringSSL **cannot** negotiate TLS 1.0/1.1; HTTP engine detects with `isLegacyTlsVersion` and routes to the curl sidecar. `https.Agent`/`tls.connect` throw `ERR_SSL_INVALID_COMMAND` for these. | `src/main/protocols/http.engine.ts:936-941` + `tls-presets.ts:96-121` |
| `buildCertificateInfo(certDer: Buffer)` is the reusable extractor → subjectDN/issuerDN/serial/sigAlg/notBefore/notAfter/publicKeyAlgorithm/keySize/sha1+sha256 fingerprints/SANs/pem. `getPeerCertificate(true)` returns `DetailedPeerCertificate` with `.raw` (DER) + `.issuerCertificate`, so chain walk = map `buildCertificateInfo(node.raw)`. | `src/main/lib/keystore.ts:233-272` |
| `KeystoreEngine` public surface is `createEmpty/open/loadOrCreate/inspect/aliasDetail/generateKeyPair/serialize/close` only. **No** import-trusted-cert / add-cert method on a live session. | `src/main/lib/keystore.ts:878-1013` |
| `serializeKeyStore`/`parseKeyStore` accept `EntryModel[]` incl. `{alias,kind:'cert',certDer}`, but `EntryModel` is **internal** — a renderer-driven "add trusted" flow cannot construct it. | `src/main/lib/keystore.ts:599-615` |
| Existing mTLS attach paths that must keep working: `certificate.handler.ts` `pickFile` for crt/key/pfx/ca + `certificate.repo` persistence, consumed by http.engine as `options.certificates.clientCert {cert,key,pfx,passphrase}`. | `certificate.handler.ts:97-124` + `http.engine.ts:1132-1142` |
| No TLS inspector code exists yet (no `tls.connect`/`getPeerCertificate`/`checkServerIdentity`/`classifyExpiry`/`tls:inspect`). `resolveKeyMaterial`, keystore-bridge, `exportAliasPem`, `tls.rootCertificates` also do not exist yet (all Faz-5 #60 deliverables). | grep across `src/` — zero hits |

### Corrections (design-said → code-reality → fix)

**F-1 — `hostnameValid` must use `tls.checkServerIdentity`, not `X509Certificate.checkHost`.**
- **Design said:** Engine contract line 261:
  `hostnameValid = new X509Certificate(leaf.raw).checkHost(servername)` —
  presented as a boolean.
- **Code reality:** `X509Certificate.checkHost()` returns `string | undefined`
  (the matched name), never a boolean, and does hostname matching only — no
  IP-SANs, no full RFC 6125 wildcard/CN-fallback. Node's own verifier (what
  `rejectUnauthorized` uses in http.engine) is `tls.checkServerIdentity`, which
  the design's own §6 mitigation (line 357) names. The contract contradicts its
  own risk section.
- **Fix:** `hostnameValid = tls.checkServerIdentity(servername, peerCert) === undefined`
  where `peerCert = getPeerCertificate()` (exactly the shape
  `checkServerIdentity` expects; returns `undefined` on match, `Error` on
  mismatch). This is the true "reuse the verifier" path, coerces to a real
  boolean, and covers IP + wildcard. Drop the `checkHost` formulation.

**F-2 — `caCerts` must be MERGED with `tls.rootCertificates`, not replace them.**
- **Design said:** `caCerts?: Buffer[]` — "optional extra trust anchors merged
  with system defaults for the VALIDATE verdict" (line 251).
- **Code reality:** `tls.connect`'s `ca` option **replaces** the default root
  bundle, it does not merge. `ca: caCerts` drops all system roots, so the
  authorized verdict for any real public endpoint becomes `false` while only the
  supplied CA validates. Local-fixture tests (TLS-023 trusted case) would pass
  and **mask** this.
- **Fix:** When `caCerts` is provided, pass
  `ca: [...tls.rootCertificates, ...caCerts]` explicitly
  (`require('node:tls').rootCertificates`). When absent, **omit** `ca` so Node
  uses the default store. Add a test asserting a system-trusted public leaf
  stays authorized when extra `caCerts` are also supplied.

**F-3 — Legacy TLS versions need an explicit handled error (no curl fallback exists).**
- **Design said:** `TlsInspectOptions` carries `minVersion?/maxVersion?` as free
  strings passed straight to `tls.connect`; the only version test (TLS-009) pins
  TLSv1.2.
- **Code reality:** `tls.connect` on Electron 33 BoringSSL throws for
  min/maxVersion of TLSv1/TLSv1.1 (same `ERR_SSL_INVALID_COMMAND` the http.engine
  guards at :936-941/:1150-1155). The inspector has **no curl-sidecar fallback** —
  and the sidecar returns an HTTP response, **not** a `getPeerCertificate`
  chain, so it cannot substitute for raw cert inspection. A TLS 1.0/1.1-only
  bank/gov endpoint (the suite's target) is un-inspectable and would surface a
  raw BoringSSL error.
- **Fix:** Reuse `normaliseTlsVersion` + `isLegacyTlsVersion` from
  `tls-presets.ts`. If `isLegacyTlsVersion(min|max)`, do **not** call
  `tls.connect` — return `ok:false` with an explicit handled error ("Electron
  cannot negotiate TLS 1.0/1.1 for inspection"), never a leaked BoringSSL
  string. Add a TLS 1.0/1.1 test asserting the handled error (never
  `TypeError`/`RangeError`).

**F-4 — Add cipher control so the inspector can reach deliberately-weak endpoints.**
- **Design said:** Options expose only `minVersion/maxVersion`; no cipher
  control.
- **Code reality:** The HTTP engine offers modern/intermediate/legacy cipher
  presets via `getCipherPreset` (`tls-presets.ts`) specifically so users can
  reach BadSSL weak-cipher/legacy endpoints. Omitting this means the inspector
  cannot inspect exactly the deliberately-weak endpoints (rc4/3des/dh512) the
  preset system exists for — a Send-vs-inspect capability gap.
- **Fix:** Add `ciphers?: string` (or `cipherPreset?: CipherPresetName` resolved
  through `getCipherPreset`) to `TlsInspectOptions` and forward to `tls.connect`,
  mirroring `http.engine.ts:1156-1158`. Reuse the shared `TlsOptions` shape so
  Send and Inspect stay parity-locked.

**F-5 — "Add as trusted → keystore" needs a NEW `KeystoreEngine.importTrustedCert` method + IPC.**
- **Design said:** TLS-027 "add viewed cert as trusted → keystore" is
  demonstrated by calling
  `serializeKeyStore([{alias,kind:'cert',certDer}], ...)` directly in a test.
- **Code reality:** That constructs the internal `EntryModel` and calls a
  low-level export function — it does **not** correspond to any real
  renderer→main flow, because `KeystoreEngine` has no session-level method to
  import a trusted cert (only `createEmpty/open/generateKeyPair/aliasDetail`
  exist). The renderer holds only a `sessionId` + public metadata, so it cannot
  hand an `EntryModel` across IPC.
- **Fix:** Add a new `KeystoreEngine` method, e.g.
  `importTrustedCert(sessionId, alias, certPemOrDer)`, that parses via
  `node:crypto` `X509Certificate` (rejecting private-key PEM / garbage / >1 MiB
  per TLS-028), pushes a `{kind:'cert',certDer}` entry, re-serializes, and
  returns updated `KeystoreMeta` — plus a keystore IPC channel for it. The "add
  as trusted" link calls **that**, not `serializeKeyStore` directly.

**F-6 — Ship mTLS inline-PEM + file client-cert from day one; resolver is keystore-source only.**
- **Design said:** §3.3/§5 — the mTLS client-cert probe "reuses the resolver
  only for `need:buffer`" (implying every client-cert path goes through
  `resolveKeyMaterial`, a Faz-5 #60 deliverable), while also claiming #64 "runs
  fully parallel to Faz 5–7".
- **Code reality:** `resolveKeyMaterial`/keystore-bridge do not exist yet. But
  inline PEM paste and direct CRT/KEY/PFX file selection need **no** resolver —
  inline PEM parses with `node:crypto` and files read directly (as http.engine
  already does at :1132-1142). Only the **keystore source** needs the resolver.
  Coupling all mTLS to the resolver breaks both the parallel-track claim and the
  additive invariant.
- **Fix:** Ship the inspector's mTLS with inline-PEM and file client-cert attach
  from day one (engine takes already-resolved `{cert,key,pfx,passphrase}`
  buffers — transport-agnostic, no resolver). The handler resolves inline/file
  locally now and adds the keystore `MaterialSource` branch when #60 lands.
  Require a regression test for **file-source** `clientCert` attach (design
  currently tests only inline TLS-006 and keystore-secret-leak TLS-025/026 — the
  file path is untested). Keep "Use from keystore" as one added option, never
  mandatory.

### Additive-invariant regression surface (TLS Inspector)

| Surface | Path | Required regression test |
|---|---|---|
| Inline PEM client cert for mTLS inspection | parsed in main from `{kind:'inline', certPem, keyPem}`, no resolver (mirror of `http.engine.ts:1138-1140`) | inline TLS-006 stays green (already covered) |
| Direct CRT/KEY/PFX file selection for mTLS inspection | `certificate.handler.ts:97-124` `pickFile` (crt\|key\|pfx\|ca, 1 MiB cap) → `options.certificates.clientCert {cert,key,pfx,passphrase}` | **NEW** file-source `clientCert` attach test (currently untested) |
| WS-Security Cert/Private Key PEM textareas | separate WSSE paste path (unrelated to inspector) | part of the global additive invariant; keystore option must never displace it |

---

## Faz D1 — JWK / JWKS-serve (#61)

Grounded against the real mock pipeline (`mock.handler.ts`, `mock.repo.ts`,
`mock/server.ts`, `matcher.ts`, `script.ts`) and `jose@6.2.3` at runtime.

> **Scope note:** this section reconciles **only** D1/#61 JWKS-serve (mock
> pipeline + jose JWK APIs). The #64 TLS and #65 SAML sections are reconciled in
> their own phases above/below.

### Verified integration points

| Claim | Location |
|---|---|
| `jose@6.2.3` exports every JWK API the design assumes: `exportJWK`, `importPKCS8`, `importSPKI`, `importX509`, `calculateJwkThumbprint` (RFC 7638), `calculateJwkThumbprintUri`, `createLocalJWKSet`, `createRemoteJWKSet`, `generateKeyPair`. | `node_modules/jose` (runtime `Object.keys`); `package.json "jose":"^6.2.3"` |
| The mock subsystem has **no** "rule" primitive. Serving anything = one `mock_endpoints` row (method+path+path_mode) + one-or-more `mock_responses` rows (status/headers/body_type/body/condition/script). Matching = `matchEndpoint(method,path)`; response = first enabled response whose condition matches. | `mock/server.ts:296-486`, `mock.repo.ts:244-390` |
| `path_mode 'exact'` is a literal string compare after `stripTrailingSlash`, so `path='/.well-known/jwks.json'` (dots, multi-segment) matches with no regex/escaping concern; exact scores highest in the tie-break. | `mock/matcher.ts:61-72`, `scoreOf():53-58` |
| `json` `body_type` auto-sets `content-type: application/json; charset=utf-8` when no explicit content-type — correct for a JWKS document. | `mock/server.ts:523-525`, `defaultContentType():698-710` |
| Creating/updating a mock endpoint or response hot-reloads a running server (`reloadIfRunning`/`reloadServerForEndpoint`) — rewriting the JWKS body after rotation takes effect without a restart. | `mock.handler.ts:250-321, 375-385` |
| `renderTemplate` runs over the response body; a JWKS JSON (base64url members, no `{{`) passes through unchanged. | `mock/server.ts:518` |
| None of `keystore-bridge.ts`, `tools/jwk.ts`, `jose.engine.ts`, `jose.handler.ts` exist yet; only `src/renderer/lib/tools/jwt.ts` exists. Mock response body edited in `MockServerEditor.tsx`. | filesystem check |

### Corrections (design-said → code-reality → fix)

**D1-1 — JWKS-serve is ZERO new mock primitives (no "rule" type exists).**
- **Design said:** #61/#63 call JWKS-serve "a Mock Server rule later" (line 295)
  and "optional JWKS mock-serve" (Faz 8, line 328), implying a distinct rule
  primitive to add.
- **Code reality:** There is **no** rule type anywhere in the mock model. The
  engine is strictly server → endpoints (method/path/path_mode via
  `matchEndpoint`) → responses (status/headers/body_type/body/condition/script).
- **Fix:** Design JWKS-serve as **zero new primitives**: exactly one
  `mock_endpoints` row `{method:'GET', path:'/.well-known/jwks.json',
  path_mode:'exact', enabled:1}` + one `mock_responses` row
  `{status_code:200, body_type:'json', body:<JWKS JSON string>,
  condition:{type:'always'}}`, created through the existing
  `mock:endpoint:create` / `mock:response:create` IPC handlers. No new table, no
  engine change. The "rule vs dedicated endpoint" question resolves to
  **neither** — a normal endpoint+response row pair.

**D1-2 — The JWKS body MUST be a static, pre-computed string (no request-time generation).**
- **Design said:** §7.1/§3.1 treat the JWKS document as something to "build"
  (`buildJwks`) and gesture at serving without saying where the JSON is produced
  at request time.
- **Code reality:** The mock response script sandbox (`mock/script.ts`,
  `vm.runInNewContext`) exposes **only** `request/state/response/console/setJson/
  setStatus/setHeader` — **no** `require`, **no** `node:crypto`, **no** `jose`.
  `jose` is ESM-only and cannot enter that vm context. So a JWKS document cannot
  be generated at request time inside a mock response.
- **Fix:** The JWKS body must be a **static** string. Build it in **main** at
  configure time (resolver `need:'jwk'` → `publicJwk`, assembled by a pure
  `buildJwks({keys:[...]})` helper), then write the serialized JSON into
  `mock_responses.body` via `mock:response:create/update`. Key rotation =
  recompute in main + `response:update` (hot-reloads). Do **not** plan a
  request-time-scripted JWKS endpoint.

**D1-3 — `stripBasePath` means the well-known URL only lands right with empty base_path.**
- **Design said:** Assumes the well-known URL is literally
  `http://host:port/.well-known/jwks.json`.
- **Code reality:** `handleRequest` strips the server's `base_path` from the
  incoming pathname **before** matching (`stripBasePath`, `server.ts:248,
  692-696`). If the mock server has a non-empty basePath, the endpoint must be
  stored **without** the basePath prefix and the public URL becomes
  `{basePath}/.well-known/jwks.json`.
- **Fix:** Provision the JWKS mock server with `base_path=''` (the
  `createMockServer` default) so the served URL is exactly
  `/.well-known/jwks.json`. If a user reuses a based server, store endpoint path
  as `/.well-known/jwks.json` (post-strip) and surface the effective URL as
  `base+path`.

**D1-4 — Public-JWK-only is a HARD requirement of D1, not a future caveat.**
- **Design said:** Security note (line 407): "If/when JWKS-serve is added, serve
  public JWK only … assert it in a test" — stated as a future caveat.
- **Code reality:** Because the body is a static string the configure step
  writes, the leak risk is entirely at **build time**: passing `privateJwk`
  (with `d/p/q/dp/dq/qi/k`) into the JWKS body would serve private key bytes over
  the mock HTTP port to any localhost caller.
- **Fix:** Make it a hard D1 requirement: the `buildJwks`/config path consumes
  **only** resolver `publicJwk` (private members already stripped) and strips
  `d,p,q,dp,dq,qi,k` defensively before writing body. **Required security test:**
  start the mock, `GET /.well-known/jwks.json`, assert every key in `{keys:[...]}`
  has none of those private members and shape is `createLocalJWKSet`-acceptable.

**D1-5 — Pin exact jose function names.**
- **Design said:** #61/#63 refer generically to "RFC 7638 thumbprint" for the
  `kid`.
- **Code reality:** `jose@6.2.3` exports `calculateJwkThumbprint` (async) and
  `calculateJwkThumbprintUri`; there is **no** `calculateThumbprint`.
  `importSPKI/importPKCS8/importX509/exportJWK/createLocalJWKSet` all confirmed
  present.
- **Fix:** Pin exact names: `kid = await calculateJwkThumbprint(publicJwk)`
  (base64url), URI variant via `calculateJwkThumbprintUri`. `jwk:toPem` uses
  `importJWK` → `exportSPKI`/`exportPKCS8`.

### Additive-invariant regression surface (JWK / JWKS-serve)

| Surface | Path | Required regression test |
|---|---|---|
| Hand-authored JWKS response body | mock response body textarea `MockServerEditor.tsx` → `mock_responses.body` | a static hand-typed JWKS body serves **byte-for-byte** with `content-type application/json`; the "Use from Security/keystore" auto-fill is ONE added button writing into the same field, never a replacement |
| Existing body_type/headers/condition/path_mode inputs | `mock.repo.ts CreateMockResponseInput` / `MockServerEditor.tsx` | stay untouched — JWKS-serve introduces no new column and no new response shape |

---

## Faz E — SAML (#65)

Reconciles design **§3.4 / §7.4 / §6-HIGH** against real `xml-crypto` usage in
`wsse.engine.ts` (`xml-crypto ^6.1.2`). The core premise — SAML reuses the
`xml-crypto` WSSE already ships — is sound; the reusable pieces are confirmed.
Where the design over-reaches is the phrase "reuses the WSSE pattern **exactly**".

### Verified integration points

| Claim | Location |
|---|---|
| Canonicalization for signing is exclusive-c14n (`http://www.w3.org/2001/10/xml-exc-c14n#`) — SAML reusing this is correct. | `wsse.engine.ts:366` (canonicalizationAlgorithm) + :377 (transforms) |
| WSSE sets SignatureMethod + DigestMethod **explicitly** via `SIGN_ALGO_URI`/`HASH_ALGO_URI` maps rather than relying on xml-crypto defaults — SAML must copy this exact "never trust the default (RSA-SHA1)" pattern. | `wsse.engine.ts:42-52` (maps), :365 signatureAlgorithm, :378 digestAlgorithm |
| SAML-041 "trust anchor = caller cert, never KeyInfo cert" is **already** the WSSE verify behavior and comes for free: `SignedXml` built with only `publicCert` and no `getCertFromKeyInfo`, so key = `getCertFromKeyInfo(noop→null) \|\| publicCert` = caller cert. | `wsse.engine.ts:507`; xml-crypto `signed-xml.js:112, 242, 959` |
| The enveloped-signature transform SAML needs **is** registered in xml-crypto 6.1.2 — no custom transform to author. | `node_modules/xml-crypto/lib/signed-xml.js:70` maps `…#enveloped-signature` → `EnvelopedSignature` |
| `xml-crypto@6.1.2` is CommonJS with a require-able named `SignedXml` export — SAML's deps (`xml-crypto`, `node:crypto`, `node:zlib`) introduce **no** ESM-in-main bundle risk, contra the LOW-risk §6 note. | `xml-crypto/package.json` (type commonjs); runtime `require('xml-crypto').SignedXml` is a function |
| DER→PEM / PEM helpers SAML should share (`pemToBase64`, `X509Certificate`, `createPrivateKey`) exist and are reusable as-is. | `wsse.engine.ts:153, 162, 297, 559` |
| EDIT-3 WSSE keySource wiring point is real: soap.engine resolves config then calls `applyWsSecurity`; `SignConfig.privateKeyPem/certPem` feed `SignedXml`; type is `WsSignConfig`. | `soap.engine.ts:785-787`; `wsse.engine.ts:362-369`; `types/index.ts:373-378` |

### Corrections (design-said → code-reality → fix)

**E-1 — SAML reuses WSSE's xml-crypto MECHANICS, not its detached-signature OPTIONS.**
- **Design said:** §3.4/§7.4: SAML "reuses the WSSE pattern exactly" for
  xml-crypto signing.
- **Code reality:** The WSSE `SignedXml` is configured for a **detached**
  signature in the `wsse:Security` header, with WSSE-specific options that are
  **wrong** for SAML's **enveloped** signature:
  (a) `idMode:'wssecurity'` (`wsse.engine.ts:367`) resolves `wsu:Id`, not SAML's
  plain `ID`; (b) transforms are exc-c14n **only** (:377) — no
  enveloped-signature transform; (c) references use `xpath` + `uri:''` +
  `isEmptyUri:false` (:375-382); (d) `getKeyInfoContent` emits
  `SecurityTokenReference`/BST or `X509IssuerSerial` (:286-308);
  (e) `computeSignature` appends into the Security header (:386).
- **Fix:** Reframe #65 as "reuse WSSE's xml-crypto **mechanics** (`SignedXml`
  ctor shape, explicit algo maps, exc-c14n, PEM helpers) but with SAML-specific
  signing options." Concretely for `signSaml`:
  - **OMIT** `idMode` (xml-crypto default `idAttributes ['Id','ID','id']`
    already matches SAML `ID`);
  - `addReference({ xpath: <to-element-by-ID>, uri: '#'+id, transforms:
    ['http://www.w3.org/2000/09/xmldsig#enveloped-signature',
    'http://www.w3.org/2001/10/xml-exc-c14n#'], digestAlgorithm:
    HASH_ALGO_URI[algo] })`;
  - `getKeyInfoContent` emitting
    `<X509Data><X509Certificate>pemToBase64(certPem)</X509Certificate></X509Data>`
    (do **not** reuse `buildKeyInfoProvider`);
  - `computeSignature` location `{ reference: "//*[local-name(.)='Issuer']",
    action: 'after' }`, `prefix: 'ds'`.

**E-2 — Trust-anchor guarantee is inherited structurally by copying the ctor.**
- **Design said:** §7.4 verify: "trust anchor = caller `certPem`, never KeyInfo
  cert" listed as new SAML security work.
- **Code reality:** WSSE `verifySignature` already achieves exactly this by
  constructing `new SignedXml({ publicCert: certPem })` and **not** passing
  `getCertFromKeyInfo` (`wsse.engine.ts:507`); xml-crypto falls back to
  `publicCert` (`signed-xml.js:242/959`).
- **Fix:** State that SAML verify **inherits** the trust-anchor guarantee by
  copying the WSSE constructor verbatim (`publicCert` only, no
  `getCertFromKeyInfo`). SAML-041 needs no new mechanism — just do **not** add
  `getCertFromKeyInfo`. Keep the negative test, but the property is structural,
  not bespoke code.

**E-3 — XSW / single-Reference-ID validation is ADDITIVE code SAML adds, not inherited.**
- **Design said:** §7.4: SAML verify (XSW SAML-030/031, single-Reference/ID)
  framed as "mirroring the WSSE engine/handler pair."
- **Code reality:** WSSE `verifySignature` does **no** wrapping defense: it
  regex-grabs the **first** `<Signature>` node (`wsse.engine.ts:508`, non-global
  match), calls `loadSignature`+`checkSignature`, and returns
  `getSignedReferences()` **without** asserting **which** element was signed
  (:514-528). xml-crypto validates reference digests + SignedInfo signature but
  leaves XSW to the caller.
- **Fix:** Mark single-Reference/ID validation and multi-Signature/duplicate-ID
  rejection as **additive** logic SAML adds **on top of** the WSSE pattern, not
  inherited. After `checkSignature===true`: assert exactly one Reference in
  SignedInfo, that its URI `#ID` resolves by ID to the active asserted element
  (Assertion/Response), and reject documents containing >1 `ds:Signature` or
  duplicate IDs. Also **replace** WSSE's first-match regex extraction with
  DOM-scoped Signature location (child of the target element) so a wrapped second
  Signature cannot be picked up.

**E-4 — SignatureMethod allowlist (reject HMAC) is new code, no WSSE precedent.**
- **Design said:** §6-HIGH / SAML-038: SignatureMethod allowlist (reject HMAC) as
  a SAML security requirement — implicitly like WSSE.
- **Code reality:** WSSE verify does **not** restrict the algorithm; in verify
  xml-crypto reads `this.signatureAlgorithm` from the document's SignatureMethod
  and `findSignatureAlgorithm` resolves an HMAC algorithm if present
  (key-confusion). WSSE never guards this.
- **Fix:** SAML verify must read `SignedInfo/SignatureMethod` from the parsed doc
  and **reject** any non-RSA/ECDSA (esp. HMAC) **before** calling
  `checkSignature`. This is new code with no WSSE precedent — call it out
  explicitly as such.

**E-5 — DTD/entity defense is a caller-side pre-parse rejection, not a config knob.**
- **Design said:** §6-HIGH / SAML-042/043: "Disable DTD/external entities on
  parse" framed as a config knob.
- **Code reality:** xml-crypto 6.1.2 parses inside `checkSignature` with plain
  `new xmldom.DOMParser().parseFromString(xml)` (`signed-xml.js:200`) —
  DTD/DOCTYPE is **not** suppressed and there is **no** option to disable it
  through the `SignedXml` API. WSSE inherits this and adds no guard.
- **Fix:** SAML must add its **own** pre-parse guard: reject any input whose
  prolog contains a DOCTYPE/DTD (string precheck) **before** it reaches
  xml-crypto or the builders' parser, and apply the same guard to
  `decodeRedirect`/`decodePost` output. Do **not** describe this as "disable DTD
  on xml-crypto's parser" — that lever does not exist; it is a caller-side
  rejection.

**E-6 — Downgrade the ESM-in-main worry for #65's stated deps.**
- **Design said:** §6-LOW (§394/§396): "#65 could drag another ESM-only dep
  (xml-encryption/transitive) into main"; "Re-run smoke when #65 adds deps."
- **Code reality:** SAML's declared deps are `xml-crypto` (CJS 6.1.2, already
  externalized and used by WSSE), `node:crypto`, `node:zlib` — all CJS/builtin.
  `xml-encryption` is a WSSE-only dep and is not needed by SAML
  sign/verify/encode.
- **Fix:** Downgrade/remove the ESM concern for #65: the stated deps carry no
  `ERR_REQUIRE_ESM` risk and need no `externalizeDepsPlugin` exclude. Keep the
  smoke gate as standard practice, but the ESM caveat only re-activates if a
  **new** non-CJS dep is introduced beyond the stated set.

### Additive-invariant regression surface (SAML)

| Surface | Path | Required regression test |
|---|---|---|
| WS-Security Cert/Private Key PEM copy-paste (Tools panel) | `WsSecurityTool.tsx` | keeps working unchanged when keystore "Use from Security" is added |
| SOAP editor PEM inputs → `WsSignConfig.privateKeyPem/certPem` | `SoapSecuritySection.tsx` | EDIT-3 `keySource` addition leaves these as the **default** path |
| SAML tool inline PEM paste (NEW component) | `SamlTool.tsx` (new) | `saml:sign` succeeds with pasted PEM and **no** `keySource`; `keySource:MaterialSource` is ONE added arm of a discriminated union `{inline}\|{source}`, never mandatory |

---

## Cross-phase summary

| Phase | Issue | Headline correction | New parity/security work | Additive surfaces |
|---|---|---|---|---|
| Faz C — WSSE | #60 | Two duplicated type trees + a second wiring junction (`wsse:apply`) the design missed | Shared keySource resolver called from both `wsse.handler` and `soap.engine`; keep `applyWsSecurity` pure | 7 (two PEM components / two stores) |
| Faz F — TLS | #64 | `checkServerIdentity` not `checkHost`; `ca` merges not replaces; legacy TLS needs handled error; add cipher control; new `importTrustedCert` method | Send↔Inspect parity via shared `tls-presets.ts`; keystore-secret-leak guard | inline PEM + **new** file-source clientCert test |
| Faz D1 — JWK | #61 | JWKS-serve = ZERO new mock primitives (ordinary endpoint+response); body is static, built in main | Public-JWK-only as a HARD requirement + mandatory GET-then-assert-no-private test | hand-authored JWKS body byte-for-byte |
| Faz E — SAML | #65 | Reuse WSSE mechanics, NOT its detached-signature options; XSW/HMAC/DTD hardening is additive, not inherited | Single-Reference/ID + multi-sig/dup-ID rejection + SignatureMethod allowlist + DOCTYPE precheck | inline-PEM default + one optional keySource arm |

**Recurring theme across all four phases:** the new "Use from keystore /
Security" material source is always **one added `keySource` branch**, resolved in
the **orchestration/handler layer** (never inside a pure shared engine), with the
existing inline-PEM (and, for mTLS only, file/PFX) paths kept as the default and
each pinned by its own regression test. This is the same Send-vs-Tool /
Send-vs-Run parity discipline CLAUDE.md enforces for runner-verdict,
header-assertion, and env-var resolution — resolve once in a shared helper, call
it from every junction.
