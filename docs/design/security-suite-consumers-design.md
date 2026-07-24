---
title: "Security Suite — Key Material Provider + Consumers (Design + Test Plan)"
issues: ["#60 Key Material Provider", "#61 JWK", "#63 JOSE/JWT full", "#64 TLS Inspector", "#65 SAML"]
roadmap: /Users/mhy/IdeaProjects/testnizer/docs/design/security-suite-bigpicture-plan.md
dependency_engine: /Users/mhy/IdeaProjects/testnizer/docs/design/keystore-studio-design.md
scope_note: >
  This document covers the Security-Suite CONSUMERS and the Key Material PROVIDER (#60/#61/#63/#64/#65).
  It does NOT cover Keystore Studio Faz 1-4 — that is the separate dependency engine documented in
  keystore-studio-design.md. Everything here ASSUMES the Faz-0 keystore engine (parseKeyStore /
  serializeKeyStore / EntryModel / buildCertificateInfo) already exists and is stable.
status: implementation-ready (with one blocker + four HIGH items to resolve in design before wiring)
test_case_count: 153
---

# Security Suite — Provider (#60) + Consumers (#61 / #63 / #64 / #65)

> **Roadmap:** `docs/design/security-suite-bigpicture-plan.md`
> **Dependency engine (NOT covered here):** `docs/design/keystore-studio-design.md` — the Faz-0 Keystore Studio engine. **This document does not cover Keystore Studio Faz 1-4.**

---

## 1. Executive Summary

The Security Suite adds a **Key Material Provider (#60)** and four consumers — **JWK (#61)**, **JOSE/JWT full (#63)**, **TLS Inspector (#64)**, **SAML (#65)** — on top of the existing Faz-0 Keystore Studio engine.

The single load-bearing idea: **one main-process function, `resolveKeyMaterial(source, need)` in `src/main/lib/keystore-bridge.ts`, is the ONLY place any private key is materialized outside the keystore engine.** The renderer never holds key bytes; it holds an opaque `MaterialSource` (ids / paths / pasted-PEM). Every consumer — mTLS Send, Runner, WSSE sign, JOSE sign/verify/JWE, SAML sign, and (public-only) the TLS inspector — calls the same resolver in main and asks for the *shape* it needs (`pem` | `buffer` | `jwk` | `keyObject`). This collapses what would otherwise be five parallel key-loading implementations into one — the exact **parity-bug class** the codebase eliminates everywhere (runner-verdict, script-runtime, header-assertion, env-var single-source).

Private-key extraction stays *inside the engine door*: a new `exportAliasPem()` in `keystore.ts` is the one function that turns a keystore alias into PEM, using `node:crypto` only (no ESM dependency dragged into the externalized main bundle). The bridge consumes PEM strings / Buffers from it and never sees the un-exported `EntryModel`.

**Ground-truth corrections baked into this design:**

- **`src/renderer/lib/tools/jwt.ts` is NOT decode-only.** It already ships `signJwt`/`verifyJwt`/`generateSampleJwt` running in the renderer via `jose`, with private keys pasted into a textarea and imported client-side. The roadmap §3 ("decode-only today") is **stale**. #63 is therefore **"relocate the key-touching crypto into main, add JWS/JWE + full claim-verification, and wire the #60 provider,"** not "add signing."
- **Runner attaches NO client certificate today (the R5 gap).** Routing the Runner through the shared `loadCertificatesFor` turns file-based client certs **ON** for every existing Runner/Test-Suite run — a documented behavior change, not just a bug fix.

**Architectural verdict.** The central bet is correct and collapses the parity-bug class. But the design is **not** ready to implement verbatim. There is **one blocker** — conflating the client-cert chain with the CA trust anchors (`chainPem → caCerts/ca` silently breaks or narrows *server*-cert validation) — plus four **HIGH** items (JOSE verify algorithm allowlist + `alg=none` opt-in; the R5 Runner change shipping client-cert auth to every host; the R11 `certRow→keystore` store-password gap on remember-off; the TLS inspector reporting a *presented* unvalidated chain). Land the schema commit first as planned, but **resolve the blocker and the four HIGH items in design before wiring**, and treat every "honor later" / "fail loud" promise as a required test, not a comment.

---

## 2. The Key Material Provider (#60)

### 2.1 The single load-bearing idea

One main-process resolver, reused by every consumer. The renderer only ever picks *which* material (a `MaterialSource` of ids/paths/pasted-PEM); the resolver dereferences it in main and returns whatever *shape* the consumer needs. No new session state is required — the Faz-0 engine already exports `parseKeyStore(bytes, password, type)` (`keystore.ts:599`) returning the full `EntryModel[]` including `privateKeyPkcs8Der: Buffer` + `certChainDer: Buffer[]`. **BUT** `EntryModel` is not exported (`keystore.ts:138`) and the public `aliasDetail` deliberately exposes only the public chain (`keystore.ts:956`). So step 1 is a small **engine extension** that keeps private-key extraction inside the engine door (preserving the no-leak discipline).

### 2.2 Engine helper — `exportAliasPem` (new, inside `keystore.ts`)

Private-key extraction stays in `keystore.ts`, `node:crypto` only — no ESM dep into the externalized main bundle:

```ts
export function exportAliasPem(
  bytes: Buffer, storePassword: string, type: KeystoreType, alias: string, keyPassword?: string,
): { certPem: string; keyPem: string; chainPem: string[] }
//  parseKeyStore(bytes, storePassword, type) -> find alias (kind:'key')
//  keyPem  = createPrivateKey({key: privateKeyPkcs8Der, format:'der', type:'pkcs8'})
//              .export({format:'pem', type:'pkcs8'})
//  certPem = new X509Certificate(certChainDer[0]).toString()
//  chainPem= certChainDer.slice(1).map(d => new X509Certificate(d).toString())
// NOTE (R11): keyPassword currently has nowhere to go — parseJks/parsePkcs12 open with
// ONE password (store==entry). Distinct per-alias key passwords need a follow-up that
// threads an entry password through the readers. Land the param now, honor it later.
```

`node:crypto`'s `X509Certificate` + `createPrivateKey` are already the DER→PEM path used in `wsse.engine.ts` (`:11, :162, :559`) — reuse them in the bridge to avoid dragging `jose` (ESM-only) into main for the PEM/Buffer needs; `jose` is only for the `jwk` need.

### 2.3 Resolver contract — `resolveKeyMaterial`

```ts
// src/main/lib/keystore-bridge.ts — the ONE main-process resolver.

export type MaterialSource =
  | { kind: 'keystore'; keystoreId: string; alias: string; keyPassword?: string; storePassword?: string }
  | { kind: 'certRow'; certificateId: string }
  | { kind: 'file'; certPath?: string; keyPath?: string; pfxPath?: string; passphrase?: string }
  | { kind: 'inline'; certPem: string; keyPem?: string; passphrase?: string }

export type MaterialNeed = 'pem' | 'buffer' | 'jwk' | 'keyObject'

export interface ResolvedKeyMaterial {
  // Always populated (canonical emitter):
  certPem: string
  keyPem?: string           // undefined for public-only material
  chainPem?: string[]       // intermediate certs, leaf-first
  passphrase?: string       // decrypted key passphrase, main-only
  // need === 'buffer' adds:
  certDer?: Buffer
  keyDer?: Buffer
  caCertBuffers?: Buffer[]  // chainPem intermediates as Buffers (see BLOCKER: do NOT route into caCerts)
  // need === 'jwk' adds (jose-only path):
  privateJwk?: import('jose').JWK
  publicJwk?: import('jose').JWK
  // need === 'keyObject' adds (node:crypto):
  privateKeyObject?: import('node:crypto').KeyObject
  publicKeyObject?: import('node:crypto').KeyObject
}

export function resolveKeyMaterial(source: MaterialSource, need: MaterialNeed): ResolvedKeyMaterial

// Contract:
//  - Only the fields required by `need` are populated (superset return).
//  - Runs in MAIN ONLY. Return value never crosses back to the renderer.
//  - Throws (surfaced as {error}) on: unresolvable alias, wrong store/key password,
//    NULL keystore.store_password with no source.storePassword, oversized/untrusted
//    keystore blob, or a file failing R12 rails. Fail LOUD — never silent-empty.
//  - `jose` is imported ONLY on the need==='jwk' branch (ESM-in-main containment).
```

**One canonical PEM emitter, four adapters.** The core of the resolver produces `{certPem, keyPem?, chainPem?, passphrase?}`. Everything else is derived:

| `need` | derivation |
|---|---|
| `pem` | the canonical `{certPem, keyPem?, chainPem?, passphrase?}` itself |
| `buffer` | `Buffer.from(pem)` for cert/key; `caCertBuffers` from `chainPem` intermediates as Buffers |
| `keyObject` | `node:crypto` `createPrivateKey` / `createPublicKey` |
| `jwk` | `jose` `importPKCS8` / `importX509` → `exportJWK` — **the only path that imports `jose`** |

**Source dereference:**

- `keystore` → `getKeystore(id)` → `decryptSecret(row.blob)` → base64 → Buffer; `decryptSecret(row.store_password)` **OR** `source.storePassword` when the row's stored password is NULL (remember-off) → `exportAliasPem(bytes, storePw, type, alias, keyPassword)`.
- `certRow` → `getCertificate(id)` (new single-row fetch). If `row.source==='keystore'` → recurse into the keystore branch using `row.keystore_id` / `row.keystore_alias` with `decryptSecret(row.passphrase)` as the per-alias KEY password; else read `crt_path`/`key_path`/`pfx_path` through the R12-rail file reader.
- `file` → ad-hoc picker paths (`.jks`/`.p12`/PEM), R12 rails re-imposed (symlink-resolve + size cap + keystore-aware extension whitelist).
- `inline` → map pasted PEM directly.

This makes ONE canonical PEM emitter feed both TLS (`Buffer.from(pem)`) and WSSE (PEM string) — no second bridge.

**Fail-loud (security invariant 3).** An unresolvable alias, wrong store password, or NULL store password with no `source.storePassword` throws — surfaced as the existing `{error}` so Send AND Run fail visibly, never silently unauthenticated. The non-interactive mTLS path returns a clear `{error}` rather than hanging.

**No-leak (invariant 5).** Resolved PEM/key/passphrase never cross back to the renderer and never appear in logs or error/stack strings. WSSE/JOSE resolve in main and return only the signed/verified artifact; the picker returns ids only.

> **Scoping note (no-leak overclaim).** "The renderer never holds key bytes" is only true for provider-sourced material (keystore/certRow/file). The **inline/paste-PEM** path — which every consumer ships first — carries user-supplied bytes one-way through IPC. Precise invariant: provider paths never expose bytes; inline paths carry user-supplied bytes one-way and must be **write-only** (never persisted to DB/store, never echoed back, never logged).

### 2.4 `<KeyMaterialPicker>` (renderer)

`src/renderer/components/shared/KeyMaterialPicker.tsx` — the ONE reusable selection dialog. It is a controlled input whose value is an opaque `MaterialSource` object of ids/paths/pasted-PEM only; **no key bytes ever live in renderer state.** Consumers persist the `MaterialSource` (in their store / DB row / request config) and main resolves it at execution time.

- **Tabs/segments:**
  - **Keystore alias** — dropdown of `listKeystores()` → on select, `keystore:aliases(id)` lists aliases with `hasPrivateKey`; picks `{kind:'keystore', keystoreId, alias, keyPassword?, storePassword?}`.
  - **Certificate** — project cert rows → `{kind:'certRow', certificateId}`.
  - **File** — native dialog → `{kind:'file', ...}`.
  - **Paste PEM** — textarea → `{kind:'inline', certPem, keyPem?, passphrase?}`.
- **Password fields** (store-pw when remember-off, key-pw when the alias is protected) are captured in the picker and travel inside the `MaterialSource` to main; they are **write-only** from the renderer's perspective (never read back).
- A `filter` prop (`'privateKey'` | `'publicOnly'` | `'any'`) lets JWE-encrypt / verify / TLS-inspect show only public material and hide the paste-private-key field.
- Emits `{ source: MaterialSource, label: string }` — `label` is a human string ("keystore 'prod' › alias client1") for the consumer to render without dereferencing.

Because the picker does not exist until Faz 5/6, **every consumer ships "inline-first"**: the IPC payload is a discriminated union `{inline:{...}} | {source: MaterialSource}` from day one, and the picker is swapped in when #60 lands without touching the handler contract.

### 2.5 The three wiring edits

**EDIT 1 — mTLS Send.** `request.handler.ts#loadCertificatesFor` (`:127-166`). In the client-cert branch (`:146-162`), before the file reads, branch `if (r.source === 'keystore')` → `resolveKeyMaterial({kind:'keystore', keystoreId:r.keystore_id, alias:r.keystore_alias, keyPassword: decryptSecret(r.passphrase)}, 'buffer')` → `clientCert = {cert:Buffer.from(certPem), key:Buffer.from(keyPem), passphrase}`. Downstream shape is identical ⇒ **zero `http.engine.ts` changes** (mapping at `:1128-1141` unchanged). Keep the existing `{error}` fail-fast so an unopenable alias fails LOUDLY.

> **BLOCKER (see §6):** Do **not** push `chainPem` intermediates into `caCerts`. Node's `ca` REPLACES the default root store used to validate the **server** cert; client-chain intermediates and CA trust anchors are orthogonal. Send the client leaf + intermediates as a concatenated PEM bundle in `clientCert.cert` instead and leave `ca` alone.

**EDIT 2 — Runner (closes the R5 gap).** `runner.handler.ts` main loop at `:1390-1396` sets only `resolvedOptions.projectId` then calls `executeHttpRequest` — it **never** calls `loadCertificatesFor`, so Runner/Test-Suite runs attach NO client cert today. Fix by calling the **same exported** `loadCertificatesFor` (not a copy): after `:1395` add

```ts
if (options.projectId && !resolvedOptions.certificates) {
  const { certificates, error } = loadCertificatesFor(options.projectId, resolvedOptions.url)
  if (error) throw new Error(error)   // but caught per-iteration — see risk
  if (certificates) resolvedOptions.certificates = certificates
}
```

Because `loadCertificatesFor` is now keystore-aware, both file- and keystore-backed rows attach on Run — the single-source Send≡Run parity CLAUDE.md keeps flagging. **This turns file-based client certs ON for existing Runner runs = documented behavior change (R5, release note).** Secondary junction: `pm.sendRequest` at `:847` (and its Send twin) bypasses certs too — same fix applies if full parity is wanted, but the primary junction is the request loop.

**EDIT 3 — WSSE.** `soap.handler.ts` passes `wsSecurity: payload.wsSecurity` straight into `executeSoap` (`:60-78`); `soap.engine.ts:786` runs `migrateLegacyConfig` then `applyWsSecurity`, and xml-crypto consumes `SignConfig.privateKeyPem`/`certPem` (`wsse.engine.ts:87-93`, fed at `:363`). Extend `WsSignConfig` (`types/index.ts:373`) so `privateKeyPem`/`certPem` become **optional** and add a `keySource?: MaterialSource` alternative. Resolve it IN MAIN at `soap.engine.ts:786` (or in `soap.handler` before `executeSoap`): if `sign.keySource` present → `resolveKeyMaterial(keySource, 'pem')` → populate `privateKeyPem`/`certPem` before `applyWsSecurity`. **Never ship resolved PEM back to the renderer.** Same pattern later feeds #65 SAML (`need:'pem'`) and #63 JOSE (`need:'keyObject'`).

### 2.6 Schema (R11 double-password) + helpers mirror

ALTER `certificates` (`database.ts` CREATE at `:519-531`) **and** the same three columns on the CREATE at `helpers.ts:394-405` **IN THE SAME COMMIT** — production ALTERs never run against `createTestDb()`, so a missing column makes cert-handler INSERTs silently return `success:false` 'no such column' and reds the CI quality job (standing CLAUDE.md gotcha):

- `source TEXT NOT NULL DEFAULT 'file'` — `'file' | 'keystore'`
- `keystore_id TEXT`
- `keystore_alias TEXT`
- `crt_path` / `key_path` / `pfx_path` stay NULL for keystore rows; **a keystore row STILL needs a `host` (or `'*'`)** or `listCertificatesForHost`/`certHostMatches` never selects it (`certificate.repo.ts:38-55`, unchanged).

`certificate.repo.ts` gains the three columns on `CertificateRow` / `CreateCertificateInput` / INSERT / UPDATE, plus a new **`getCertificate(id)`** single-row fetch (currently only `listCertificates*` exist).

**R11 double-password:** model both passwords explicitly — STORE password lives on the `keystores` row (`store_password`, existing, `encryptSecret`-wrapped, NULL when 'remember password' off → must be prompted/passed); per-alias KEY password lives on the `certificates` row `passphrase` (`encryptSecret`). The resolver threads store-pw into `parseKeyStore` and key-pw into `exportAliasPem`. **Land this schema commit FIRST, green, before any wiring touches the new columns.**

### 2.7 R12 safety-rails the resolver must re-impose

Keystore-backed rows bypass `readCertFile`'s rails (`request.handler.ts:81-108`: `realpathSync` symlink-resolve, extension whitelist `{.crt,.cer,.pem,.key,.pfx,.p12}`, 1 MiB `MAX_CERT_BYTES` cap). The resolver must re-impose equivalents:

- **DB-blob branch** → cap the decoded blob size **PRE-decode** + validate it parses as a real keystore before use; bound parse cost (entry count / time budget) with a try/catch that fails loud (crafted small keystore can expand into heavy CPU/memory).
- **`file` branch** (ad-hoc `.jks`/`.p12` picker) → run `readCertFile`-style symlink-resolve + size cap, but with a **keystore-aware extension set** that ADDS `.jks/.keystore/.jceks` (the current whitelist omits them).

Unit-test that an oversized/untrusted keystore is rejected the same way a bad file is.

---

## 3. Per-Consumer Design

### 3.1 #61 — JWK

**Summary.** Resolver `need:'jwk'` (`jose` `importPKCS8`/`importX509` → `exportJWK`) + a JWK tool (PEM↔JWK, RFC 7638 `kid` thumbprint). Feeds JOSE verify via JWKS.

- **Files:** `keystore-bridge.ts` (jwk branch); `src/renderer/lib/tools/jwk.ts` (NEW inspect/convert, public-only); `src/renderer/components/tools/JwkTool.tsx` (NEW).
- **IPC:** `jwk:fromPem` / `jwk:toPem` / `jwk:thumbprint` (private path in main; public convert may stay renderer).
- **Deps:** `jose` (jwk path only).
- **Integration / two arrows:** (a) the resolver's `need:'jwk'` produces `privateJwk`/`publicJwk` via `jose`; (b) the JOSE verify path's JWKS-URL support (`createRemoteJWKSet`) is the concrete #61→#63 bridge — a JWKS document is a set of #61 JWKs. A JWK tool (convert PEM↔JWK, compute `kid` thumbprint per RFC 7638) is renderer-inspect for public material, main-resolved for private.
- **IPC contract (state at the top of each test file):** `jwk:fromPem({ source: MaterialSource, includePrivate?: boolean })` → `{ success, data:{ publicJwk, kid } }`. `privateJwk` is returned to the renderer ONLY when `source.kind === 'inline'` AND `includePrivate === true`. For every provider-backed source (`keystore`|`certRow`|`file`) the resolver's `privateJwk` is **stripped at the IPC boundary** and NEVER crosses to the renderer, regardless of `includePrivate`. `jwk:toPem({ jwk, want:'spki'|'pkcs8' })` → PEM via `importJWK`→`exportSPKI`/`exportPKCS8`. `jwk:thumbprint({ jwk, hash?:'sha256' })` → RFC 7638 base64url string.

### 3.2 #63 — JOSE/JWT full

**Reframe.** `jwt.ts` is *already* a full renderer-side sign/verify module (roadmap's "decode-only" line is stale). The work is **relocating key-touching crypto into main** (`jose.engine.ts` + `jose.handler.ts`, modeled on the OTP engine/handler/preload/index quadruple), keeping decode/inspect renderer-side, and wiring the provider at `need:'keyObject'` (jose v6 consumes Node `KeyObject`/`Uint8Array` directly — no re-import). JWKS-URL verify MUST be main (CSP `connect-src 'self'`).

**What stays renderer-only (no key material → safe, zero-latency UX):** `decodeJwt`/`decodeProtectedHeader`, the claim table / human-readable exp/nbf/iat (`humanReadableClaims`, `claimsToTable`, `STANDARD_CLAIMS`), `isExpired`/`isNotYetValid`/`secondsUntilExpiry`, `isAsymmetric`, `JWT_ALGORITHMS`, the colorized 3-part view, AND **structural (non-decrypting) JWE/JWS inspection** — parse the 5-part compact serialization and show the protected header/`alg`/`enc`/`kid` without any key. Net effect on `jwt.ts`: **strip `signJwt`/`verifyJwt`/`generateSampleJwt`** (they become IPC callers), leaving a pure inspect module.

**Full operation surface (all in the main engine):**

- **JWT sign:** HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 (+EdDSA). Claim helpers: auto `iat`, relative `exp`/`nbf`, `jti`/`iss`/`aud`/`sub`; custom protected header (`kid`,`typ`,`cty`,`crit`). jose `SignJWT`/`CompactSign`.
- **JWT verify:** signature + claim checks — `exp`/`nbf` with configurable clock-skew tolerance, `aud` (string or array membership), `iss`, `sub`, `jti`, required-claims list. Key from inline secret/PEM, provider public key (`need:'keyObject'`), or JWKS URL (main fetch, select by `kid`). jose `jwtVerify` (+`createRemoteJWKSet`).
- **JWS:** compact (arbitrary non-JSON payload) + **detached** (RFC 7515 App-F / RFC 7797 `b64:false`). jose `CompactSign` + `FlattenedSign`/`GeneralSign` with `{ crit:['b64'], b64:false }`.
- **JWE encrypt/decrypt:** key-mgmt `RSA-OAEP` (+`RSA-OAEP-256`), `ECDH-ES` (+`ECDH-ES+A128KW`/`A256KW`), `dir`; content-enc `A128GCM`/`A256GCM` (+ CBC-HS pair for completeness). jose `CompactEncrypt`/`compactDecrypt`.

jose v6 accepts `CryptoKey | KeyObject | JWK | Uint8Array` as key input (`node_modules/jose/dist/types/types.d.ts:185`), so the provider's `need:'keyObject'` (Node `KeyObject`) is consumed by jose **directly in main — no re-import needed**; HMAC secrets pass as `Uint8Array`.

**Proposed engine surface (`jose.engine.ts`, pure jose, IPC-free, receives ALREADY-RESOLVED keys):**

```
signJwt({payload, protectedHeader:{alg,...}, key}) → Promise<string>
verifyJwt({token, key, algorithms, audience?, issuer?, clockTolerance?, currentDate?, maxTokenAge?}) → Promise<{payload,protectedHeader}>  // throws on invalid
jwsSign({payload:Uint8Array, protectedHeader:{alg,...}, key, detached?}) → Promise<string|{protected,signature}>
jwsVerify({jws, key, algorithms, detachedPayload?}) → Promise<{payload,protectedHeader}>
jweEncrypt({plaintext, protectedHeader:{alg,enc,...}, key}) → Promise<string>
jweDecrypt({jwe, key}) → Promise<{plaintext,protectedHeader}>
generateKey(alg) → Promise<{privateKey?,publicKey?,secret?,privateJwk?,publicJwk?}>
jwksVerify({token, jwksUri, algorithms, audience?, issuer?}) → Promise<{payload,protectedHeader}>
```

- **Files:** `src/main/protocols/jose.engine.ts` (NEW, pure jose, IPC-free); `src/main/ipc/jose.handler.ts` (NEW, `wrap()` → `{success,data|error}`); `src/main/ipc/index.ts` (`registerJoseHandlers` at ~`:23`/`:55`); `src/preload/index.ts` (`window.api.jose.*` block at ~`:434`); `electron.vite.config.ts:56` (externalize exclude → `['uuid','jose']`); `src/renderer/lib/tools/jwt.ts` (REMOVE sign/verify/generateSample; KEEP decode/inspect + add structural JWS/JWE header parse); `src/renderer/components/tools/JwtTool.tsx` (Decode|Sign|Verify|JWS|JWE tabs); `src/renderer/lib/i18n.ts:~947` (EN+TR `tools.jwt.*`).
- **IPC:** `jose:sign`, `jose:verify`, `jose:jws.sign`, `jose:jws.verify`, `jose:jwe.encrypt`, `jose:jwe.decrypt`, `jose:generateKey`, `jose:jwks.verify` (main-side JWKS fetch).
- **Deps:** `jose ^6.2.3` (bundled via exclude); `resolveKeyMaterial(...,'keyObject')`; `node:crypto`.
- **UI:** Turn the current 2-mode pill (Decode | Encode) into tabs **Decode | Sign | Verify | JWS | JWE**. Reuse every existing atom (`PanelHeader`, `Section`, `CopyButton`, `Badge`, `ColorizedJwt`, Monaco panes). Ship **inline-first** (paste secret/PEM through IPC), swap the `<KeyMaterialPicker>` in when #60 lands.

**The load-bearing gotcha (ESM-in-main).** `jose` is `"type":"module"` with an exports map exposing only an ESM `default` (no CJS require). The moment `jose.engine.ts` does `import ... from 'jose'` in main, `electron.vite.config.ts`'s `externalizeDepsPlugin()` (line 56, currently `exclude:['uuid']`) leaves it as a runtime `require('jose')`, and Electron 33's Node (20) can't `require(ESM)` → **`ERR_REQUIRE_ESM`, window never opens, all platforms** (v1.4.19 class). Fix: `externalizeDepsPlugin({ exclude: ['uuid', 'jose'] })` so Rollup bundles it ESM→CJS. `jose` is pure WebCrypto JS (no `.node`, and — unlike cheerio — pulls no undici/`node:sqlite`), so bundling is safe. **MUST verify with a BUILT app + the smoke gate (`npm run test:e2e:smoke`), not bare `node`** — system Node ≥22 supports `require(ESM)` and hides the crash.

### 3.3 #64 — TLS Inspector

**Summary.** Public-only, no provider private-key path. A new `tls.handler.ts` opens a `tls.connect` to host:port in main, captures `getPeerCertificate(true)` (full chain), protocol/cipher/ALPN, validity, SANs, and returns a public inspection report. It reuses the resolver ONLY for `need:'buffer'` on a *client* cert when inspecting a mutual-TLS endpoint (same keystore-aware attach). Renderer renders the chain with the existing cert-info atoms. **Runs fully parallel to Faz 5–7** (no provider-private dependency).

- **Files:** `src/main/protocols/tls-inspect.engine.ts` (NEW); `src/main/ipc/tls.handler.ts` (NEW); `src/main/ipc/index.ts` (register); `src/preload/index.ts` (`window.api.tls.*`); `src/renderer/components/tools/TlsInspectorTool.tsx` (NEW).
- **IPC:** `tls:inspect` (host, port, servername, optional clientCert `MaterialSource`).
- **Deps:** `node:tls`; `node:crypto` `X509Certificate`; `resolveKeyMaterial` (only for the mutual-TLS probe).

**Engine contract:**

```ts
interface TlsInspectOptions {
  host: string; port?: number /*443*/; servername?: string /*SNI; defaults to host*/;
  alpnProtocols?: string[]; minVersion?: string; maxVersion?: string; timeoutMs?: number /*~10s*/;
  caCerts?: Buffer[]           // OPTIONAL extra trust anchors merged w/ system defaults for the VALIDATE verdict
  clientCert?: { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string } // already-resolved buffers (mTLS)
}
interface TlsInspectResult {
  ok: boolean; host: string; port: number; servername: string;
  protocol: string | null;                       // s.getProtocol()
  cipher: { name: string; standardName: string; version: string } | null;  // s.getCipher()
  alpnProtocol: string | false;                  // s.alpnProtocol
  authorized: boolean;                           // VALIDATE verdict — s.authorized (chain+hostname vs trust store)
  authorizationError?: string;                   // e.g. CERT_HAS_EXPIRED
  hostnameValid: boolean;                         // new X509Certificate(leaf.raw).checkHost(servername)
  chain: CertificateInfo[];                       // PRESENT — leaf-first; walk .issuerCertificate w/ self-ref guard
  selfSigned: boolean; expired: boolean; notYetValid: boolean; daysToExpiry: number;
  validityStatus: 'valid' | 'expiring' | 'expired';   // classifyExpiry(leaf.notAfter, now)
  error?: string;                                 // transport-level; ok=false
}
inspectTls(opts): Promise<TlsInspectResult>       // NEVER throws for a reachable-but-invalid cert
classifyExpiry(notAfter: string|Date, now: Date, warnDays = 30): 'valid'|'expiring'|'expired'
```

> **HIGH (see §6): present vs. validate.** To inspect bad/self-signed endpoints the probe uses `rejectUnauthorized:false`, and `getPeerCertificate(true)` returns whatever the server **presents** — not a validated chain. The engine MUST report an explicit trust verdict from `socket.authorized` + `authorizationError`, perform an explicit hostname/SAN match, and label every field "as presented by server" vs "independently validated". Never render a presented chain as trusted.

### 3.4 #65 — SAML

**Summary.** Sign SAML assertions/AuthnRequests via `xml-crypto` (already in tree for WSSE). Reuses the WSSE pattern exactly: a `keySource?: MaterialSource` resolved in main at `need:'pem'`, `privateKeyPem`/`certPem` populated before signing, only the signed XML returned. New `saml.engine.ts` + `saml.handler.ts`; shares `wsse.engine.ts`'s `createPrivateKey`/`X509Certificate` PEM handling.

- **Files:** `src/main/protocols/saml.engine.ts` (NEW); `src/main/ipc/saml.handler.ts` (NEW); `src/main/ipc/index.ts` (register); `src/preload/index.ts` (`window.api.saml.*`); `src/renderer/components/tools/SamlTool.tsx` (NEW).
- **IPC:** `saml:sign`, `saml:verify` (public-only).
- **Deps:** `xml-crypto` (reuse WSSE); `resolveKeyMaterial(...,'pem')`; `node:crypto`; `node:zlib`.

**Engine surface:** `buildAuthnRequest`/`buildAssertion`/`buildResponse` (pure XML builders); `signSaml(xml, config)` (enveloped XML-DSig, `ds:Signature` inserted immediately after `saml:Issuer`, Reference URI `#<ID>`, Transforms enveloped-signature + exc-c14n); `verifySaml(xml, certPem, options?)` → `{valid, reason?, signedReferences, certInfo?}` (trust anchor = caller-supplied `certPem`, never the KeyInfo-embedded cert; SignatureMethod allowlist RSA/ECDSA, HMAC rejected; Transforms allowlist; DTD/DOCTYPE disabled); `encodeRedirect`/`decodeRedirect` (raw DEFLATE + base64, inflated-size cap); `encodePost`/`decodePost` (base64 only).

> **HIGH (see §6): XML-DSig defaults.** Force RSA-SHA256 + SHA256 + exclusive-c14n explicitly (never rely on xml-crypto defaults, which are RSA-SHA1/SHA1). Assert Reference URI + Signature placement per SAML profile. Disable DTD/external entities on parse. Verify must validate exactly one Reference resolving to the signed element by ID and reject multi-signature/detached-wrapping (XSW) documents.

---

## 4. Decisions

| Topic | Decision | Rationale |
|---|---|---|
| **Crypto placement (in-main)** | All key-touching ops (sign/verify/JWE/SAML/WSSE/mTLS/JWK-private) live in main; renderer keeps only key-free decode/inspect. One code path, discriminated-union payload `{inline}\|{source}`. | Provider private keys must never reach the renderer (invariant 1); keeping renderer crypto for pasted keys AND adding a main path = the parity-bug class; and CSP `connect-src 'self'` forces JWKS verify into main regardless. |
| **jose ESM-in-main containment** | Add `'jose'` to `externalizeDepsPlugin({exclude:['uuid','jose']})` so Rollup bundles it ESM→CJS; restrict the jose IMPORT to the `need==='jwk'` branch — PEM/Buffer/keyObject stay on `node:crypto`. Verify with a BUILT app + `npm run test:e2e:smoke`, not bare node. | jose is `type:module` ESM-only; a runtime `require('jose')` on Electron 33's Node 20 = `ERR_REQUIRE_ESM` (v1.4.19 class). jose is pure WebCrypto (no `.node`, no undici/`node:sqlite` drag) so bundling is safe — unlike cheerio. System Node≥22 hides the crash, so only the packaged smoke gate proves it. |
| **Private-key extraction boundary** | Add `exportAliasPem()` INSIDE `keystore.ts` (node:crypto) rather than exporting `EntryModel`. The bridge consumes PEM/Buffer, never the raw model. | Keeps the keystore engine the only place a private key is materialized; preserves the no-leak discipline; avoids exposing the internal `KeyEntryModel` type. |
| **secp256k1 / Ed25519 revival** | Support **EdDSA (Ed25519)** for JOSE now (enum already lists it; jose supports it via KeyObject). Do NOT add secp256k1 (ES256K) unless a concrete SAML/JOSE consumer requires it. | Ed25519 is zero-marginal-cost. secp256k1 is niche, needs explicit jose opt-in, and would broaden the crypto surface with no grounded consumer. |
| **JWKS mock-serve** | NO mock JWKS server in this scope. Ship JWKS-URL **VERIFY** (main-side `createRemoteJWKSet` fetch, pick by `kid`) as a #63 consumer of #61 JWKs. A local JWKS-serving endpoint can be a Mock Server rule later. | Verify-against-JWKS is the enterprise story and the clean #61→#63 bridge; serving JWKS belongs to the mock subsystem, not the security suite. |
| **Runner R5 behavior change** | Route Runner/Test-Suite through the SAME exported `loadCertificatesFor` (call after `runner.handler.ts:1395`; throw on error, caught per-iteration). Ship as a documented release-note change with a Runner-path test for both file- and keystore-backed rows + a Send≡Run parity assertion. | Runner attaches NO client cert today; reusing `loadCertificatesFor` keeps keystore-awareness single-source and closes the parity class. It IS a behavior change (previously-unauthenticated Runner runs may now present a cert) so it must be announced. |
| **Double-password R11** | STORE password on the `keystores` row (`store_password`, encryptSecret; NULL=remember-off → `MaterialSource.storePassword` must be supplied or resolver fails loud); per-alias KEY password on the certificate row `passphrase` (encryptSecret). `exportAliasPem` takes `keyPassword` now but honors it only once the engine readers thread a distinct entry password. File a follow-up for distinct-password JKS/JCEKS. | Faz-0 readers (`parseJks`/`parsePkcs12`) open with ONE password, so a JKS whose entry pw ≠ store pw cannot be opened today. Landing the param without honoring it silently would fail; flag the limitation and gate distinct-password as a follow-up. |
| **R12 safety rails on keystore rows** | The resolver re-imposes rails keystore rows bypass: DB-blob branch caps decoded blob size (pre-decode) + validates it parses; file branch runs symlink-resolve + size cap with a keystore-AWARE extension whitelist adding `.jks/.keystore/.jceks`. Unit-test oversized/untrusted rejection. | Keystore-backed rows skip `readCertFile`'s `realpathSync`/whitelist/1 MiB cap entirely; without re-imposed rails a malicious DB row or ad-hoc file reintroduces the symlink/OOM surface. |
| **Single cert-attach function** | `loadCertificatesFor` is THE cert-attach function for both Send and Run. Add the keystore branch there, keep it exported, call it from `runner.handler`. Do not fork a Runner-only path. | Forking reintroduces the Send≡Run parity class; one function keeps file+keystore attach identical on both paths. |
| **Inline-first shipping** | Every consumer's IPC payload is a discriminated union `{inline}\|{source}` from day one; consumers ship inline-first and swap in `<KeyMaterialPicker>` when #60 lands. | KeyMaterialPicker/keystore-bridge don't exist yet; #63 sits in Faz 6 depending on Faz 5. Designing the union now unblocks #63/#64/#65 without hard-blocking on the full provider. |

---

## 5. Phasing (Faz 5-8, mapped to issues)

**Faz 5 — Provider + mTLS/WSSE (#60).**
1. **FIRST commit:** ALTER `certificates` + `helpers.ts` SCHEMA_SQL mirror + `certificate.repo` columns + `getCertificate(id)` — green before any wiring.
2. `exportAliasPem()` in `keystore.ts`.
3. `keystore-bridge.ts` `resolveKeyMaterial` (pem/buffer needs on node:crypto; jwk stubbed until Faz 6).
4. EDIT 1 — mTLS Send keystore branch.
5. EDIT 2 — Runner R5 via `loadCertificatesFor` (release-note behavior change + parity test).
6. EDIT 3 — WSSE keySource.
7. Resolver unit tests: each source × each need; oversized/untrusted keystore rejected; no-private-key-in-public-return; no-leak on handler responses.

**Faz 6 — JWK (#61) + JOSE (#63).**
1. In the SAME PR that first imports jose in main, flip `externalizeDepsPlugin` exclude to `['uuid','jose']` then `npm run build` + `npm run test:e2e:smoke` to prove no launch regression **BEFORE anything else lands.**
2. `jose.engine.ts` (pure, IPC-free) + `jose.handler.ts` (OTP-quadruple pattern) + preload + index registration.
3. Enable resolver jwk branch.
4. Move sign/verify/JWE tests to `tests/main`; trim `jwt.test.ts` to decode/inspect.
5. `JwtTool` Decode|Sign|Verify|JWS|JWE tabs, inline-first; adopt `KeyMaterialPicker`.
6. JWKS-URL verify as the #61→#63 bridge.
7. Update bigpicture-plan §3 stale 'decode-only' line.

**Faz 7 — SAML (#65).** `saml.engine.ts` + `saml.handler.ts` reusing xml-crypto and the WSSE keySource pattern (`need:'pem'`); `SamlTool` renderer; provider-sourced signing key, only signed XML returned.

**Parallel track (any time after Faz 5 schema lands) — TLS inspector (#64).** Public-only `tls.handler.ts` probe; no provider-private dependency, so it runs alongside Faz 5-7. Optional mutual-TLS client-cert attach reuses resolver `need:'buffer'`.

> Faz 8 in the roadmap numbering is reserved for follow-ups (distinct-password JKS engine threading, optional JWKS mock-serve, TLS deep checks) — none in this scope.

---

## 6. Risks & Mitigations (severity-sorted)

### BLOCKER — mTLS / TLS trust anchors (client chain vs CA anchors)

**Risk.** EDIT 1 and the resolver's `caCertBuffers` push the CLIENT certificate's chain intermediates into `certificates.caCerts`, which `http.engine.ts:1129` maps to `https.Agent({ ca })`. Node's `ca` option **REPLACES** the default root store for that agent — it is the trust anchor set used to validate the **SERVER's** certificate, not a place to stash the client chain. Result: with `rejectUnauthorized=true` the server cert is now validated only against the client's own intermediates → legitimate handshakes fail; or the trusted-root set is silently narrowed. Client-cert intermediates and CA trust anchors are orthogonal and must never be merged.
**Mitigation.** Do NOT route `chainPem` into `caCerts`. Send the client leaf+intermediates as a concatenated PEM bundle in `clientCert.cert` (what the server consumes for client-auth), and leave `ca` alone (system roots) unless the user explicitly supplies a server-trust CA. Add a test asserting a keystore-backed client cert to a public-root server still validates the server against system roots.

### HIGH — JOSE verify: alg confusion / `alg=none`

**Risk.** The design describes JWKS 'pick by kid' + `aud`/`iss`/`exp` checks but never states that main verify **pins** the permitted algorithm(s). If the engine derives `algorithms` from the token header (or omits the option), an attacker forges HS256 signed with the RSA/EC public key (RS→HS confusion) or presents `alg=none`. The only place this is currently guarded is the stale renderer `verifyJwt` (`jwt.ts:132` pins `algorithms:[algorithm]`, special-cases none) — exactly the code being relocated.
**Mitigation.** In `jose.engine` verify, ALWAYS pass an explicit `algorithms` allowlist bound to the resolved key type (symmetric→HS\*, RSA→RS/PS\*, EC→ES\*, OKP→EdDSA); reject if header alg not in it. Never accept `alg=none` unless the caller explicitly opts in. Negative tests: RSA pubkey + HS256 token → reject; `alg=none` token → reject unless opted in.

### HIGH — Runner behavior change (R5) ships client-cert auth to every host

**Risk.** Routing the runner through `loadCertificatesFor` turns on client-cert attachment for EVERY existing run, matched by host. Because keystore cert rows must carry a `host` (often `'*'`) to be selected, a wildcard row presents the client certificate AND its private-key-backed authentication to every host a collection touches — including third-party/public hosts that previously received nothing. This is silent client-identity exfiltration and can break runs. A 'documented release note' does not neutralize the data exposure.
**Mitigation.** Treat `host='*'` client-cert rows as opt-in per run, or warn/confirm when a run would present a client cert to a host outside the cert's explicit host scope. Discourage `'*'` for client-auth rows (fine for CA rows). Runner test proving a cert scoped to host A is NOT sent to host B in the same run, plus the Send≡Run parity assertion.

### HIGH — Double-password (R11): certRow→keystore recursion has no store password on remember-off

**Risk.** For a `certRow` whose `source='keystore'`, EDIT 1 recurses passing `keyPassword: decryptSecret(r.passphrase)` but supplies NO `storePassword`. The Faz-0 readers open the keystore with a SINGLE (store) password. So: (1) if `keystores.store_password` is NULL (remember-off), this path has no store password at all → always fails; (2) if store≠entry password, unopenable; (3) if the row passphrase is fed where the store password is expected, it 'works' only when they happen to be equal. The failure will look like a wrong-password error, not a config gap.
**Mitigation.** Make the store-password source explicit on the certRow→keystore path (thread `MaterialSource.storePassword` / prompt), and fail with a distinct, actionable error ('keystore store password required — remember-password is off') rather than a generic bad-password throw. Until the engine threads a real per-entry password, reject distinct-password keystores up front. Test the NULL `store_password` + certRow combination explicitly.

### HIGH — TLS inspector: trust vs presentation

**Risk.** To inspect endpoints with bad/self-signed certs the `tls.connect` must use `rejectUnauthorized:false`, and `getPeerCertificate(true)` returns whatever chain the server PRESENTS — not a validated one. The design lists 'validity, SANs, chain' but never mentions independent path validation, hostname/SAN matching, or surfacing `socket.authorized`/`authorizationError`. A user will read a rendered chain as 'trusted/valid' when it is attacker-controlled, self-signed, expired, or hostname-mismatched.
**Mitigation.** Report an explicit trust verdict from `socket.authorized` + `authorizationError`, perform an explicit hostname/SAN match (`tls.checkServerIdentity`) shown separately, and label every field 'as presented by server' vs 'independently validated'. Never render a presented chain as trusted. For the mutual-TLS client-cert reuse, apply the same `caCerts` fix as the blocker.

### HIGH — SAML XML-DSig

**Risk.** xml-crypto's historical defaults are RSA-SHA1 + SHA1, which modern IdPs/SPs reject; correctness depends on exclusive c14n, the enveloped-signature transform, a Reference URI matching the signed element's ID, and placing `<Signature>` right after `<Issuer>`. Parsing user-supplied XML invites XXE. A future verify side without strict single-Reference/ID validation is the classic signature-wrapping (XSW) bypass.
**Mitigation.** Force RSA-SHA256 + SHA256 digest + exclusive-c14n explicitly; assert Reference URI + Signature placement per SAML profile with a round-trip test against a known-good validator. Disable DTD/external entities. For verify: validate exactly one Reference resolving to the signed element by ID and reject multi-signature/detached-wrapping documents.

### MEDIUM — Send≡Run parity: `pm.sendRequest`

**Risk.** The design fixes the primary runner request loop but explicitly defers the `pm.sendRequest` junction (`runner.handler.ts:847` and its Send twin), which also bypasses cert attach. A script-issued request remains uncertified — a subtler parity gap.
**Mitigation.** Apply the same `loadCertificatesFor` call to the `pm.sendRequest` path on both Send and Run in the same change, OR explicitly document that scripted requests never attach client certs on either path (symmetric) — do not leave it asymmetric. Add a parity test covering `pm.sendRequest`.

### MEDIUM — No-leak invariant: inline path overclaim

**Risk.** 'The renderer never holds key bytes' is false for the inline/paste-PEM path every consumer ships first: the user pastes a private key/secret into a renderer textarea, it lives in renderer memory and crosses IPC as plaintext.
**Mitigation.** Scope the invariant precisely: provider paths never expose bytes; inline paths carry user-supplied bytes one-way and must be write-only (never persisted, echoed, or logged). Test that inline secrets are absent from stored `MaterialSource` and from any response.

### MEDIUM — No-leak: error/stack scrubbing

**Risk.** The guarantee depends on per-path manual scrubbing of every throw. `node:crypto` (wrong passphrase), `parseKeyStore` on bad bytes, and jose can throw messages containing passphrase-adjacent OpenSSL text, raw PEM fragments, or keystore bytes; a single unhandled bubble reaches the renderer via `{error}`.
**Mitigation.** Centralize a single scrub at the resolver/handler boundary (whitelist of safe error codes → generic messages), never pass raw crypto exception `.message`/`.stack` to the renderer, and add the no-leak test asserting NO response contains private-key/passphrase/keystore-byte substrings across every consumer.

### MEDIUM — Secure storage: plaintext-at-rest fallback

**Risk.** `encryptSecret`/`decryptSecret` fall back to plaintext when `safeStorage` is unavailable (e.g. Linux without a keyring). The suite now stores keystore STORE passwords and per-alias KEY passphrases through this wrapper — on those platforms the material guarding private keys sits in cleartext in SQLite.
**Mitigation.** Detect `safeStorage.isEncryptionAvailable()` and refuse to persist store/key passwords in plaintext (or loudly warn + require re-entry per session). Document the platform caveat. Gate 'remember password' behind real encryption being available.

### MEDIUM — Keystore parse DoS

**Risk.** A byte-size cap alone doesn't bound `parseKeyStore` cost; a crafted small keystore can expand/loop into heavy CPU/memory, DoSing the main process.
**Mitigation.** Enforce the size cap PRE-decode/pre-parse, and bound parse cost (entry count / time budget) with a fail-loud try/catch. Malicious-keystore unit test alongside the oversized-file test.

### MEDIUM — Runner fail-loud semantics

**Risk.** EDIT 2's 'throw on error' inside the sequential loop, if it escapes the per-iteration try/catch, aborts the ENTIRE run instead of failing just that request — worse than a silent skip, and it changes verdict accounting.
**Mitigation.** Ensure the throw is caught per-iteration and converted to a transport-failure verdict for that single request (fail that endpoint, continue the run) using the existing `endpointDidPass` single-source.

### LOW — ESM-in-main bundle (jose/SAML)

**Risk.** Correct fix (exclude jose from `externalizeDepsPlugin`, verify with built app + smoke). Residual: the exclude must land in the SAME PR as the first static import; jose relies on `globalThis.crypto` (must exist in Electron 33's Node 20 main); #65 could drag another ESM-only dep (xml-encryption/transitive) into main.
**Mitigation.** Flip the exclude in the same commit as the first import and gate merge on `npm run build` + `test:e2e:smoke` booting the packaged app. Confirm WebCrypto availability at startup. Re-run smoke when #65 adds deps.

### LOW — JWE decrypt oracle

**Risk.** RSA-OAEP and AES-CBC-HS decryption can form padding/decryption oracles if failures are differentiated. Low here (user-driven manual tool), and the design correctly avoids RSA1_5, but non-uniform error handling is a latent footgun if scripted.
**Mitigation.** Return a single uniform 'decryption failed' error for all JWE decrypt failures, rely on jose's constant-time internals, never expose RSA1_5.

### LOW — JWKS mock (out of scope)

**Risk.** Descoped. But a future JWKS-serving Mock Server rule is where private-key leakage would occur if a full JWK (with `d`/`p`/`q`/…) were served.
**Mitigation.** If/when JWKS-serve is added, serve public JWK only — strip all private members and assert it in a test. Keep it explicitly out of the security-suite provider scope.

---

## 7. Detailed Test Cases

> **Total: 153 cases.** Grouped per piece. Every case rendered in full (id / title / type / preconditions / steps / expected / notes).

### 7.0 Probe (harness sanity)

#### KM-01 — probe · _positive_
- **Steps:** a
- **Expected:** b

---

### 7.1 #61 JWK — PEM↔JWK, thumbprint, JWKS build, provider consumption, no-private-leak

**Narrative / scope.** #61 delivers three surfaces: (1) resolver branch `resolveKeyMaterial(source,'jwk')` materializing `publicJwk` (always) + `privateJwk` (main-only) from any `MaterialSource` via jose `importPKCS8`/`importX509`/`importSPKI` → `exportJWK`; (2) the renderer public-only tool `jwk.ts` (+ `JwkTool.tsx`) doing key-free PEM→public-JWK convert, RFC 7638 thumbprint, JWK create/update, and JWKS-document build; (3) IPC `jwk:fromPem`/`jwk:toPem`/`jwk:thumbprint` where the PRIVATE path runs in main and the renderer response is public-only. JWKS mock-SERVING is OUT of #61 scope; JWKS-URL VERIFY is #63. secp256k1/ES256K is NOT supported; EdDSA (Ed25519) IS.

**Assumed IPC contract:** `jwk:fromPem({ source, includePrivate? })` → `{ success, data:{ publicJwk, kid } }`. `privateJwk` returned to renderer ONLY when `source.kind==='inline'` AND `includePrivate===true`. Provider-backed sources strip `privateJwk` at the IPC boundary regardless of `includePrivate`. `jwk:toPem({ jwk, want:'spki'|'pkcs8' })`; `jwk:thumbprint({ jwk, hash?:'sha256' })`.

**Test-file placement:** `tests/main/keystore-bridge-jwk.test.ts` (resolver need:'jwk'); `tests/main/handlers/jwk.handler.test.ts` (IPC boundary, privateJwk stripping); `tests/renderer/tools/jwk.test.ts` (public-only renderer surface); `tests/main/keystore-bridge-jose-containment.test.ts` (ESM-in-main guard). Authoritative ERR_REQUIRE_ESM gate = `npm run build && npm run test:e2e:smoke` on the packaged app.

**Fixtures** (`tests/fixtures/certs/`, pw `testpassword`): RSA `client.crt`/`client.pkcs8.key`/`client.jks` (alias `test-client`); EC `ec-p256.*`/`ec-p384.*`/`client-ec.p12` (alias `ec-client`); public-only `truststore.jks` (alias `testca`); double-password `keytool-diffpass.jks` (alias `diffpass`, key pw `differentpass`); Ed25519 generated at runtime; RFC 7638 known-answer JWK whose SHA-256 thumbprint = `NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs`. Private members to scan: RSA `{d,p,q,dp,dq,qi}`, EC/OKP `{d}`, oct `{k}`.

#### JWK-01 — RSA cert PEM → public JWK (inline source) · _positive_
- **Preconditions:** resolver jwk branch + `jwk:fromPem` implemented. `RSA_CERT_PEM = read('client.crt')`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:RSA_CERT_PEM}, 'jwk')` (jose importX509 → exportJWK). 2) Read `publicJwk`.
- **Expected:** `publicJwk.kty==='RSA'`; `Object.keys(publicJwk).sort()===['e','kty','n']`; `n`,`e` non-empty base64url; no private members; `certPem` still populated; `keyPem` undefined.
- **Notes:** Baseline public-conversion path.

#### JWK-02 — RSA private PKCS#8 → private JWK (inline, includePrivate) · _positive_
- **Preconditions:** `RSA_PRIV_PEM = client.pkcs8.key`, `RSA_CERT_PEM = client.crt`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:RSA_CERT_PEM, keyPem:RSA_PRIV_PEM}, 'jwk')`. 2) Inspect `privateJwk`.
- **Expected:** `privateJwk` present with `{d,dp,dq,e,kty,n,p,q,qi}`; `publicJwk` present with only `{e,kty,n}`; `publicJwk.n===privateJwk.n` and `.e===.e`.
- **Notes:** Private material materialized ONLY in main; renderer exposure governed by JWK-15/16.

#### JWK-03 — EC P-256 cert → public JWK (byte lengths) · _positive_
- **Preconditions:** `EC256_CERT_PEM = ec-p256.crt`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:EC256_CERT_PEM}, 'jwk')`. 2) base64url-decode `x`,`y`.
- **Expected:** `kty==='EC'`, `crv==='P-256'`, keys sorted `['crv','kty','x','y']`; decoded `x`,`y` each 32 bytes; no `d`.

#### JWK-04 — EC P-384 cert → public JWK · _positive_
- **Preconditions:** `EC384_CERT_PEM = ec-p384.crt`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:EC384_CERT_PEM}, 'jwk')`. 2) decode `x`/`y`.
- **Expected:** `kty EC`, `crv 'P-384'`; decoded `x`,`y` each 48 bytes; no `d`.
- **Notes:** Second curve to prove `crv` isn't hard-coded.

#### JWK-05 — Ed25519 → public OKP JWK (EdDSA bonus) · _positive_
- **Preconditions:** runtime `generateKeyPair('EdDSA',{extractable:true})`; `ED_PRIV_PEM=exportPKCS8`, `ED_SPKI_PEM=exportSPKI`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:ED_SPKI_PEM, keyPem:ED_PRIV_PEM}, 'jwk')`. 2) Inspect public/private.
- **Expected:** `publicJwk==={crv:'Ed25519', kty:'OKP', x}` with NO `d`; `privateJwk` adds exactly one member `d`.
- **Notes:** Ed25519 zero-marginal-cost; secp256k1 excluded (JWK-22).

#### JWK-06 — jwk:toPem RSA public JWK → SPKI PEM equals original · _positive_
- **Preconditions:** `RSA_CERT_PEM`; publicJwk via JWK-01.
- **Steps:** 1) `originalSpki = exportSPKI(await importX509(RSA_CERT_PEM,'RS256'))`. 2) `jwk:toPem({jwk:publicJwk, want:'spki'})`. 3) Normalize + compare DER.
- **Expected:** Valid `BEGIN PUBLIC KEY` SPKI PEM whose DER equals `originalSpki` DER (lossless).

#### JWK-07 — jwk:toPem EC private JWK → PKCS#8 PEM (inline) · _positive_
- **Preconditions:** `EC256_PRIV_PEM = ec-p256.pkcs8.key`.
- **Steps:** 1) `privateJwk = exportJWK(await importPKCS8(EC256_PRIV_PEM,'ES256'))`. 2) `jwk:toPem({jwk:privateJwk, want:'pkcs8'})`. 3) Re-import + sign+verify a probe.
- **Expected:** Valid PKCS#8 PEM; signed probe verifies against the P-256 public key from the same JWK.
- **Notes:** Private toPem is a legitimate INLINE convenience; provider sources governed by JWK-15.

#### JWK-08 — RFC 7638 thumbprint known-answer (kid golden) · _positive_
- **Preconditions:** `RFC7638_JWK` = verbatim RFC 7638 §3.1 RSA public JWK.
- **Steps:** 1) `jwk:thumbprint({jwk:RFC7638_JWK, hash:'sha256'})`. 2) Compare to published vector.
- **Expected:** Exactly `NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs`. Deterministic and order-independent.

#### JWK-09 — JWK create/update — set kid/use/alg/key_ops · _positive_
- **Preconditions:** `publicJwk` (RSA) from JWK-01.
- **Steps:** 1) `kid = thumbprint(publicJwk)`. 2) `updated = updateJwk(publicJwk, {kid, use:'sig', alg:'RS256', key_ops:['verify']})`. 3) Inspect.
- **Expected:** `updated` has `kty/n/e` plus `kid===thumbprint`, `use==='sig'`, `alg==='RS256'`, `key_ops===['verify']`; `n`,`e` byte-identical; no private members.

#### JWK-10 — JWKS set build — assemble {keys:[...]} · _positive_
- **Preconditions:** two public JWKs: `rsaPub` (kid=k1), `ecPub` (kid=k2) with use/alg.
- **Steps:** 1) `jwks = buildJwks([rsaPub, ecPub])`. 2) `JSON.stringify` + re-parse.
- **Expected:** `jwks==={keys:[rsaPub, ecPub]}` (order preserved); valid JSON; each retains kid/use/alg; matches the shape `createLocalJWKSet` accepts.
- **Notes:** Building is in scope; serving is NOT (JWK-31).

#### JWK-11 — resolver need:'jwk' from keystore source (client.jks RSA) · _positive_
- **Preconditions:** MaterialSource `kind:'keystore'` → `client.jks`; storePassword `testpassword`, alias `test-client`; `exportAliasPem` wired.
- **Steps:** 1) `resolveKeyMaterial({kind:'keystore', keystoreId:<row>, alias:'test-client', storePassword:'testpassword'}, 'jwk')`. 2) Inspect.
- **Expected:** `certPem`+`keyPem` from `exportAliasPem`; `privateJwk` present (RSA, has `d`); `publicJwk` present `{e,kty,n}`; `publicJwk.n` matches importX509(client.crt) n (JWK-29). Runs in main.

#### JWK-12 — resolver need:'jwk' public-only keystore entry → privateJwk undefined · _positive_
- **Preconditions:** `kind:'keystore'` → `truststore.jks`, alias `testca` (TrustedCertificateEntry), storePassword `testpassword`.
- **Steps:** 1) `resolveKeyMaterial(...)`. 2) Check `privateJwk`/`keyPem`.
- **Expected:** `publicJwk` populated; `privateJwk===undefined` and `keyPem===undefined`. No throw.
- **Notes:** Guards against fabricating a private JWK when none exists.

#### JWK-13 — SECURITY: public JWK from private PEM contains NO private members · _security_
- **Preconditions:** `RSA_PRIV_PEM`, `EC256_PRIV_PEM`; public-convert path.
- **Steps:** 1) Derive PUBLIC JWK from RSA private PEM. 2) Same for EC P-256. 3) Scan public keys.
- **Expected:** RSA public has ONLY `{e,kty,n}`; EC public has ONLY `{crv,kty,x,y}`. Any private member = hard failure.
- **Notes:** The single most important assertion of #61.

#### JWK-14 — SECURITY: JWKS document never contains private members · _security_
- **Preconditions:** build JWKS from a MIX of public + a mistakenly-passed private JWK.
- **Steps:** 1) `buildJwks([rsaPublic, rsaPrivate])` where `rsaPrivate` carries `{d,p,q,...}`. 2) Deep-scan every key for `d/p/q/dp/dq/qi/k`.
- **Expected:** `buildJwks` EITHER rejects the private entry OR strips it to public projection; emitted `document.keys[*]` contains ZERO private members.

#### JWK-15 — SECURITY: provider source + includePrivate:true still public-only · _security_
- **Preconditions:** `jwk:fromPem` handler + contract. keystore source → `client.jks` alias `test-client`.
- **Steps:** 1) `jwk:fromPem({ source:{kind:'keystore', keystoreId:<row>, alias:'test-client', storePassword:'testpassword'}, includePrivate:true })`. 2) Inspect `response.data`.
- **Expected:** `success` true; `data` has `{publicJwk, kid}` and NO `privateJwk`, even with `includePrivate:true`. `includePrivate` honored ONLY for `kind==='inline'`.

#### JWK-16 — SECURITY: resolver privateJwk stripped at IPC boundary · _security_
- **Preconditions:** `jwk:fromPem` over a provider source yielding a private key (`client-ec.p12` alias `ec-client`).
- **Steps:** 1) Spy/stub resolver to confirm it DID produce a non-null `privateJwk` in main. 2) `jwk:fromPem({source:{kind:'keystore', ...ec-client}})`. 3) JSON-serialize the exact IPC payload the preload delivers and search.
- **Expected:** Serialized renderer-bound payload contains NO `d/p/q/dp/dq/qi` and no `privateJwk` — despite resolver materializing it internally.

#### JWK-17 — SECURITY: jose imported ONLY on need==='jwk' (ESM-in-main containment) · _security_
- **Preconditions:** `externalizeDepsPlugin({exclude:['uuid','jose']})`. Containment unit + packaged smoke.
- **Steps:** 1) Unit: `vi.mock('jose', ...)` tracker; call resolver for `(inline,'pem')`, `(inline,'buffer')`, `(inline,'keyObject')` — assert jose NEVER imported; then `(inline,'jwk')` — assert it WAS. 2) Packaged: `npm run build && npm run test:e2e:smoke`.
- **Expected:** Non-jwk needs perform zero jose access; jwk branch lazily imports jose. Packaged smoke launches with NO ERR_REQUIRE_ESM. Green bare-node run is NOT proof.

#### JWK-18 — SECURITY: symmetric/oct secret never becomes a published JWK · _security_
- **Preconditions:** an HMAC secret string and/or an oct JWK.
- **Steps:** 1) `jwk:fromPem({source:{kind:'inline', certPem:'my-hmac-secret'}})` (raw secret). 2) `buildJwks([{kty:'oct', k:'c2VjcmV0'}, rsaPublic])`.
- **Expected:** fromPem rejects the non-PEM secret with a clear error; buildJwks rejects/excludes the oct entry; published document contains no `k`.

#### JWK-19 — SECURITY: thumbprint depends only on RFC 7638 required members · _security_
- **Preconditions:** RSA privateJwk (JWK-02) + its public projection.
- **Steps:** 1) `tpPriv = thumbprint(privateJwk)`; `tpPub = thumbprint(publicJwk)`. 2) thumbprint on public JWK after adding kid/use/alg/key_ops (JWK-09 output).
- **Expected:** `tpPriv===tpPub` (private members don't affect kid) and both equal the thumbprint after metadata attach. Canonicalization uses only required members.

#### JWK-20 — SECURITY/NEGATIVE: wrong store password on keystore source fails loud · _security_
- **Preconditions:** keystore source → `client.jks`, alias `test-client`, wrong storePassword `nope`.
- **Steps:** 1) `resolveKeyMaterial({kind:'keystore', ..., storePassword:'nope'}, 'jwk')` (and via `jwk:fromPem`).
- **Expected:** Throws / `{success:false,error}` with a keystore-decrypt message. NO publicJwk, NO privateJwk, no partial object.

#### JWK-21 — NEGATIVE: encrypted PKCS#8 without passphrase fails loud · _negative_
- **Preconditions:** encrypted PKCS#8 PEM, no passphrase.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:CERT, keyPem:ENCRYPTED_PKCS8}, 'jwk')` with passphrase undefined.
- **Expected:** Throws (passphrase-required); with correct passphrase the same call succeeds and yields `privateJwk`.

#### JWK-22 — SECURITY: secp256k1 / ES256K rejected (surface excluded) · _security_
- **Preconditions:** a secp256k1 private key PEM.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:SECP256K1_CERT, keyPem:SECP256K1_KEY}, 'jwk')` and `jwk:fromPem`.
- **Expected:** Rejected with explicit 'unsupported curve/algorithm' — NOT silently converted.

#### JWK-23 — NEGATIVE: malformed / garbage PEM → error, not silent-empty · _negative_
- **Preconditions:** inputs `''`, `'not-a-pem'`, truncated PEM, valid header wrapping non-DER base64.
- **Steps:** 1) `jwk:fromPem`/resolver with each malformed input.
- **Expected:** Each `{success:false,error}` (or throws surfaced as `{error}`); never `{success:true}` with an empty/fabricated JWK.

#### JWK-24 — NEGATIVE: kty/alg mismatch on toPem rejected · _negative_
- **Preconditions:** EC P-256 public JWK carrying `alg:'RS256'`.
- **Steps:** 1) `jwk:toPem({jwk:{kty:'EC', crv:'P-256', x, y, alg:'RS256'}, want:'spki'})`.
- **Expected:** Rejected with algorithm/kty-mismatch error (jose importJWK refuses).

#### JWK-25 — NEGATIVE: JWK missing a required member rejected · _negative_
- **Preconditions:** RSA JWK missing `n`; EC missing `y`; OKP missing `x`.
- **Steps:** 1) `jwk:toPem` and `jwk:thumbprint` on each.
- **Expected:** Both reject 'missing required member'; thumbprint must NOT hash a partial member set.

#### JWK-26 — SECURITY/NEGATIVE: NULL store_password with no source.storePassword throws (R11) · _security_
- **Preconditions:** keystore row with `store_password` NULL (remember-off); MaterialSource omits storePassword.
- **Steps:** 1) `resolveKeyMaterial({kind:'keystore', keystoreId:<null-pw row>, alias:'test-client'}, 'jwk')`.
- **Expected:** Throws 'store password required' BEFORE touching bytes; no JWK; no empty-password attempt.

#### JWK-27 — INTEROP: resolved publicJwk verifies a JWS signed by matching private key · _interop_
- **Preconditions:** keystore source `client.jks` (JWK-11) yields private+public; jose available.
- **Steps:** 1) `token = new SignJWT({sub:'x'}).setProtectedHeader({alg:'RS256'}).sign(await importJWK(privateJwk,'RS256'))`. 2) `await jwtVerify(token, await importJWK(publicJwk,'RS256'))`.
- **Expected:** Verification succeeds, payload `{sub:'x'}`. The pair is cryptographically consistent.

#### JWK-28 — INTEROP: JWKS build → createLocalJWKSet → verify picks by kid · _interop_
- **Preconditions:** two RSA pairs A (kid=kA), B (kid=kB); public JWKs via buildJwks.
- **Steps:** 1) `jwks = buildJwks([pubA_with_kid, pubB_with_kid])`. 2) Sign token with private A, header `{alg:'RS256', kid:kA}`. 3) `jwtVerify(token, createLocalJWKSet(jwks))`. 4) Tamper header kid→kB, re-verify.
- **Expected:** First verify succeeds (selects A by kid); after kid→kB, verification FAILS.

#### JWK-29 — INTEROP: keytool JKS public JWK == importX509(client.crt) JWK · _interop_
- **Preconditions:** `client.jks` (alias `test-client`) and `client.crt` are the SAME pair.
- **Steps:** 1) `jwksFromJks = publicJwk of resolveKeyMaterial({kind:'keystore', ...test-client}, 'jwk')`. 2) `jwkFromCert = exportJWK(await importX509(read('client.crt'),'RS256'))`.
- **Expected:** `jwksFromJks.n===jwkFromCert.n` and `.e===.e`; `thumbprint(jwksFromJks)===thumbprint(jwkFromCert)`.

#### JWK-30 — EDGE: distinct entry-vs-store password JKS fails loud (R11 limitation) · _edge_
- **Preconditions:** `keytool-diffpass.jks`: alias `diffpass`, key pw `differentpass` ≠ store pw `testpassword`.
- **Steps:** 1) `resolveKeyMaterial({kind:'keystore', keystoreId:<row>, alias:'diffpass', storePassword:'testpassword', keyPassword:'differentpass'}, 'jwk')`.
- **Expected:** Fails with a clear, non-crashing error explicit about the distinct-password limitation — NOT a silent-empty JWK or opaque throw.
- **Notes:** `keyPassword` landed but not yet honored — assert the honest failure.

#### JWK-31 — EDGE: JWKS mock-SERVE out of #61 scope (build-only) · _edge_
- **Preconditions:** #61 registers `jwk:*` IPC only; no HTTP endpoint.
- **Steps:** 1) Enumerate registered IPC channels after `registerAllHandlers` and grep the Mock Server route table. 2) Confirm buildJwks output COULD be served but no route is auto-created.
- **Expected:** No `/.well-known/jwks.json` endpoint created by #61; only `jwk:fromPem/toPem/thumbprint` exist.

#### JWK-32 — EDGE: JWKS build with duplicate kids and many keys · _edge_
- **Preconditions:** input with two JWKs sharing kid `k1` plus 30 unique-kid keys.
- **Steps:** 1) `jwks = buildJwks([pubA(kid:k1), pubB(kid:k1), ...30 more])`. 2) Inspect keys array.
- **Expected:** All entries preserved (RFC 7517 permits duplicate kid); order stable; public-only; large sets serialize without truncation. Any duplicate-kid warning is advisory, not a drop.

---

### 7.2 #63 JOSE/JWT full

**Fixtures & placement.** Five test files: (1) `tests/main/jose-engine.test.ts` — pure engine round-trips + ALL crypto negatives, deterministic via explicit `currentDate`; (2) `tests/main/jose-jwks.test.ts` — hermetic JWKS-URL verify against an ephemeral `node:http` server; (3) `tests/main/handlers/jose.handler.test.ts` — IPC envelope + PROVIDER sourcing + no-leak, with seeded `keystores` + `certificate source='keystore'` rows; (4) `tests/renderer/tools/jwt-structural.test.ts` — renderer decode/inspect + structural JWS/JWE header parse + architectural "sign/verify/generateSample removed" guard; (5) `tests/e2e/jose.spec.ts` — playwright ESM-in-main containment gate on the BUILT app.

Reuse `tests/fixtures/certs`: `client.pkcs8.key`+`client.crt` (RS/PS/RSA-OAEP), `ec-p256.*` (ES256/ECDH-ES), `ec-p384.*` (ES384), `client.jks` (alias `test-client`, pw `testpassword`), `client.p12`, `keytool-diffpass.jks`, `bad.p12`. Generated in-test: Ed25519, P-521 (ES512), 32-byte symmetric (`dir`), JWKS JSON.

**Expected jose v6 error identities:** `JWTExpired`, `JWTClaimValidationFailed`, `JOSEAlgNotAllowed`, `JWSSignatureVerificationFailed`, `JWEDecryptionFailed`, `JWKSNoMatchingKey`, `JOSENotSupported`.

#### JOSE-001 — HS256 sign→verify round-trip is valid · _positive_
- **Preconditions:** `jose.engine.ts` present; HS secret ≥32 bytes.
- **Steps:** 1) `secret='hs256-shared-secret-at-least-256-bits-long!!'`. 2) `token = await signJwt({payload:{sub:'alice',role:'admin'}, protectedHeader:{alg:'HS256'}, key:enc(secret)})`. 3) `result = await verifyJwt({token, key:enc(secret), algorithms:['HS256'], currentDate:new Date(FIXED_NOW*1000)})`.
- **Expected:** 3-segment compact JWS. verifyJwt resolves; `result.protectedHeader.alg==='HS256'`; `payload.sub==='alice'`, `role==='admin'`.

#### JOSE-002 — HS384/HS512 round-trip (parametrized) · _positive_
- **Steps:** 1) `it.each(['HS384','HS512'])`: sign then verify with `algorithms:[alg]`.
- **Expected:** Each signs+verifies; `protectedHeader.alg` matches; payload round-trips.

#### JOSE-003 — HS verify with wrong secret fails · _negative_
- **Steps:** 1) sign with `enc('correct-secret-...')`. 2) `verifyJwt({token, key:enc('WRONG-secret-...'), algorithms:['HS256'], currentDate})`.
- **Expected:** Throws `JWSSignatureVerificationFailed`. No payload.

#### JOSE-004 — RS256 round-trip with fixture RSA key/cert · _positive_
- **Preconditions:** `client.pkcs8.key` + `client.crt`.
- **Steps:** 1) `priv=createPrivateKey(...)`, `pub=new X509Certificate(...).publicKey`. 2) sign RS256. 3) verify with `algorithms:['RS256']`.
- **Expected:** Resolves; `alg==='RS256'`; `payload.sub==='svc'`.

#### JOSE-005 — RS384/RS512 round-trip (parametrized) · _positive_
- **Steps:** 1) `it.each(['RS384','RS512'])` sign+verify with cert public key.
- **Expected:** Both sign+verify; alg header matches.

#### JOSE-006 — PS256 round-trip with same RSA key · _positive_
- **Steps:** 1) sign PS256 with `rsaPriv`. 2) verify with `rsaPub`, `algorithms:['PS256']`.
- **Expected:** Resolves; `alg==='PS256'`. Same RSA material, distinct alg.

#### JOSE-007 — PS384/PS512 round-trip (parametrized) · _positive_
- **Steps:** 1) `it.each(['PS384','PS512'])` sign+verify with RSA fixture.
- **Expected:** Both round-trip; alg matches.

#### JOSE-008 — ES256 round-trip with P-256 fixture · _positive_
- **Preconditions:** `ec-p256.pkcs8.key` + `ec-p256.crt`.
- **Steps:** 1) sign ES256. 2) verify with P-256 cert public key.
- **Expected:** Resolves; `alg==='ES256'`; 64-byte R||S validates.

#### JOSE-009 — ES384 round-trip with P-384 fixture · _positive_
- **Preconditions:** `ec-p384.*`.
- **Steps:** 1) sign ES384. 2) verify `algorithms:['ES384']`.
- **Expected:** Round-trips; `alg==='ES384'`. Guards curve↔alg hard-code.

#### JOSE-010 — ES512 round-trip with generated P-521 key · _positive_
- **Steps:** 1) `{privateKey,publicKey}=await generateKey('ES512')`. 2) sign ES512. 3) verify.
- **Expected:** Round-trips; `alg==='ES512'`.

#### JOSE-011 — EdDSA (Ed25519) round-trip — design bonus · _positive_
- **Steps:** 1) `crypto.generateKeyPairSync('ed25519')`. 2) sign EdDSA. 3) verify `algorithms:['EdDSA']`.
- **Expected:** Round-trips; `alg==='EdDSA'`. Ed25519 KeyObject flows through with zero special-casing.

#### JOSE-012 — Expired token (exp in past) rejected · _negative_
- **Steps:** 1) sign `{sub:'x', exp:1000}`. 2) `verifyJwt({..., currentDate:new Date(FIXED_NOW*1000)})` with `FIXED_NOW ≫ 1000`.
- **Expected:** Rejects `JWTExpired`. Never returns a payload.

#### JOSE-013 — Expired token within clockTolerance passes · _edge_
- **Steps:** 1) `FIXED_NOW=1_000_000_000`; token `exp=FIXED_NOW-30`. 2) `verifyJwt({..., clockTolerance:60, currentDate})`.
- **Expected:** Resolves (30s inside 60s skew). With `clockTolerance:10` (or default 0) → `JWTExpired`.

#### JOSE-014 — Not-before (nbf in future) rejected · _negative_
- **Steps:** 1) token `nbf=FIXED_NOW+3600`. 2) `verifyJwt({..., currentDate})`.
- **Expected:** Rejects `JWTClaimValidationFailed` (nbf); advancing currentDate past nbf resolves.

#### JOSE-015 — Audience (aud) enforced — match passes, mismatch rejected · _negative_
- **Steps:** 1) token `aud='api://payments'`. 2) PASS: `audience:'api://payments'`. 3) FAIL: `audience:'api://other'`.
- **Expected:** Match resolves; mismatch throws `JWTClaimValidationFailed`. No `audience` supplied ⇒ aud NOT checked (assert too — enforcement is opt-in).

#### JOSE-016 — Issuer (iss) enforced — match passes, mismatch rejected · _negative_
- **Steps:** 1) token `iss='https://idp.example.com'`. 2) PASS matching issuer. 3) FAIL `issuer:'https://evil.example.com'`.
- **Expected:** Match resolves; mismatch throws `JWTClaimValidationFailed`.

#### JOSE-017 — maxTokenAge rejects a too-old iat · _edge_
- **Steps:** 1) token `iat=FIXED_NOW-7200`, no exp. 2) `verifyJwt({..., maxTokenAge:'1h', currentDate})`.
- **Expected:** Rejects `JWTClaimValidationFailed` (iat/maxTokenAge). With `maxTokenAge:'3h'` resolves.

#### JOSE-018 — JWS compact sign→verify over arbitrary bytes (ES256) · _positive_
- **Steps:** 1) `payload=enc('detached-or-attached-content')`. 2) `jwsSign({payload, protectedHeader:{alg:'ES256'}, key:ecP256Priv})`. 3) `jwsVerify({jws, key:ecP256Pub, algorithms:['ES256']})`.
- **Expected:** 3-segment compact with non-empty payload; verify resolves; decoded payload equals the content.

#### JOSE-019 — JWS with detached payload signs and verifies · _positive_
- **Steps:** 1) `payload=enc('contract-body-v1')`. 2) `det=await jwsSign({..., key:rsaPriv, detached:true})`. 3) `jwsVerify({jws:det, key:rsaPub, algorithms:['RS256'], detachedPayload:payload})`.
- **Expected:** `det` omits payload (empty middle segment / no `payload` prop); verify with `detachedPayload` resolves; verify WITHOUT it throws.

#### JOSE-020 — Detached JWS verify with WRONG payload fails · _security_
- **Steps:** 1) `det=await jwsSign({payload:enc('contract-body-v1'), ..., detached:true})`. 2) `jwsVerify({jws:det, ..., detachedPayload:enc('contract-body-v2')})`.
- **Expected:** Rejects `JWSSignatureVerificationFailed`. Detached content is genuinely bound.

#### JOSE-021 — JWE RSA-OAEP + A256GCM encrypt→decrypt round-trip · _positive_
- **Steps:** 1) `jwe=await jweEncrypt({plaintext:enc('{"card":"4111..."}'), protectedHeader:{alg:'RSA-OAEP', enc:'A256GCM'}, key:rsaPub})`. 2) `jweDecrypt({jwe, key:rsaPriv})`.
- **Expected:** 5-segment compact JWE; decrypt resolves; plaintext equals original; `alg==='RSA-OAEP'`, `enc==='A256GCM'`.

#### JOSE-022 — JWE ECDH-ES + A128GCM round-trip (EC keys) · _positive_
- **Steps:** 1) `jweEncrypt({..., protectedHeader:{alg:'ECDH-ES', enc:'A128GCM'}, key:ecP256Pub})`. 2) `jweDecrypt({jwe, key:ecP256Priv})`.
- **Expected:** Round-trips; header includes ephemeral `epk` and `alg==='ECDH-ES'`; plaintext exact.

#### JOSE-023 — JWE dir + A256GCM round-trip (symmetric key) · _positive_
- **Steps:** 1) `cek=crypto.randomBytes(32)`. 2) `jweEncrypt({..., protectedHeader:{alg:'dir', enc:'A256GCM'}, key:cek})`. 3) `jweDecrypt({jwe, key:cek})`.
- **Expected:** Round-trips; `alg==='dir'`; encrypted-key segment EMPTY; plaintext recovered.

#### JOSE-024 — JWE decrypt with wrong private key fails · _negative_
- **Steps:** 1) encrypt to `rsaPub`. 2) `jweDecrypt({jwe, key:otherPriv})` (different RSA key).
- **Expected:** Rejects `JWEDecryptionFailed`. Generic error (no oracle).

#### JOSE-025 — Tampered JWE ciphertext/tag fails GCM auth · _security_
- **Steps:** 1) encrypt `'balance:1000'` RSA-OAEP/A256GCM. 2) flip a char in `parts[3]` (ciphertext) → decrypt. 3) flip `parts[4]` (tag) → decrypt.
- **Expected:** Both reject `JWEDecryptionFailed` — GCM auth tag mismatch. Integrity enforced.

#### JOSE-026 — JWE `dir` with wrong-size key rejected at encrypt · _edge_
- **Steps:** 1) `cek16=crypto.randomBytes(16)`. 2) `jweEncrypt({..., enc:'A256GCM', key:cek16})`.
- **Expected:** Encrypt throws (16 bytes incompatible with A256GCM's 32) — no silent truncation.

#### JOSE-027 — SECURITY: alg='none' token rejected on verify · _security_
- **Preconditions:** craft an unsecured JWS manually.
- **Steps:** 1) `noneToken = b64url('{"alg":"none","typ":"JWT"}') + '.' + b64url('{"sub":"admin","role":"root"}') + '.'`. 2) `verifyJwt({token:noneToken, key:secretBytes, algorithms:['HS256'], currentDate})`. 3) also with `key:rsaPub, algorithms:['RS256']`.
- **Expected:** BOTH reject — `JOSEAlgNotAllowed`. verifyJwt NEVER returns valid for an unsigned token.

#### JOSE-028 — SECURITY: RS↔HS algorithm-confusion rejected · _security_
- **Preconditions:** server verifies RS256 with an RSA public key; attacker knows the public key.
- **Steps:** 1) `pubPem=readFileSync('client.crt','utf8')`. 2) `forged=await signJwt({payload:{sub:'attacker',admin:true}, protectedHeader:{alg:'HS256'}, key:enc(pubPem)})`. 3) `verifyJwt({token:forged, key:createPublicKey(pubPem), algorithms:['RS256'], currentDate})`.
- **Expected:** Rejects `JOSEAlgNotAllowed` — pinned `['RS256']` excludes HS256; jose refuses a public KeyObject for HMAC. Not accepted.

#### JOSE-029 — SECURITY: verify REQUIRES explicit algorithms allowlist · _security_
- **Steps:** 1) sign HS256. 2) CASE A engine: `verifyJwt({..., algorithms:[]})` (or omitted). 3) CASE B handler: `jose:verify` with no `algorithms`.
- **Expected:** CASE A throws (algorithms required, non-empty) — engine NEVER derives from `header.alg`. CASE B `{success:false, error:/algorithms.*required/}`.

#### JOSE-030 — Key×alg mismatch: signing ES256 with RSA key throws · _negative_
- **Steps:** 1) `rsaPriv=createPrivateKey('client.pkcs8.key')`. 2) `signJwt({protectedHeader:{alg:'ES256'}, key:rsaPriv})`.
- **Expected:** Sign throws (JOSENotSupported/TypeError). No token.

#### JOSE-031 — Key×alg mismatch: signing RS256 with EC key throws · _negative_
- **Steps:** 1) `ecPriv=createPrivateKey('ec-p256.pkcs8.key')`. 2) `signJwt({protectedHeader:{alg:'RS256'}, key:ecPriv})`.
- **Expected:** Sign throws. No token.

#### JOSE-032 — SECURITY: tampered signature fails verification · _security_
- **Steps:** 1) sign RS256. 2) flip last non-'=' char of `parts[2]` → verify.
- **Expected:** Rejects `JWSSignatureVerificationFailed`.

#### JOSE-033 — SECURITY: tampered payload with original signature fails · _security_
- **Steps:** 1) sign HS256 `{sub:'user',role:'guest'}`. 2) `parts[1]=b64url('{"sub":"user","role":"admin"}')` → verify.
- **Expected:** Rejects `JWSSignatureVerificationFailed`. The `role:admin` forgery not accepted.

#### JOSE-034 — Verify with a different (wrong) public key fails · _negative_
- **Steps:** 1) sign with `client.pkcs8.key`. 2) `wrongPub=new X509Certificate('server.crt').publicKey`; verify.
- **Expected:** Rejects `JWSSignatureVerificationFailed`. Key-bound.

#### JOSE-035 — SECURITY/scope: ES256K (secp256k1) unsupported · _security_
- **Steps:** 1) `ecPriv=crypto.generateKeyPairSync('ec',{namedCurve:'secp256k1'}).privateKey`. 2) `signJwt({protectedHeader:{alg:'ES256K'}, key:ecPriv})`. 3) also via handler.
- **Expected:** Engine throws `JOSENotSupported`; handler `{success:false}`.

#### JOSE-036 — PROVIDER: jose:sign with keystore-sourced key produces valid token · _interop_
- **Preconditions:** seed `keystores` row from `client.jks` (store_password=`enc:testpassword`) + `certificate` row `source='keystore'`, `keystore_alias='test-client'`.
- **Steps:** 1) `harness.invoke('jose:sign', {alg:'RS256', payload:{sub:'svc'}, key:{source:{kind:'keystore', keystoreId, alias:'test-client', storePassword:'testpassword'}}})`. 2) verify `res.data.token` against the alias public cert, `algorithms:['RS256']`.
- **Expected:** `success===true`; token validates against `test-client`'s public key. Private key materialized only in main.

#### JOSE-037 — SECURITY: provider private key never crosses back to renderer · _security_
- **Preconditions:** same seeding as JOSE-036.
- **Steps:** 1) `res = harness.invoke('jose:sign', {..., key:{source:{kind:'keystore', ...}}})`. 2) `blob=JSON.stringify(res)`.
- **Expected:** `res.data` has ONLY `{token}` (+ maybe protectedHeader) — no keyPem/privateJwk/privateKeyObject/passphrase/storePassword. `blob` contains none of `BEGIN PRIVATE KEY`/`BEGIN RSA PRIVATE KEY`/`BEGIN EC PRIVATE KEY`/the store password/the resolved PEM.

#### JOSE-038 — SECURITY: wrong store password fails LOUD (not silent-empty) · _security_
- **Steps:** 1) `harness.invoke('jose:sign', {..., key:{source:{kind:'keystore', ..., storePassword:'WRONG'}}})`.
- **Expected:** `success===false`, non-empty `error`; `data` undefined. Never `{success:true, token:<unsigned>}`.

#### JOSE-039 — NULL keystore.store_password with no source.storePassword rejects · _negative_
- **Preconditions:** seed a `keystores` row whose `store_password` IS NULL.
- **Steps:** 1) `harness.invoke('jose:sign', {..., key:{source:{kind:'keystore', keystoreId, alias:'test-client'}}})` (no storePassword).
- **Expected:** `success===false`; error references missing store password. Supplying `storePassword:'testpassword'` succeeds (sanity pair).

#### JOSE-040 — SECURITY: file keySource re-imposes R12 rails · _security_
- **Steps:** 1) A) `keyPath:'<symlink→/etc/passwd>'`. 2) B) `keyPath:'<2 MiB junk>'`. 3) C) `keyPath:'client.pkcs8.key.notallowed-ext'`.
- **Expected:** All three `success===false` (symlink resolved & rejected / size cap / extension not in keystore-aware whitelist).

#### JOSE-041 — JWKS-URL verify picks key by kid and validates · _interop_
- **Preconditions:** ephemeral http server serving `{keys:[jwkWithKid]}` from an in-test RS256 pair.
- **Steps:** 1) `jwk=exportJWK(publicKey)`, `kid=calculateJwkThumbprint(jwk)`, `jwk.kid=kid`. 2) serve JWKS. 3) sign token header `{alg:'RS256', kid}`. 4) `jwksVerify({token, jwksUri, algorithms:['RS256']})`.
- **Expected:** Resolves (fetched MAIN-side, selected by kid, verified); `payload.sub==='u'`.

#### JOSE-042 — JWKS verify with kid absent from set rejected · _negative_
- **Steps:** 1) token header `{alg:'RS256', kid:'not-in-jwks'}`. 2) `jwksVerify(...)`.
- **Expected:** Rejects `JWKSNoMatchingKey`. No fallback.

#### JOSE-043 — SECURITY: JWKS verify pins algorithms · _security_
- **Steps:** 1) `forged=await signJwt({payload:{admin:true}, protectedHeader:{alg:'HS256', kid}, key:enc(JSON.stringify(jwk))})`. 2) `jwksVerify({token:forged, jwksUri, algorithms:['RS256']})`.
- **Expected:** Rejects `JOSEAlgNotAllowed`. Cannot downgrade to HMAC.

#### JOSE-044 — jose:generateKey yields usable material for a full round-trip · _positive_
- **Steps:** 1) `gen=harness.invoke('jose:generateKey', {alg:'RS256'})`. 2) sign with the returned private half via `jose:sign key:{inline:{privateKeyPem}}`, then `jose:verify` with the public half.
- **Expected:** `success===true`; round-trips. An ephemeral user-requested pair MAY return to renderer; a PROVIDER private key (JOSE-037) MUST NOT — assert both halves.

#### JOSE-045 — Renderer decode/inspect still works with no key · _positive_
- **Steps:** 1) `r=decodeJwt('eyJhbGci...SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c')`.
- **Expected:** `r.ok===true`; `r.jwt.header.alg==='HS256'`; `r.jwt.payload.sub==='1234567890'`.

#### JOSE-046 — Renderer no longer exports key-touching crypto ops · _edge_
- **Steps:** 1) `import * as jwt from '.../jwt'`; assert `typeof jwt.signJwt/.verifyJwt/.generateSampleJwt`.
- **Expected:** All three `undefined`. `decodeJwt/isExpired/humanReadableClaims/claimsToTable` remain exported.

#### JOSE-047 — Renderer structural JWE header parse without decrypting · _edge_
- **Steps:** 1) build a 5-segment compact JWE. 2) `hdr = parseJoseHeader(jwe)`.
- **Expected:** Returns `{alg:'RSA-OAEP', enc:'A256GCM'}` WITHOUT decryption/key; recognizes 5 segments = JWE vs 3 = JWS; no crypto import pulled into renderer.

#### JOSE-048 — BUILT-APP smoke: jose:sign round-trips through real bridge · _security_
- **Preconditions:** `npm run build`; `tests/e2e/jose.spec.ts` launches the packaged main bundle.
- **Steps:** 1) launch built app. 2) `window.api.jose.sign({alg:'HS256', payload:{sub:'e2e'}, key:{inline:{secret:'e2e-secret-...'}}})`. 3) `window.api.jose.verify({token, algorithms:['HS256'], key:{inline:{secret}}})`.
- **Expected:** App LAUNCHES (no ERR_REQUIRE_ESM); `token.success===true` and `res.data.valid===true`. The only gate proving jose was bundled ESM→CJS.

#### JOSE-049 — Main bundle inlines jose (no bare require('jose')) · _edge_
- **Preconditions:** `externalizeDepsPlugin({exclude:['uuid','jose']})`; `npm run build` done.
- **Steps:** 1) read `out/main/index.js`. 2) grep for top-level `require("jose")`/`require('jose')`.
- **Expected:** No un-inlined `require("jose")` remains. The resolver jose import appears ONLY on the `need==='jwk'` branch (dynamic import).

---

### 7.3 #64 TLS Inspector

**Fixtures & placement.** Test files: `tests/main/tls-inspect-engine.test.ts` (engine vs local `tls.createServer`), `tests/main/handlers/tls.test.ts` (`tls:inspect` envelope + clientCert MaterialSource, secret-never-leaks), `tests/main/tls-expiry-classify.test.ts` (pure `classifyExpiry` bands), `tests/main/tls-add-trusted.test.ts` (inspect→keystore trusted-cert import round-trip), and a recommended (non-gate) `tests/e2e/ui/tur1/tls-inspector.spec.ts`.

Committed fixtures: `ca.crt`/`ca.key` (self-signed root), `server.crt`/`server.key` (CA-issued leaf, CN=localhost, SAN localhost/127.0.0.1/::1), `selfsigned.crt/.key` (no SAN), `client.p12`/`client.crt`/`client.key`. Time-sensitive certs MINTED AT RUNTIME with node-forge via `mintCert({cn, sans, notBefore, notAfter, caCrt?, caKey?, basicConstraintsCa?})`. Helper `startLocalTls({...})` binds `tls.createServer` to `127.0.0.1:0`, closed in afterEach/afterAll. Inject `now` into `classifyExpiry` — never read `Date.now()` in an assertion. Against the local CA-issued server the SYSTEM verdict is `authorized=false` UNLESS `caCerts:[ca.crt]` is passed — the core present-vs-validate lever.

#### TLS-001 — Live endpoint chain retrieval — leaf-first, full chain, fields populated · _positive_
- **Preconditions:** `startLocalTls({cert: server.crt+ca.crt (fullchain), key: server.key})`.
- **Steps:** 1) `inspectTls({host:'127.0.0.1', port:PORT, servername:'localhost'})`. 2) Inspect `chain`.
- **Expected:** `ok===true`. `chain.length===2` (leaf-first): `chain[0].subjectDN` contains `CN=localhost`, `chain[1]` contains `CN=Testnizer Test CA`. `chain[0]` carries every `buildCertificateInfo` field (issuerDN, serialNumber lowercase hex, ISO notBefore/notAfter, publicKeyAlgorithm 'RSA', keySize 2048, sha1/sha256 fingerprints, pem). `error` undefined.

#### TLS-002 — TLS version + negotiated cipher reported · _positive_
- **Steps:** 1) `r=inspectTls({host:'127.0.0.1', port:PORT, servername:'localhost'})`.
- **Expected:** `r.protocol==='TLSv1.3'`; `r.cipher` non-null `{name,standardName,version}` all non-empty (e.g. `TLS_AES_256_GCM_SHA384`). Verbatim from `getProtocol()`/`getCipher()`.

#### TLS-003 — SANs + key algorithm/size parsed for the leaf · _positive_
- **Steps:** 1) `r=inspectTls({..., servername:'localhost'})`. 2) read `chain[0].subjectAlternativeNames`, `publicKeyAlgorithm`, `keySize`.
- **Expected:** SANs include `localhost` and `127.0.0.1` (prefixes stripped); `publicKeyAlgorithm 'RSA'`, `keySize 2048`. Parity with `buildCertificateInfo`.

#### TLS-004 — Hostname validation success against SAN · _positive_
- **Steps:** 1) `a=inspectTls({..., servername:'localhost'})`. 2) `b=inspectTls({..., servername:'127.0.0.1'})`.
- **Expected:** `a.hostnameValid===true` and `b.hostnameValid===true`. Computed independently of trust chain.

#### TLS-005 — ALPN negotiation surfaced · _interop_
- **Preconditions:** `startLocalTls({..., alpnProtocols:['h2','http/1.1']})`.
- **Steps:** 1) `r=inspectTls({..., alpnProtocols:['h2','http/1.1']})`.
- **Expected:** `r.alpnProtocol==='h2'`. When unnegotiated → `r.alpnProtocol===false` (not `''`/null).

#### TLS-006 — Mutual-TLS probe — client cert attached via resolver, server authorizes · _interop_
- **Preconditions:** `startLocalTls({cert:server.crt, key:server.key, ca:ca.crt, requestCert:true, rejectUnauthorized:true})`.
- **Steps:** 1) `resolveKeyMaterial({kind:'inline', certPem:client.crt, keyPem:client.key}, 'buffer')` → `{certDer, keyDer}`. 2) `inspectTls({..., caCerts:[ca.crt DER], clientCert:{cert:certDer, key:keyDer}})`.
- **Expected:** `ok===true`, handshake completes, `chain` non-empty; with `caCerts=[ca.crt]` `authorized===true`. Omitting `clientCert` → `ok false`/`error` mentions handshake/alert/peer.

#### TLS-007 — Port defaults to 443 when omitted · _edge_
- **Steps:** 1) `r=inspectTls({host:'127.0.0.1', timeoutMs:1500})` (port omitted).
- **Expected:** `r.port===443`; nothing listens → `ok===false`, `error` a transport error (ECONNREFUSED/timeout), NOT a TypeError/RangeError.

#### TLS-008 — SNI distinct from connect host · _edge_
- **Steps:** 1) `r=inspectTls({host:'127.0.0.1', port:PORT, servername:'localhost'})`.
- **Expected:** SNI `localhost` sent; `r.servername==='localhost'`; `chain[0]` is the localhost leaf; `hostnameValid===true` (checked against servername, not numeric host).

#### TLS-009 — TLS version pinning passthrough (min==max==TLSv1.2) · _interop_
- **Preconditions:** `startLocalTls({..., minVersion:'TLSv1.2', maxVersion:'TLSv1.2'})`.
- **Steps:** 1) `r=inspectTls({..., minVersion:'TLSv1.2', maxVersion:'TLSv1.2'})`.
- **Expected:** `ok===true`, `protocol==='TLSv1.2'`, `cipher.version` reflects a 1.2 suite.

#### TLS-010 — Inverted TLS version range surfaces error, never crashes · _negative_
- **Steps:** 1) `r=inspectTls({..., minVersion:'TLSv1.3', maxVersion:'TLSv1', timeoutMs:2000})`.
- **Expected:** `ok===false`, `error` truthy and NOT `/TypeError|RangeError/` (engine catches the construction throw).

#### TLS-011 — Connection refused — clean error, no hang · _negative_
- **Steps:** 1) `r=inspectTls({host:'127.0.0.1', port:1, timeoutMs:2000})`.
- **Expected:** Resolves within timeout; `ok===false`, `chain===[]`, `protocol===null`, `cipher===null`, `authorized===false`, `error` `/ECONNREFUSED|refused|connect/i` and NOT `/TypeError|RangeError/`.

#### TLS-012 — Plain-HTTP (non-TLS) endpoint — handshake failure surfaced cleanly · _negative_
- **Preconditions:** plain HTTP server on PORT.
- **Steps:** 1) `r=inspectTls({host:'127.0.0.1', port:PORT, timeoutMs:2000})`.
- **Expected:** `ok===false`, `error` truthy (wrong-version-number/packet-length/handshake), NOT `/TypeError|RangeError/`; `chain===[]`. No fabricated protocol/cipher.

#### TLS-013 — Timeout on an unroutable host honoured · _negative_
- **Steps:** 1) `t0=Date.now()`; `r=inspectTls({host:'10.255.255.1', port:443, timeoutMs:1500})`.
- **Expected:** Resolves within ~timeout+slack (<4s), `ok===false`, `error` `/timeout|timed out|ETIMEDOUT|ECONN/i`; socket destroyed (clean exit).

#### TLS-014 — Empty / malformed host rejected loudly · _edge_
- **Steps:** 1) `inspectTls({host:''})`. 2) `inspectTls({host:'   '})`. 3) handler `harness.invoke('tls:inspect', {host:''})`.
- **Expected:** Engine: rejects OR `ok=false` with 'host is required'; no connect attempt. Handler: `{success:false, error:/host/i}`.

#### TLS-015 — Expiry classify — VALID band (green) · _positive_
- **Steps:** 1) `now=new Date('2026-07-23T00:00:00Z')`. 2) `classifyExpiry('2027-07-23T00:00:00Z', now)`.
- **Expected:** `'valid'`; `daysToExpiry ~365`; engine `validityStatus='valid'`, `expired=false`, `notYetValid=false`.

#### TLS-016 — Expiry classify — EXPIRING band (<30d, orange) · _edge_
- **Steps:** 1) `now=2026-07-23`. 2) `classifyExpiry('2026-08-07T00:00:00Z', now)` (+15d).
- **Expected:** `'expiring'`; `daysToExpiry ~15`, `expired=false`. End-to-end variant: a minted cert notAfter=now+15d → `r.validityStatus==='expiring'`, `r.expired===false`.

#### TLS-017 — Expiry classify — EXPIRED band (red) · _negative_
- **Steps:** 1) `now=2026-07-23`. 2) `classifyExpiry('2026-07-22T23:59:59Z', now)` (1s past).
- **Expected:** `'expired'`; `daysToExpiry` negative; `expired=true`, `validityStatus='expired'`.

#### TLS-018 — Expiry classify — boundary at exactly 30 days and not-yet-valid · _edge_
- **Steps:** 1) `classifyExpiry(now+30d exactly, now)`. 2) `classifyExpiry(now+30d+1s, now)`. 3) engine result for notBefore=now+2d, notAfter=now+365d.
- **Expected:** exactly+30d → `'expiring'` (inclusive); +30d+1s → `'valid'`. Not-yet-valid → `notYetValid===true`, `validityStatus==='expired'`, `authorized===false`, `authorizationError` `/not.*valid|NOT_YET_VALID|CERT_NOT_YET_VALID/i`.

#### TLS-019 — SECURITY: expired cert PRESENTED but reported invalid (present-vs-validate) · _security_
- **Preconditions:** `mintCert({cn:'localhost', sans:['localhost'], notBefore:now-400d, notAfter:now-1d})`; serve it.
- **Steps:** 1) `r=inspectTls({..., servername:'localhost'})`.
- **Expected:** `ok===true` (transport handshake ok, probe uses `rejectUnauthorized:false`). `chain.length>=1` (expired cert returned for inspection). CRITICALLY `authorized===false`, `authorizationError==='CERT_HAS_EXPIRED'`, `expired===true`, `validityStatus==='expired'`. Engine MUST NOT set `authorized=true`/`validityStatus='valid'`.

#### TLS-020 — SECURITY: self-signed cert detected, not auto-trusted · _security_
- **Preconditions:** serve `selfsigned.crt/.key`.
- **Steps:** 1) `r=inspectTls({..., servername:'localhost-selfsigned'})`.
- **Expected:** `chain.length===1`, `chain[0].subjectDN===chain[0].issuerDN` → `selfSigned===true`. `authorized===false`, `authorizationError` `/DEPTH_ZERO_SELF_SIGNED_CERT|self.?signed/i`. Nothing added to any trust store.

#### TLS-021 — SECURITY: hostname mismatch flagged even with otherwise-valid chain · _security_
- **Preconditions:** serve CA-issued `server.crt` (SAN localhost); pass `caCerts=[ca.crt DER]`.
- **Steps:** 1) `r=inspectTls({..., servername:'wrong.example.com', caCerts:[ca.crt DER]})`.
- **Expected:** `hostnameValid===false`; `authorized===false`, `authorizationError` `/altnames|Host:.*cert|does not match|ERR_TLS_CERT_ALTNAME/i`; `expired===false`, `selfSigned===false`.

#### TLS-022 — SECURITY: self-signed cert with basicConstraints CA:TRUE still self-signed/untrusted · _security_
- **Preconditions:** `mintCert({cn:'Evil Root', sans:['localhost'], basicConstraintsCa:true, self-signed})`; serve it.
- **Steps:** 1) `r=inspectTls({..., servername:'localhost'})`.
- **Expected:** `selfSigned===true` (subject==issuer regardless of CA flag); `authorized===false`, `authorizationError` `/self.?signed|UNABLE_TO_GET_ISSUER|DEPTH_ZERO/i`.

#### TLS-023 — SECURITY: present-vs-validate lever — verdict flips with/without trust anchor · _security_
- **Preconditions:** serve fullchain; our CA NOT in system trust store.
- **Steps:** 1) `untrusted=inspectTls({..., servername:'localhost'})` (no caCerts). 2) `trusted=inspectTls({..., servername:'localhost', caCerts:[ca.crt DER]})`.
- **Expected:** BOTH return the SAME `chain`. `untrusted.authorized===false` `/UNABLE_TO_GET_ISSUER|self.?signed cert in chain/i`; `trusted.authorized===true`, `authorizationError` undefined.

#### TLS-024 — SECURITY: inspecting an untrusted cert does not implicitly trust it downstream · _security_
- **Preconditions:** serve `selfsigned.crt`; `inspectTls` + `executeHttpRequest` available.
- **Steps:** 1) `inspectTls({..., servername:'localhost-selfsigned'})`. 2) `executeHttpRequest({method:'GET', url:'https://127.0.0.1:PORT/', timeout:2000})` (default sslVerification=true).
- **Expected:** Real request STILL fails TLS: `status===undefined`, `error` `/self.?signed|DEPTH_ZERO|certificate/i`. No trust side-effect (no global agent mutation, no `NODE_TLS_REJECT_UNAUTHORIZED` change).

#### TLS-025 — SECURITY: resolved client private key never crosses to renderer · _security_
- **Preconditions:** handler test; `vi.mock` keystore-bridge → returns `{certPem, keyPem:'...SECRET', certDer, keyDer, passphrase:'p'}`.
- **Steps:** 1) `res=harness.invoke('tls:inspect', {..., clientCert:{kind:'inline', certPem:'...', keyPem:'...'}})`. 2) `json=JSON.stringify(res)`.
- **Expected:** resolver called with `need==='buffer'`; `res.data` contains NO keyPem/privateKey/keyDer/passphrase/clientKey; `json` lacks `PRIVATE KEY` and the passphrase `p`.

#### TLS-026 — SECURITY: mTLS resolver failure is loud; no silent anonymous fallback · _security_
- **Preconditions:** handler test; resolver mocked to throw `wrong store password`; spy on `inspectTls`.
- **Steps:** 1) `res=harness.invoke('tls:inspect', {..., clientCert:{kind:'keystore', keystoreId:'k1', alias:'a', keyPassword:'bad'}})`.
- **Expected:** `success===false`, `error` `/wrong store password|password|resolve/i`; `inspectTls` NOT called with a keyless probe.

#### TLS-027 — Add viewed cert as trusted → Keystore Studio round-trip · _interop_
- **Preconditions:** inspect the local CA-issued server; keystore engine available.
- **Steps:** 1) `r=inspectTls({..., servername:'localhost'})`. 2) `leafDer=pemBlockToDer(r.chain[0].pem)`. 3) `bytes=serializeKeyStore([{alias:'inspected-localhost', kind:'cert', certDer:leafDer}], 'PKCS12', 'testpassword')`. 4) `parseKeyStore(bytes, 'testpassword', 'PKCS12')`; reopen + `aliasDetail`.
- **Expected:** Imports as TrustedCertificateEntry: `entry.kind==='cert'`, `aliasDetail.entryType==='CERTIFICATE'`, `hasPrivateKey===false`, `chain.length===1`. Stored subjectDN + sha256Fingerprint EQUAL the inspected leaf. No private key created.

#### TLS-028 — SECURITY: add-as-trusted validates real X509, rejects keys/garbage/oversized · _security_
- **Steps:** 1) import a PRIVATE KEY PEM (client.key). 2) import garbage bytes. 3) import an oversized blob (>1 MiB).
- **Expected:** Each REJECTED before storage (X509 parse throws / validation error / size cap); no alias added; no private-key stored as 'trusted cert'.

#### TLS-029 — SECURITY: downgrade / weak negotiation reported truthfully · _security_
- **Preconditions:** `startLocalTls` pinned to `maxVersion:'TLSv1.2'` with an ECDHE-RSA-AES128 suite.
- **Steps:** 1) `r=inspectTls({..., maxVersion:'TLSv1.2'})`.
- **Expected:** `r.protocol==='TLSv1.2'` (actual) and `r.cipher.name` the real suite — surfaces the downgrade. If the build can't negotiate, `ok===false` with a clean error — NEVER a fabricated higher version.

#### TLS-030 — SECURITY: host/servername injection treated as literal (no SSRF/crash) · _security_
- **Steps:** 1) `harness.invoke('tls:inspect', {host:'127.0.0.1\r\nHost: evil.com', port:PORT})`. 2) `inspectTls({host:'127.0.0.1', port:PORT, servername:'localhost\r\nX-Injected: 1'})`. 3) `inspectTls({host:'127.0.0.1; rm -rf /', port:PORT, timeoutMs:1500})`.
- **Expected:** No shell exec, no crash, no connection to any host other than the literal string. Injected host → DNS failure `/ENOTFOUND|getaddrinfo|invalid/i`. Injected servername passed verbatim as SNI. All resolve `success:false`/`ok:false`, never `/TypeError|RangeError/`, never a probe of evil.com.

#### TLS-031 — Chain walk terminates at a self-issued root (no infinite loop) · _edge_
- **Preconditions:** serve fullchain (server.crt + self-signed ca.crt); the root's `.issuerCertificate===itself`.
- **Steps:** 1) `r=inspectTls({..., servername:'localhost'})`.
- **Expected:** `chain` finite (===2), leaf-first, self-signed root appears exactly ONCE (fingerprint Set dedup); returns promptly — no hang/stack overflow/dup entries.

---

### 7.4 #65 SAML

**Scope & engine contract.** New `saml.engine.ts` (xml-crypto ^6.1.2, node:crypto, node:zlib) + `saml.handler.ts` exposing `saml:sign` and `saml:verify` (public-only), mirroring the WSSE engine/handler pair. Surface: `buildAuthnRequest`/`buildAssertion`/`buildResponse` (pure builders); `signSaml(xml, config)` (enveloped XML-DSig, `ds:Signature` immediately after `saml:Issuer`, Reference URI `#<ID>`, Transforms enveloped-signature + exc-c14n, SignatureMethod per algorithm); `verifySaml(xml, certPem, options?)` → `{valid, reason?, signedReferences, certInfo?}` (trust anchor = caller `certPem`, never KeyInfo cert; SignatureMethod allowlist RSA/ECDSA — HMAC rejected; Transforms allowlist {enveloped-signature, exc-c14n, c14n} — no XSLT/XPath/WithComments; DTD/DOCTYPE disabled); `encodeRedirect`/`decodeRedirect` (raw DEFLATE + base64, inflated-size cap default ~5 MiB); `encodePost`/`decodePost` (base64 only). The `saml:sign` payload carries `config.keySource: MaterialSource` resolved in main via `resolveKeyMaterial(keySource, 'pem')` → only signed XML returned. `saml:verify` is public-only.

**Placement:** `tests/main/saml-engine.test.ts` (PRIMARY: build, round-trip, algorithm/digest variants, all security negatives, encode/decode); `tests/main/handlers/saml.test.ts` (IPC envelope + provider resolution + no-leak; `vi.mock` keystore-bridge; no `helpers.ts` SCHEMA_SQL mirror needed — handler is stateless). Fixtures: reuse `server.crt/.key` (signer), `client.crt` (WRONG cert), `ec-p256.*` (ECDSA edge); NEW `tests/fixtures/saml/` (`authn-request.xml`, `assertion.xml`, `response.xml`, `real-redirect-samlrequest.txt`). XSW/tampered/bomb docs constructed IN-TEST; decompression bomb via `zlib.deflateRawSync(Buffer.alloc(50*1024*1024))`.

#### SAML-001 — buildAuthnRequest emits a schema-shaped samlp:AuthnRequest · _positive_
- **Preconditions:** saml.engine imported.
- **Steps:** 1) `buildAuthnRequest({issuer:'https://sp.testnizer.com', destination:'https://idp/sso', assertionConsumerServiceURL:'https://sp/acs', nameIdFormat:'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent', forceAuthn:true})`.
- **Expected:** String with `<samlp:AuthnRequest xmlns:samlp='urn:oasis:names:tc:SAML:2.0:protocol'>`, ID `/^_[0-9a-f]{8,}$/`, IssueInstant `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/`, Destination/ACS URLs, `ForceAuthn='true'`, `<saml:Issuer>`, NameIDPolicy Format = persistent URN.

#### SAML-002 — buildAssertion emits Subject, Conditions and AttributeStatement · _positive_
- **Steps:** 1) `buildAssertion({issuer:'https://idp', subject:'alice@corp', audience:'https://sp', notBefore:'2026-07-23T00:00:00Z', notOnOrAfter:'2026-07-23T01:00:00Z', attributes:{role:['admin','user'], email:'alice@corp'}})`.
- **Expected:** Contains `<saml:Assertion ID='_...'>`, `<saml:Issuer>`, `<saml:NameID>alice@corp`, `<saml:Conditions NotBefore/NotOnOrAfter>` with `<saml:AudienceRestriction><saml:Audience>https://sp`, and `<saml:AttributeStatement>` with a role Attribute (TWO AttributeValue: admin, user) + email Attribute.

#### SAML-003 — buildResponse wraps an Assertion with Status=Success · _positive_
- **Preconditions:** assertion XML available.
- **Steps:** 1) `a=buildAssertion({issuer:'https://idp', subject:'bob'})`. 2) `buildResponse({issuer:'https://idp', destination:'https://sp/acs', inResponseTo:'_req1', assertion:a})`.
- **Expected:** `<samlp:Response InResponseTo='_req1' Destination='https://sp/acs'>`, `<samlp:Status><samlp:StatusCode Value='...Success'/>`, embedded `<saml:Assertion>`; Response ID distinct from assertion ID.

#### SAML-004 — Generated IDs are unique and NCName-valid across calls · _edge_
- **Steps:** 1) `buildAuthnRequest({issuer:'sp'})` × 100, collect IDs.
- **Expected:** All 100 distinct (Set size 100); every ID `/^_[A-Za-z][\w.-]*$/` (never starts with a digit).

#### SAML-010 — Enveloped sign over Assertion → verify round-trip valid · _positive_
- **Preconditions:** `server.key/.crt`; `assertion.xml` (ID=_a1).
- **Steps:** 1) `signed=signSaml(assertionXml, {privateKeyPem:serverKey, certPem:serverCrt, algorithm:'RSA-SHA256', signatureLocation:'assertion', idAttribute:'ID', referenceId:'_a1'})`. 2) `res=verifySaml(signed, serverCrt)`.
- **Expected:** `signed` has `<ds:Signature>`, `<ds:Reference URI='#_a1'>`, enveloped-signature + exc-c14n transforms, SignatureMethod `...#rsa-sha256`, DigestMethod `...#sha256`. `res.valid===true`, `reason===undefined`, `signedReferences` includes `_a1`, `certInfo.subject/issuer/notAfter` populated.

#### SAML-011 — Enveloped sign over Response element verifies · _positive_
- **Preconditions:** `response.xml` (Response ID=_r1 wrapping assertion).
- **Steps:** 1) `signed=signSaml(responseXml, {..., signatureLocation:'response', referenceId:'_r1'})`. 2) `res=verifySaml(signed, serverCrt)`.
- **Expected:** `res.valid===true`, `signedReferences` includes `_r1`; `ds:Signature` is a direct child of samlp:Response, immediately after saml:Issuer.

#### SAML-012 — Signature algorithm variants RSA-SHA1/256/512 all round-trip · _positive_
- **Steps:** 1) `it.each([['RSA-SHA1','xmldsig#rsa-sha1','xmldsig#sha1'],['RSA-SHA256','rsa-sha256','xmlenc#sha256'],['RSA-SHA512','rsa-sha512','xmlenc#sha512']])`: sign then verify.
- **Expected:** Every variant: `signed` has expected SignatureMethod + DigestMethod fragments; `res.valid===true`.

#### SAML-013 — signSaml places ds:Signature immediately after saml:Issuer · _positive_
- **Preconditions:** `assertion.xml` has saml:Issuer as first child.
- **Steps:** 1) `signed=signSaml(assertionXml, {..., signatureLocation:'assertion', referenceId:'_a1'})`. 2) parse; inspect child order.
- **Expected:** First element child of Assertion is saml:Issuer, immediately-following is ds:Signature (schema-valid). `verifySaml(signed, serverCrt).valid===true`.

#### SAML-020 — verifySaml valid=true only with the exact signing cert; certInfo populated · _positive_
- **Preconditions:** signed assertion from SAML-010.
- **Steps:** 1) `res=verifySaml(signed, serverCrt)`.
- **Expected:** `res.valid===true`, `certInfo.subject`/`issuer` defined, `certInfo.notAfter` parseable.

#### SAML-021 — Signature fails verification against a different certificate · _negative_
- **Preconditions:** signed assertion; `client.crt` (different key).
- **Steps:** 1) `res=verifySaml(signed, clientCrt)`.
- **Expected:** `res.valid===false`, non-empty `reason`; `signedReferences` empty.

#### SAML-030 — SECURITY: XML Signature Wrapping — forged active Assertion, signed one relocated · _security_
- **Preconditions:** legitimately signed assertion (ID=_good).
- **Steps:** 1) `goodSigned=signSaml(assertionGood, {..., referenceId:'_good'})`. 2) Build a Response whose FIRST/active Assertion has ID=_evil (role=admin, unsigned) and MOVE goodSigned (still referencing #_good) into an unused location. 3) `res=verifySaml(wrappedDoc, serverCrt, {requireSignedId:'_evil'})`.
- **Expected:** `res.valid===false`, `reason` mentions the active assertion isn't covered by a valid signature; `signedReferences` contains ONLY `_good` (never `_evil`). Forged _evil attributes never authenticated.

#### SAML-031 — SECURITY: Duplicate-ID wrapping — two elements share the signed ID · _security_
- **Preconditions:** goodSigned assertion (ID=_good).
- **Steps:** 1) Construct a doc with TWO Assertions both ID=_good (original signed + forged). 2) `res=verifySaml(dupDoc, serverCrt)`.
- **Expected:** `res.valid===false`; `reason` indicates ambiguous/multiple-element ID resolution. MUST NOT pick the first match and pass.

#### SAML-032 — SECURITY: enveloped-signature transform stripped from Reference · _security_
- **Preconditions:** signed assertion from SAML-010.
- **Steps:** 1) delete `<ds:Transform ...#enveloped-signature>` (leave only exc-c14n). 2) `res=verifySaml(tampered, serverCrt)`.
- **Expected:** `res.valid===false` (digest now over content including the Signature → mismatch); `signedReferences` empty.

#### SAML-033 — SECURITY: malicious transform injection (XSLT/XPath) rejected by allowlist · _security_
- **Preconditions:** signed assertion from SAML-010.
- **Steps:** 1) insert an extra `<ds:Transform Algorithm='...REC-xslt-19991116'>` (or XPath) into Reference Transforms. 2) `res=verifySaml(tampered, serverCrt)`.
- **Expected:** `res.valid===false`; `reason` indicates a disallowed/unsupported transform. Engine refuses XSLT/XPath.

#### SAML-034 — SECURITY: signed content tampered → DigestValue mismatch · _security_
- **Preconditions:** signed assertion (NameID='alice@corp').
- **Steps:** 1) `tampered=signed.replace('alice@corp','attacker@evil')`. 2) `res=verifySaml(tampered, serverCrt)`.
- **Expected:** `res.valid===false`; `signedReferences` empty.

#### SAML-035 — SECURITY: DigestValue forged to match tampered content, SignatureValue unchanged · _security_
- **Steps:** 1) tamper referenced content AND replace Reference DigestValue with the correct digest, leave SignatureValue untouched. 2) `res=verifySaml(tampered, serverCrt)`.
- **Expected:** `res.valid===false` — SignatureValue over the canonicalized SignedInfo (now with altered DigestValue) no longer verifies.

#### SAML-036 — SECURITY: unsigned Assertion is rejected · _security_
- **Preconditions:** `assertion.xml` with NO ds:Signature.
- **Steps:** 1) `res=verifySaml(assertionXml, serverCrt)` (no options).
- **Expected:** `res.valid===false`, `reason` `/no signature/i`. Unsigned assertion NEVER accepted.

#### SAML-037 — SECURITY: Response signed but inner Assertion unsigned, requireAssertionSigned · _security_
- **Steps:** 1) `signedResp=signSaml(responseXml, {..., signatureLocation:'response', referenceId:'_r1'})` (signs Response only; inner _a1 unsigned). 2) `res=verifySaml(signedResp, serverCrt, {requireAssertionSigned:true})`.
- **Expected:** `res.valid===false`; `reason` indicates _a1 not among signedReferences. With `requireAssertionSigned:false` the Response signature verifies (assert too).

#### SAML-038 — SECURITY: HMAC key-confusion signature (public cert as HMAC key) rejected · _security_
- **Preconditions:** `server.crt` public cert available.
- **Steps:** 1) craft a Signature with SignatureMethod `...#hmac-sha1`, SignatureValue = HMAC-SHA1(SignedInfo) keyed by the public cert bytes. 2) `res=verifySaml(hmacDoc, serverCrt)`.
- **Expected:** `res.valid===false`; `reason` indicates unsupported/disallowed algorithm. Allowlist permits only RSA/ECDSA; never treats a public cert as an HMAC secret.

#### SAML-039 — SECURITY: comment-insertion c14n attack — engine reads canonical signed value · _security_
- **Preconditions:** signed assertion NameID 'admin@good.com'.
- **Steps:** 1) `signed=signSaml(assertionAdmin, {..., referenceId:'_a1'})`. 2) mutate NameID to `admin<!---->@good.com`. 3) `res=verifySaml(attacked, serverCrt)`; read the engine's canonical signed subject.
- **Expected:** Exclusive C14N drops comments so `res.valid` may remain true, BUT the engine-reported signed subject equals the FULL `admin@good.com`, NOT the truncated `admin`. A `#WithComments` c14n Signature is rejected (`valid===false`).

#### SAML-040 — SECURITY: CanonicalizationMethod downgrade after signing → mismatch · _security_
- **Preconditions:** signed assertion (SignedInfo uses exc-c14n).
- **Steps:** 1) change SignedInfo/CanonicalizationMethod from exc-c14n to inclusive `...REC-xml-c14n-20010315`. 2) `res=verifySaml(tampered, serverCrt)`.
- **Expected:** `res.valid===false` — SignatureValue computed over exc-c14n(SignedInfo); recanonicalizing under inclusive c14n changes bytes → RSA verify fails.

#### SAML-041 — SECURITY: trust anchor is the caller cert, not the KeyInfo-embedded cert · _security_
- **Preconditions:** server key signs; doc whose KeyInfo embeds an ATTACKER cert (client.crt).
- **Steps:** 1) `signed=signSaml(assertion, {privateKeyPem:serverKey, certPem:serverCrt, ...})`. 2) replace the X509Certificate inside `<ds:KeyInfo>` with client.crt. 3) `resServer=verifySaml(swapped, serverCrt)`; `resClient=verifySaml(swapped, clientCrt)`.
- **Expected:** `resServer.valid===true` (verifies under caller serverCrt regardless of KeyInfo); `resClient.valid===false`. Engine ignores embedded KeyInfo for trust.

#### SAML-042 — SECURITY: DOCTYPE/XXE not resolved · _security_
- **Steps:** 1) feed verifySaml a Response with `<!DOCTYPE ... [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>` and NameID `&xxe;`. 2) `res=verifySaml(xxeDoc, serverCrt)`.
- **Expected:** No file read / network fetch. Engine rejects (DTD disabled → `valid===false` parse-error reason) or leaves `&xxe;` unexpanded; never returns /etc/passwd contents; no crash.

#### SAML-043 — SECURITY: entity-expansion (billion laughs) bounded/rejected · _security_
- **Steps:** 1) feed verifySaml a nested internal-entity DOCTYPE (lol1..lol9). 2) `res=verifySaml(bombDoc, serverCrt)`.
- **Expected:** Returns promptly (bounded time/memory) with `valid===false`/parse error; does NOT hang/exhaust memory.

#### SAML-050 — Redirect binding encode→decode round-trips (raw DEFLATE + base64) · _positive_
- **Preconditions:** `authn-request.xml`.
- **Steps:** 1) `enc=encodeRedirect(authnXml)`. 2) `dec=decodeRedirect(enc)`.
- **Expected:** `enc` base64 `/^[A-Za-z0-9+/=]+$/`; `dec===authnXml` (byte-identical). Internally base64(deflateRawSync) — no zlib header; decode uses inflateRawSync.

#### SAML-051 — POST binding is base64-only (no DEFLATE) and distinct from redirect · _positive_
- **Preconditions:** `authn-request.xml`.
- **Steps:** 1) `post=encodePost(authnXml)`; `decodePost(post)`. 2) attempt `decodeRedirect(post)`.
- **Expected:** `decodePost(post)===authnXml`, and `Buffer.from(post,'base64').toString('utf8')===authnXml` (no deflation). `decodeRedirect(post)` throws/errors rather than emitting garbage.

#### SAML-052 — INTEROP: decode a real IdP-produced redirect SAMLRequest · _interop_
- **Preconditions:** `tests/fixtures/saml/real-redirect-samlrequest.txt`.
- **Steps:** 1) `raw=read fixture`; `xml=decodeRedirect(raw)`.
- **Expected:** `xml` well-formed, contains `<samlp:AuthnRequest>` with expected Issuer + valid IssueInstant. Interoperates with a third-party encoder.

#### SAML-053 — Malformed base64 input to decodeRedirect fails cleanly · _negative_
- **Steps:** 1) `decodeRedirect('@@@ not base64 @@@')`.
- **Expected:** Throws descriptive Error; no crash/partial output. Through the handler → `{success:false,error}`.

#### SAML-054 — SECURITY: DEFLATE decompression bomb rejected by inflated-size cap · _security_
- **Preconditions:** `decodeRedirect` enforces `maxInflatedBytes` (~5 MiB).
- **Steps:** 1) `bomb=zlib.deflateRawSync(Buffer.alloc(50*1024*1024)).toString('base64')` (~67 KB → 50 MB). 2) `decodeRedirect(bomb)` (or with `{maxInflatedBytes:5*1024*1024}`).
- **Expected:** Throws `/too large|exceeds .*limit|decompression/` BEFORE materializing 50 MB; memory bounded. Use zlib `maxOutputLength`/streaming counter, not unbounded inflate.

#### SAML-055 — Truncated/garbage DEFLATE stream fails, no silent partial output · _edge_
- **Steps:** 1) `enc=encodeRedirect(authnXml)`; `truncated=enc.slice(0, floor(len/2))`. 2) `decodeRedirect(truncated)`.
- **Expected:** Throws an inflate error (unexpected end of stream); does NOT return a truncated XML fragment.

#### SAML-056 — Sign → redirect-encode → decode → verify survives transport encoding · _interop_
- **Preconditions:** server key/cert; `authn-request.xml`.
- **Steps:** 1) `signed=signSaml(authnXml, {..., signatureLocation:'root', referenceId:'_req1'})`. 2) `wire=encodeRedirect(signed)`; `back=decodeRedirect(wire)`; `res=verifySaml(back, serverCrt)`.
- **Expected:** `back===signed` (byte-identical) and `res.valid===true`.

#### SAML-060 — saml:sign happy path with inline keySource returns verifiable XML · _positive_
- **Preconditions:** saml handler registered; inline branch resolves/echoes inline PEMs.
- **Steps:** 1) `res=harness.invoke('saml:sign', {xml:assertionXml, config:{keySource:{kind:'inline', certPem:serverCrt, keyPem:serverKey}, algorithm:'RSA-SHA256', signatureLocation:'assertion', referenceId:'_a1'}})`.
- **Expected:** `success===true`; `data` contains `<ds:Signature>` + Reference URI='#_a1'; `verifySaml(res.data, serverCrt).valid===true`.

#### SAML-061 — SECURITY: saml:sign resolves provider keySource at need='pem' with NO key leak · _security_
- **Preconditions:** `vi.mock` keystore-bridge → `resolveKeyMaterial:vi.fn(()=>({certPem:serverCrt, keyPem:serverKey}))`.
- **Steps:** 1) `res=harness.invoke('saml:sign', {xml:assertionXml, config:{keySource:{kind:'keystore', keystoreId:'ks1', alias:'signer', storePassword:'testpassword'}, algorithm:'RSA-SHA256', signatureLocation:'assertion', referenceId:'_a1'}})`. 2) inspect mock calls + `res.data`.
- **Expected:** `resolveKeyMaterial` called EXACTLY once with (keystore source, `'pem'`); `success===true`; `res.data` does NOT contain `PRIVATE KEY` or the raw keyPem. Resolved private PEM never crosses back.

#### SAML-062 — saml:sign surfaces resolver failure as {success:false,error} (fail loud) · _negative_
- **Preconditions:** `resolveKeyMaterial` mock throws `unresolvable alias: signer`.
- **Steps:** 1) `res=harness.invoke('saml:sign', {xml:assertionXml, config:{keySource:{kind:'keystore', keystoreId:'ks1', alias:'signer'}, algorithm:'RSA-SHA256'}})`.
- **Expected:** `success===false`, `error` `/unresolvable alias/`; no unsigned/empty document.

#### SAML-063 — saml:verify is public-only (no private-key field honored) · _security_
- **Preconditions:** saml handler registered; signed assertion from SAML-010.
- **Steps:** 1) `res=harness.invoke('saml:verify', {xml:signed, certPem:serverCrt, keySource:{kind:'inline', keyPem:serverKey}})` (attacker-supplied extra).
- **Expected:** `success===true`, `data.valid===true`, verify uses ONLY `certPem`; any keySource/privateKey field ignored. No private material read/returned.

#### SAML-064 — saml:verify wraps a failed verification as success:true / data.valid:false · _negative_
- **Preconditions:** unsigned `assertion.xml`.
- **Steps:** 1) `res=harness.invoke('saml:verify', {xml:assertionXml, certPem:serverCrt})`.
- **Expected:** `success===true` (IPC executed) AND `data.valid===false`, `data.reason` `/no signature/i`. A failed verify is NOT an IPC error.

#### SAML-070 — signSaml on empty/whitespace XML errors · _edge_
- **Preconditions:** server key/cert.
- **Steps:** 1) `signSaml('   ', {privateKeyPem:serverKey, certPem:serverCrt, algorithm:'RSA-SHA256', referenceId:'_a1'})`.
- **Expected:** Throws descriptive Error (no target element / no element with the given ID). Via `saml:sign` → `{success:false,error}`.

#### SAML-071 — INTEROP: ECDSA-P256 signing via provider round-trips · _interop_
- **Preconditions:** `ec-p256.pkcs8.key` + `ec-p256.crt`; engine supports ecdsa-sha256.
- **Steps:** 1) `signed=signSaml(assertionXml, {privateKeyPem:ecP256Key, certPem:ecP256Crt, algorithm:'ECDSA-SHA256', signatureLocation:'assertion', referenceId:'_a1'})`. 2) `res=verifySaml(signed, ecP256Crt)`.
- **Expected:** SignatureMethod URI `...#ecdsa-sha256`; `res.valid===true`. If ECDSA is gated out of the initial allowlist, this case documents the expected 'unsupported algorithm' rejection instead (keep in sync with SAML-038).

#### SAML-072 — Special characters in attribute/NameID values escaped and still verify · _edge_
- **Preconditions:** server key/cert.
- **Steps:** 1) `a=buildAssertion({issuer:'idp', subject:'a<b&c"d', attributes:{note:"x'>y"}})`. 2) `signed=signSaml(a, {..., referenceId:<a's ID>})`; `res=verifySaml(signed, serverCrt)`.
- **Expected:** Built XML contains escaped `&lt;`/`&amp;`/`&quot;`/`&apos;`/`&gt;` (no raw `< > &`), well-formed, `res.valid===true`.

#### SAML-073 — Builder rejects missing required fields · _negative_
- **Preconditions:** saml.engine imported.
- **Steps:** 1) `buildAuthnRequest({})` (no issuer).
- **Expected:** Throws `/issuer.*required/i` (or equivalent). Does not emit an AuthnRequest with an empty/undefined Issuer.

---

## 8. Open Questions

1. **Distinct-password JKS/JCEKS (R11 follow-up):** commit to threading a per-alias entry password through `parseJks`/`parsePkcs12` in this suite, or defer indefinitely? Until then `exportAliasPem`'s `keyPassword` is inert for keystores whose entry pw ≠ store pw — a real enterprise case. Need a decision + a loud error when such a keystore is opened.
2. **`<KeyMaterialPicker>` password capture UX when `store_password` is NULL (remember-off):** prompt inside the picker at pick time (stored transiently in `MaterialSource`) vs. prompt at execution time in main? Prompt-at-pick keeps main non-interactive but the renderer briefly holds the store password (write-only, never persisted) — acceptable, or must it be an interactive main-process prompt?
3. **certRow with `source='keystore'` still needs a host (or `'*'`)** to be selected by `listCertificatesForHost` — should the picker default keystore-backed cert rows to `host='*'`, or force the user to scope them? A silent `'*'` could over-attach a client cert to unintended hosts (see R5 HIGH risk).
4. **secp256k1 (ES256K):** any concrete SAML/JOSE enterprise consumer, or leave out? Ed25519 is in; ES256K is the only algorithm needing special jose opt-in.
5. **TLS inspector depth:** stop at chain/protocol/cipher/SANs/validity, or include OCSP stapling / CT-log / revocation checks? The latter add network calls and complexity beyond Apinizer-level parity.
6. **Runner R5 rollout:** is turning file-based client certs ON for ALL existing Runner runs acceptable as a same-release behavior change, or should it be gated behind a project/Runner setting (default off) for one release to avoid surprising existing runs that relied on going out unauthenticated?
7. **JWE algorithm scope:** confirm the key-mgmt/content-enc matrix (RSA-OAEP(-256), ECDH-ES(+A128/256KW), dir; A128/256GCM + CBC-HS) is the intended enterprise set, or trim to GCM + RSA-OAEP-256 + ECDH-ES only.
