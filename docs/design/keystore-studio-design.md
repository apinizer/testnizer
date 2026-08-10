---
title: "Testnizer Keystore Studio — Design & Test Plan (Implementation-Ready)"
issue: "apinizer/testnizer#59"
primary_spec: "/Users/mhy/IdeaProjects/apinizer/KEYSTORE-STUDIO-TESTNIZER-PORT.md"
status: "Implementation-ready. APPROVE-WITH-BLOCKERS — R1 (CI interop proof) and R2 (multi-alias PKCS12) must close before Faz 0 is done."
test_case_count: 272
---

# Testnizer Keystore Studio — Design & Test Plan

> **GitHub issue:** [apinizer/testnizer#59](https://github.com/apinizer/testnizer/issues/59)
> **Primary specification** (authoritative source of behavior; all `§N` references below point into it): `/Users/mhy/IdeaProjects/apinizer/KEYSTORE-STUDIO-TESTNIZER-PORT.md`
>
> This document is the engineer-facing deliverable. It assembles the codebase ground-truth (tool wiring, mTLS/certificate stack, packaging/deps, i18n/test layout), the architecture decision record, the Model C bridge design, the Faz 0–5 phasing, the risk register, and the **complete 272-case test plan**. Nothing is summarized away — every test case is rendered in full.

---

## 1. Executive Summary

Keystore Studio is a **main-process Tools-panel tool** (modeled end-to-end on the existing OTP quadruple — `src/main/lib/otp.ts` engine → `src/main/ipc/otp.handler.ts` → preload bridge → `src/renderer/stores/otp.store.ts` — **not** the browser-safe QR-tool pattern). It opens, inspects, creates, edits, converts, and saves Java `.jks` and PKCS12 `.p12/.pfx` keystores: alias listing, X.509 detail, RSA/EC key-pair generation with self-signed certs, five import formats, certificate export (DER/PEM/PKCS7/PkiPath), password rotation, and JKS ⇄ PKCS12 conversion. Parsing binary keystores, generating keys, building certificates, and computing the JKS integrity hash all require Node `crypto`/`fs`; and — critically — **private-key and passphrase material must never enter the Chromium renderer** (DevTools / XSS / extension surface). So the engine lives in `src/main/lib/keystore.ts` behind an IPC handler, and the renderer is a pure UI over `window.api.keystore.*`.

Five architectural calls drive the design, each deliberately dodging Testnizer's worst CI/packaging/signing pain: **(1)** main-process engine keeps secrets out of the renderer; **(2)** a **`sessionId` state model** — the keystore `Buffer`, store password, type, and the alias→entry-password map live only in a `Map<sessionId, session>` in main — replaces Apinizer's base64-working-copy-in-renderer model; **(3)** **Model A persistence** (Save-As via native dialog + `fs`) means **no DB table, no `database.ts` migration, no `helpers.ts` SCHEMA_SQL mirror** for the tool itself; **(4)** **Option C — a pure-TS JKS writer** (`src/main/lib/jks-writer.ts`, SHA-1 via `@noble/hashes`) sidesteps the entire native-binary / per-platform `extraResources` / cross-arch / notarization axis; **(5)** a **single shared PEM-emitting resolver** (`src/main/lib/keystore-bridge.ts`) feeds mTLS (Node `Buffer`s on `https.Agent`), the Runner, and WSSE (PEM strings on xml-crypto) from one place.

The plan is **APPROVE-WITH-BLOCKERS**. Two items must close before Faz 0 is called done: **(a)** the mandatory `keytool -list` interop proof is currently `describe.skipIf(!hasKeytool)` and the CI `quality` job has no `setup-java`, so a byte-wrong JKS writer could ship green (the jks-js round-trip is circular and proves nothing about keytool); **(b)** node-forge's high-level `pkcs12.toPkcs12Asn1` is a **single key + single cert(chain)** API and cannot assemble the multi-alias keystores that `convert`/`copyEntry`/export require. A third, spec-level defect must also be corrected before the writer is coded: the narrative names JKS magic `0xFEEDFEED` but describes a "SunJCE keyProtector" — **JCEKS is a different format** (`0xCECECECE`, PBEWithMD5AndTripleDES). The target is **JKS**: OID `1.3.6.1.4.1.42.2.17.1.1`, SHA-1 keystream XOR protector, SHA-1 store hash over `UTF-16BE(password) + "Mighty Aphrodite" + encoded data`.

Everything else is medium/low severity and mitigable inline. Do **not** let Option C's interop test stay `skipIf`-gated, and do **not** assume `toPkcs12Asn1` handles more than one key entry.

---

## 2. Scope

### 2.1 Apinizer 18-operation parity table

| # | Operation | IPC channel | Crypto backing | Spec |
|---|-----------|-------------|----------------|------|
| 1 | Create empty keystore | `keystore:createEmpty` | node-forge / jks-writer | §4.1 |
| 2 | Open / load keystore (+ `resolveType`) | `keystore:pickFile`, `keystore:loadKeyStore` | node-forge (P12), jks-js (JKS read) | §4.2, §6.1–6.3 |
| 3 | Inspect (alias summaries) | `keystore:inspect` | projection over the loaded store | §4.2, §6.5 |
| 4 | Alias detail (CertificateInfo chain) | `keystore:aliasDetail` | node-forge / @peculiar | §4.3, §6.6 |
| 5 | Generate key pair (RSA/EC, self-signed X.509v3) | `keystore:generateKeyPair` | node-forge (RSA), @peculiar/x509 (EC) | §4.8, §6.8 |
| 6 | Generate secret key (AES) | `keystore:generateSecretKey` | Node `crypto.randomBytes` | §4.9 — **PKCS12 only** |
| 7 | Import PKCS12 (`copyEntry`) | `keystore:importPkcs12` | node-forge | §4.4, §6.10 |
| 8 | Import key material (PKCS#8 + OpenSSL/PKCS#1) | `keystore:importKeyMaterial` | jose / node-forge | §4.5, §6.7, §6.11 |
| 9 | Import pasted PEM | `keystore:importPem` | node-forge | §4.6 |
| 10 | Import trusted certificate (PEM or base64 DER) | `keystore:importTrustedCert` | node-forge | §4.7, §6.11 |
| 11 | Verify key matches certificate | *(internal, gates 8 & 9)* | SPKI-DER compare (primary) + sign/verify probe | §6.7 |
| 12 | Rename alias | `keystore:renameAlias` | node-forge / jks-writer | §4.10 |
| 13 | Change store password | `keystore:changeStorePassword` | re-encrypt every key entry | §4.11 |
| 14 | Set entry password | `keystore:setEntryPassword` | re-encrypt one key entry | §4.12 — key entries only |
| 15 | Delete entry | `keystore:deleteEntry` | mutate + re-inspect | §4.13 |
| 16 | Export certificate (DER/PEM/PKCS7/PKIPATH) | `keystore:exportCertificate` | node-forge pkcs7 / manual ASN.1 | §4.14, §6.12 |
| 17 | Convert (JKS ⇄ PKCS12) | `keystore:convert` | jks-js `toPem` + node-forge (→P12); jks-writer (→JKS) | §4.15, §S.4 |
| 18 | Save As (Model A persist) | `keystore:saveAs` | `showSaveDialog` + `fs.writeFile` | §4.16 |

Lifecycle + Testnizer-native extras beyond the 18: `keystore:closeSession` (dispose session), `keystore:exportJwk`, `keystore:viewTlsCert`.

### 2.2 KeyStore-Explorer scope — include now vs defer

**Include now** (fit Testnizer's API-testing identity):

- **View certificate chain from a live TLS/SSL endpoint** — `tls.connect(host:443)` in main, dump the presented chain into the same `CertificateInfo` viewer. Directly serves the mTLS/endpoint-debugging workflow.
- **JWK export** of a public key — `jose` is already a dependency (`^6.2.3`); one-liner, high value for JWT/JOSE request signing.
- **Cryptographic key-cert match validation** on import (Apinizer §6.7).
- **Certificate expiry status coloring** (green/amber/red) — the tool's most-loved feature (§9.4).
- RSA + EC (P-256/384/521) key pairs and self-signed certs (Apinizer parity).
- JKS ⇄ PKCS12 two-way conversion (the primary user requirement).
- PEM/DER/PKCS7/PkiPath certificate export (Apinizer parity).

**Defer** (YAGNI against a test client's identity):

- CSR (PKCS#10) and SPKAC generation/signing.
- CA signing / chain building (signing one certificate with another).
- CRL, JAR, J2ME, JWT, PKCS#7 signing and RFC-3161 timestamping.
- Certificate revocation / path validation (OCSP, CRL checking).
- BKS (V1/V2), UBER, BCFKS and other exotic keystore formats.
- Microsoft PVK / SPC import-export.
- Ed25519 / Ed448 key pairs (keygen is cheap via Node crypto but cert-build tooling is immature — revisit if requested).
- **secp256k1** (needs `@noble/curves`; exotic for API testing). §4.8 lists it as an allowed keygen curve, so the engine accepts it **only if** `@noble/curves` is wired; otherwise it must throw `Unsupported EC curve: secp256k1`.
- **Model B** — a persisted keystore library (DB table). MVP is Model A Save-As only.

---

## 3. Architecture (Testnizer-grounded)

### 3.1 Identity & placement

Protocol id **`'tools.keystore'`**. Catalog icon **`FileKey`** (confirmed unused/unimported — `KeyRound`=JWT, `KeySquare`=passwordGen, `Shield`=wsSecurity, `ShieldCheck`=otp are already taken in `tools-catalog.ts` lines 1-26). Placed in the **utility-calculators** section of `TOOL_CATALOG` (after the `// ── utility calculators ──` marker at `tools-catalog.ts:151`), next to `otp`/`passwordGen`. Purple badge `bg:'#eeecfe'`, `color:'#5b52d4'`.

### 3.2 The six additive tool-registration edit points

1. **`src/renderer/types/index.ts`** — add `'tools.keystore'` to **BOTH** the `Protocol` union (lines 18-40) **AND** the `TOOL_PROTOCOLS` const array (lines 42-65). `ToolProtocol` and `isToolProtocol()` derive from `TOOL_PROTOCOLS` automatically, so there is no third edit. Also add the Keystore DTOs here (`KeystoreMeta`, `AliasSummary`, `CertificateInfo`, `KeystoreAliasDetail`, generate/import request shapes).
2. **`src/renderer/lib/tools/keystore.ts`** — thin/optional for this tool. The heavy crypto is in main, so the Zustand store replaces this module (exactly how `OtpTool` imports `useOtpStore` instead of a `lib/tools/otp.ts`).
3. **`src/renderer/components/tools/KeystoreTool.tsx`** (NEW) — wraps `ToolShell`, `default export`, `useTranslation()` for every string, CSS-var colors only (`var(--accent)`; success `#1a7a4a`, error `#cc2200`; **never** hard-code `#7c73e6`).
4. **`src/renderer/lib/tools-catalog.ts`** — import `FileKey` from `lucide-react` and push `{ protocol:'tools.keystore', Icon: FileKey, labelKey:'tools.keystore.title', bg:'#eeecfe', color:'#5b52d4' }`. **Array position = menu position.**
5. **`src/renderer/components/layout/Workbench.tsx`** — add the import (with the other tool imports, lines 19-41) and one line to the `TOOL_COMPONENTS` map (lines 78-102): `'tools.keystore': KeystoreTool`.
6. **`src/renderer/lib/i18n.ts`** — add `tools.keystore.*` keys (label = `.title`) to **BOTH** the `en:` block (~line 1048, next to the `tools.qr.*` keys ~1120) and the `tr:` block (~line 2573 / ~2676), with an **identical key set**.

**Auto-pickup — do NOT touch** (a second registration would double-list the tool): `ToolsPanel.tsx` maps over `TOOL_CATALOG` (lines 18-19, 87-93) and calls `openToolTab(tool.protocol, t(tool.labelKey))`; `command-registry.ts` loops `TOOL_CATALOG` (lines 257-268) to register `Open <Tool>` Cmd+K actions; `tabs.store.ts#openToolTab` (line 191) is generic and dedupes one tab per protocol. Adding the catalog entry alone lights up both the sidebar list and Cmd+K. Also do **NOT** add this calculator/utility tool to `ToolsDropdown.tsx`'s hand-written `TOOL_ITEMS` — utility calculators are deliberately excluded there.

### 3.3 Main-process engine — `src/main/lib/keystore.ts`

`KeystoreEngine` owns the session `Map`, `resolveType` / `loadKeyStore` / `loadOrCreate` / `mutate`, all 18 operations, `verifyKeyMatchesCertificate`, `CertificateInfo` extraction, and the two error classes. It uses Node `crypto` (like `otp.ts`) — **not** global Web Crypto or `crypto-js`, which are for renderer-only tools and the script sandbox — plus `node-forge` (RSA / PKCS12 / PEM / ASN.1), `@peculiar/x509` (EC certs), `jks-js` (JKS read), and `jks-writer.ts` (JKS write). Engine unit tests import it directly: no Electron, no DB.

### 3.4 Session model — `sessionId`, not a base64 working copy

Apinizer round-trips the whole keystore as base64 because it is client/server. Testnizer is single-process, so we adopt the **sessionId model** (spec §S.1 preferred, §2.3): the keystore `Buffer`, store password, type, and the `aliasEntryPasswords` map live **only** in a `Map<sessionId, KeystoreSession>` in main. The renderer's `keystore.store.ts` holds `{ sessionId, meta, dirty }` where `meta` = alias summaries + `type` + `aliasCount` + `fileName` — **never the keystore bytes, never a password, never a private key**. Every mutation returns fresh meta (main re-inspects internally = Apinizer's `afterMutation`). This is the exact analogue of OTP keeping `secret` out of `OtpEntryMeta` and gating plaintext behind an explicit `otp:reveal`.

Public material MAY cross to the renderer: certificate PEM (Detail dialog / copy button), fingerprints, subject/issuer, SAN, expiry. Private material (private-key PEM, PKCS12/JKS bytes) crosses **only** as the payload of an explicit user-initiated `saveAs`/`exportCertificate`, and even then goes disk-to-disk in main via a save dialog.

Because the store is app-global (Zustand), the session survives tab switches and the `PersistentToolTabs` mount/unmount — the `sessionId` is the durable handle, disposed only on explicit **Close** (`keystore:closeSession`) or app quit. This fixes the "state lost on tab close" gotcha that afflicts tools keeping input in local `useState`.

### 3.5 IPC channel table

All handlers use the `wrap(fn) => { success:true, data } | { success:false, error }` helper. Register by adding `import { registerKeystoreHandlers }` and a `registerKeystoreHandlers()` call in `src/main/ipc/index.ts` (OTP is at import line 23, call line 55).

| Channel | Input | Output | Notes |
|---|---|---|---|
| `keystore:pickFile` | *(native dialog)* | `{ sessionId, meta, typeAutoDetected }` | reads bytes **at pick time** (certificate.handler pattern) — avoids the ~/Downloads/~/Desktop/~/Documents TCC `EPERM` |
| `keystore:createEmpty` | `{ type, storePassword }` | `{ sessionId, meta }` | JKS or PKCS12 |
| `keystore:inspect` | `{ sessionId }` | `KeystoreInspectResponse` (alias summaries) | compact `AliasSummary[]`, no PEM/bytes |
| `keystore:aliasDetail` | `{ sessionId, alias }` | `KeystoreAliasDetail` (chain of `CertificateInfo` + public PEM) | public material only |
| `keystore:generateKeyPair` | `{ sessionId, alias, keyAlgorithm, keySize?/curve?, subjectDN?, subjectAlternativeNames?, validityDays?, serialNumber?, keyUsage?, basicConstraintsCa, signatureAlgorithm?, entryPassword? }` | `meta` | RSA→node-forge, EC→@peculiar/x509 |
| `keystore:generateSecretKey` | `{ sessionId, alias, keyAlgorithm='AES', keySize?, entryPassword? }` | `meta` | **PKCS12 only** |
| `keystore:importPkcs12` | `{ sessionId, sourceBytes\|sourcePath, sourcePassword?, sourceAlias?, alias?, entryPassword? }` | `meta` | empty `sourceAlias` ⇒ copy ALL importable entries |
| `keystore:importKeyMaterial` | `{ sessionId, alias, privateKeyPem, certificatePem, entryPassword? }` | `meta` | PKCS#8 & OpenSSL/PKCS#1; key-cert match gate |
| `keystore:importPem` | `{ sessionId, alias, pemContent, entryPassword? }` | `meta` | key+cert ⇒ key entry; cert-only ⇒ trusted entry |
| `keystore:importTrustedCert` | `{ sessionId, alias, certificateContent }` | `meta` | PEM or base64 DER |
| `keystore:renameAlias` | `{ sessionId, alias, newAlias, entryPassword? }` | `meta` | key vs certificate branch |
| `keystore:changeStorePassword` | `{ sessionId, newPassword, aliasEntryPasswords? }` | `meta` | re-encrypts every key entry |
| `keystore:setEntryPassword` | `{ sessionId, alias, entryPassword?, newEntryPassword }` | `meta` | key entries only |
| `keystore:deleteEntry` | `{ sessionId, alias }` | `meta` | |
| `keystore:exportCertificate` | `{ sessionId, alias, format:'DER'\|'PEM'\|'PKCS7'\|'PKIPATH' }` | `{ path }` | save-dialog write in main; **public cert only** |
| `keystore:exportJwk` | `{ sessionId, alias }` | public JWK (jose) | include-now extra |
| `keystore:convert` | `{ sessionId, targetType, newPassword, entryPassword? }` | new `{ sessionId, meta }` | JKS ⇄ PKCS12; original session untouched |
| `keystore:saveAs` | `{ sessionId }` | `{ path }` or `{ canceled:true }` | `showSaveDialog` + `fs.writeFile`; clears `dirty` (Model A) |
| `keystore:viewTlsCert` | `{ host, port=443, servername? }` | `CertificateInfo[]` | `tls.connect` in main; include-now extra |
| `keystore:closeSession` | `{ sessionId }` | `{}` | disposes the in-main session (frees bytes/passwords) |

### 3.6 Renderer store + ToolShell component

- **`src/renderer/stores/keystore.store.ts`** (NEW Zustand): `const api = window.api.keystore`, an `unwrap<T>()` helper that throws on `!success`, and CRUD actions mirroring `otp.store.ts`. State = `{ sessionId, meta, dirty }`.
- **`ToolShell`** (`src/renderer/components/tools/ToolShell.tsx`) takes `{ title, toolbar?, inputPane, outputPane, footer?, inputLabel?, outputLabel? }` and renders a header row over two side-by-side flex panes with a `border-r` divider. `KeystoreTool` follows OTP's shape: **`inputPane`** = keystore open/create + password + alias list; **`outputPane`** = selected-entry detail / PEM export.
- Sub-components (to honor the ~200-line component rule): `keystore/AliasTable.tsx` (type badge / algorithm / expiry coloring + row actions), `keystore/CertificateDetailDialog.tsx` (`CertificateInfo` + PEM in Monaco + copy), `keystore/GenerateKeyPairDialog.tsx` (RSA/EC form: keySize/curve/SAN/keyUsage/validity/serial), `keystore/ImportDialog.tsx` (5-format dynamic form), `keystore/ConvertExportDialogs.tsx` (convert / export-certificate / save).

### 3.7 Preload bridge

- **`src/preload/index.ts`** — add a `keystore: { … }` object of `ipcRenderer.invoke('keystore:*', …)` wrappers next to the `otp:` block (lines 424-434).
- **`src/preload/index.d.ts`** — **TWO** edits: a `KeystoreApi` interface (like `OtpApi` at line 1802) **AND** a `keystore: KeystoreApi` field on the top-level `Api` interface (line ~1900). Missing the field means `window.api.keystore` is untyped and `npm run typecheck` fails.

### 3.8 File-open (ingesting keystore files)

Use pattern **(B) — native picker in main**, the `certificate.handler.ts#certificate:pickFile` shape (lines 97-130): `dialog.showOpenDialog({ filters:[{ name:'PKCS12', extensions:['p12','pfx','jks'] }] })` then `readFileSync` **at pick time**. This is the cleaner fit because the engine is already in main and it avoids pushing raw keystore bytes across the contextBridge (pattern (A), the QrTool `<input type=file>` → `ArrayBuffer` → IPC round-trip, would).

**CRITICAL TCC discipline:** read the bytes immediately while the user's picker selection grants access. Do **not** store the path and re-read at parse time — files in `~/Downloads`, `~/Desktop`, `~/Documents` then throw `EPERM` (the v1.4.37 silent-mTLS-drop bug). Type auto-detection: JKS by magic `FE ED FE ED`, PKCS12 by ASN.1 DER `30 82`; the user can override the detected type.

### 3.9 Exact file layout

**Core (Faz 1–4):**

```
src/main/lib/keystore.ts                                            NEW   engine: session Map, resolveType/loadKeyStore/loadOrCreate/mutate,
                                                                          all 18 ops, verifyKeyMatchesCertificate, CertificateInfo, error classes
src/main/lib/jks-writer.ts                                          NEW   pure-TS JKS writer (Option C): 0xFEEDFEED magic, SHA-1 keystream key
                                                                          protector (OID 1.3.6.1.4.1.42.2.17.1.1), SHA-1 store integrity hash
src/main/ipc/keystore.handler.ts                                    NEW   wrap(fn) => {success,data|error}; passwords/keys never leave main
src/main/ipc/index.ts                                               EDIT  import registerKeystoreHandlers + call in registerAllHandlers()
src/renderer/types/index.ts                                         EDIT  'tools.keystore' in Protocol union AND TOOL_PROTOCOLS; Keystore DTOs
src/renderer/lib/tools-catalog.ts                                   EDIT  import FileKey + TOOL_CATALOG entry (utility-calculators section)
src/renderer/components/layout/Workbench.tsx                        EDIT  import KeystoreTool + TOOL_COMPONENTS['tools.keystore']
src/renderer/components/tools/KeystoreTool.tsx                      NEW   ToolShell wrapper
src/renderer/components/tools/keystore/AliasTable.tsx               NEW
src/renderer/components/tools/keystore/CertificateDetailDialog.tsx  NEW
src/renderer/components/tools/keystore/GenerateKeyPairDialog.tsx    NEW
src/renderer/components/tools/keystore/ImportDialog.tsx             NEW
src/renderer/components/tools/keystore/ConvertExportDialogs.tsx     NEW
src/renderer/stores/keystore.store.ts                               NEW   Zustand {sessionId, meta, dirty}; unwrap<T>()
src/preload/index.ts                                                EDIT  keystore:{…} ipcRenderer.invoke bridge object
src/preload/index.d.ts                                              EDIT  KeystoreApi interface + keystore field on Api
src/renderer/lib/i18n.ts                                            EDIT  tools.keystore.* in BOTH en and tr
```

**Tests:**

```
tests/main/keystore.test.ts             NEW   engine known-answer tests (no Electron, no DB)
tests/main/handlers/keystore.test.ts    NEW   IPC envelope + no-leak (setupHandlerHarness + makeElectronMock)
tests/main/keystore-interop.test.ts     NEW   describe.skipIf(!hasKeytool && !hasOpenssl) — real keytool/openssl
tests/fixtures/certs/generate.sh        EDIT  add keytool step → client.jks (+ new fixtures) and document in README.md
tests/renderer/keystore-i18n.test.ts    NEW   (optional) en/tr key parity, mock-hint-i18n.test.ts pattern
```

**Phase 5 (Model C bridge — separate PR):**

```
src/main/lib/keystore-bridge.ts                         NEW   resolveKeystoreAlias(keystoreId,alias) => {certPem,keyPem,chainPem?,passphrase?}
src/main/db/database.ts                                 EDIT  certificates: ALTER TABLE + CREATE TABLE add source/keystore_id/keystore_alias
src/main/db/certificate.repo.ts                         EDIT  CertificateRow/CreateCertificateInput + INSERT/UPDATE column lists
tests/main/handlers/helpers.ts                          EDIT  mirror the three new columns in SCHEMA_SQL (MANDATORY — else CI reddens)
src/main/ipc/request.handler.ts                         EDIT  loadCertificatesFor: branch on row.source==='keystore'
src/main/ipc/runner.handler.ts                          EDIT  route through the shared resolver (closes the Send≡Run mTLS gap)
src/main/protocols/soap.engine.ts (or soap.handler.ts)  EDIT  resolve alias-backed WsSignConfig into SignConfig PEM before applyWsSecurity
src/renderer/types/index.ts                             EDIT  WsSignConfig gains {certificateId} / {keystoreId, alias} alternative
src/main/ipc/certificate.handler.ts                     EDIT  extend Add/UpdatePayload; add a keystore picker / list-aliases IPC
```

### 3.10 i18n & registration recap

`src/renderer/lib/i18n.ts` is a single flat `Record<Locale, Record<string,string>>` with an `en:` block (lines 10-1570) and a `tr:` block (lines 1571-3137); keys are flat dotted strings. Add the `tools.keystore.*` namespace **twice** with an identical key set: `.title` (the catalog label), every dialog/button/label, all dropdown option labels (§9.6), and the entire §8 error catalogue as `tools.keystore.error.*`. Placeholder tokens (`{type}`, `{alias}`, …) must be identical across en/tr. There is **no automated parity check** — the optional `tests/renderer/keystore-i18n.test.ts` is the only guard.

---

## 4. Key Decisions

| Topic | Decision | Rationale | Rejected alternative |
|---|---|---|---|
| **Tool class** | Main-process engine + IPC handler; renderer is pure UI over `window.api.keystore` | Binary keystore parsing, keygen, cert building and JKS hashing need Node crypto/fs; private-key & passphrase material must never enter the Chromium renderer | Browser-safe pure-TS tool in `src/renderer/lib/tools/` (QR pattern) — cannot run Node crypto, would expose secrets |
| **State model** | `sessionId` — Buffer + passwords + entry-pw map only in a main `Map`; renderer holds sessionId + safe meta | Single-process desktop has no network base64 requirement; keeps raw bytes and secrets out of the renderer (mirrors OTP secret-in-main); store-global sessionId survives tab switches | base64 working-copy in the renderer (Apinizer model) — simpler, but ships keystore bytes + private keys into the renderer |
| **Persistence** | **Model A** (Save-As via dialog + `fs`); **no repo/table/migration** for the tool | Keystore Studio is a stateless inspector/generator; only user-initiated Save-As persists. Skips the entire DB layer — a valid lighter variant of the OTP pattern | **Model B** (persisted keystore library table) deferred; would need `keystore.repo.ts` + migration + mandatory `helpers.ts` SCHEMA_SQL mirror + `encryptSecret` for stored passwords |
| **JKS write path** | **Option C** — pure-TS `src/main/lib/jks-writer.ts` with `@noble/hashes` SHA-1; keep **Option A** (keystore-go binary) as *fallback only* | Avoids Testnizer's biggest CI pain: per-platform `extraResources`, six bundled binaries across mac/win/linux jobs, macOS notarization of an embedded Mach-O, and the `verify-natives.js` blind spot (it only walks `*.node`). Arch-independent, unit-testable; JKS is a frozen, fully-specified format | **Option A** native Go binary (doubles packaging/signing surface); **Option B** WASM (Go runtime + GC + `wasm_exec.js`, new toolchain, no benefit over C); **Option D** keytool sidecar (no bundled Java) |
| **EC certificates** | `@peculiar/x509` for EC (P-256/384/521) self-signed certs; `node-forge` for RSA; Node `crypto.generateKeyPairSync` for both keygens | node-forge EC/ECDSA support is weak; @peculiar covers EC keypair+cert. RSA via forge is sufficient and CJS-safe | forge-only (weak EC); Node crypto alone cannot **build** certificates. secp256k1 deferred (needs `@noble/curves`) |
| **@peculiar/x509 ESM trap** | If it lacks a CJS `require` entry, add it (and, if needed, the whole `@peculiar/*` graph) to `externalizeDepsPlugin({ exclude: [...] })` so Rollup bundles it; verify against the **built app** | `externalizeDepsPlugin` leaves deps as `require()`; Electron's Node cannot `require(ESM)` → launch crash before the window opens (v1.4.19 class), hidden by system Node ≥22 | Leave it externalized — risks `ERR_REQUIRE_ESM` at launch |
| **@noble/hashes** | Promote from transitive-only to a **direct dependency** | Used directly by the JKS writer for SHA-1; a future dedupe/prune could remove a transitive-only dep and break the build | Rely solely on `crypto.createHash` (also viable) — direct dep keeps the writer portable/testable |
| **BouncyCastle provider ordering (§6.9)** | Drop entirely | `ensureBcProviderAtEnd` is a BouncyCastle-Java PKCS12-MAC concern; node-forge has no provider ordering | Port it — unnecessary and meaningless in Node |
| **Model C bridge shape** | Single shared resolver `src/main/lib/keystore-bridge.ts` emitting canonical PEM, wired into `request.handler`, `runner.handler`, and WSSE | mTLS wants Node Buffers, WSSE wants PEM strings; one PEM-emitting resolver satisfies both (`Buffer.from(pem)` for TLS, PEM direct for WSSE). Mirrors the shared OAuth2 token-fetch helper | Two separate bridges — duplicative and drift-prone; leaving Runner unwired reintroduces the Send≡Run parity gap |
| **Scope beyond Apinizer** | Include live-TLS cert viewer, JWK export, key-cert match validation, expiry coloring. Defer CSR/CA/CRL/JAR/JWT signing, revocation, BKS/UBER/BCFKS, PVK/SPC, Ed25519, secp256k1 | Live-TLS view and JWK export directly serve API testing (mTLS debugging, JOSE); `jose` is already a dep. Signing/CA/exotic-format features are outside a test client's identity | Full KeyStore Explorer parity — large surface, low API-testing value |

### 4.1 Crypto library mapping (18 ops → Node)

- **Key pair (RSA/EC):** Node built-in `crypto.generateKeyPairSync('rsa'|'ec', …)` — already present.
- **Self-signed X.509v3 RSA:** `node-forge` `pki.createCertificate` (basicConstraints / keyUsage / SAN extensions).
- **Self-signed X.509v3 EC (P-256/384/521):** `@peculiar/x509` `X509CertificateGenerator.createSelfSigned`. Requires `x509.cryptoProvider.set(require('crypto').webcrypto)` at engine init.
- **PEM parse (key/cert):** `jose` (`importPKCS8` / `importX509`, already a dep) or node-forge `pki.*FromPem`.
- **PKCS12 read/write:** `node-forge` `pkcs12FromAsn1` / `toPkcs12Asn1`. Set `algorithm:'aes256'` for keytool/Java parity (§S.6.2) — forge defaults to 3DES. **Multi-alias is NOT a one-liner** (risk R2): hand-assemble SafeBags/SafeContents with `friendlyName` (alias) + `localKeyID` linking each cert to its key.
- **Cert path PKCS7 / PkiPath export:** `node-forge pkcs7` for PKCS7; PkiPath is a manual ASN.1 `SEQUENCE OF Certificate` in **root-first** order (reverse of PKCS7).
- **AES secret key:** Node `crypto.randomBytes` — PKCS12 only, JKS cannot hold secret keys.
- **Fingerprints SHA-1/256:** Node `crypto.createHash` or `@noble/hashes`; output UPPERCASE colon-separated hex.
- **`verifyKeyMatchesCertificate` (§6.7, critical):** prefer the deterministic check — `crypto.createPublicKey(privateKey)` → export SPKI DER → compare to the certificate's SPKI DER. No algorithm selection, correct for RSA/EC/Ed. Keep Apinizer's sign-probe/verify-probe (`"apinizer-keystore-studio-key-match-probe"`, US-ASCII) as a **secondary** check with explicit per-type algorithm handling (SHA256withRSA / SHA256withECDSA; unsupported algorithms early-return without throwing). Failure message: `Private key does not match the provided certificate`.
- **BC-provider ordering (§6.9):** dropped — a BouncyCastle-Java concern with no node-forge equivalent.

### 4.2 Package additions

| Package | Action | Purpose / caveat |
|---|---|---|
| `node-forge` | **add** | PKCS12 read/write + RSA self-signed X.509v3 + PEM/ASN.1. Ships a CJS `require` export → safe to leave externalized. |
| `@types/node-forge` | **add (dev)** | types |
| `jks-js` | **add** | JKS **read** (`toPem` / `parseJks` / `parsePkcs12`) + round-trip verification of the pure-TS writer. CJS-safe. |
| `@peculiar/x509` | **add** | EC key pair + EC self-signed cert (forge EC is weak). **ESM-first** — verify a CJS entry, else `externalizeDepsPlugin` exclude (be ready to exclude the whole `@peculiar/*` subtree: `@peculiar/asn1-*`, `pvtsutils`, `pvutils`). |
| `@noble/hashes` | **promote** transitive → direct | SHA-1 for JKS integrity + key protection + fingerprints. Installed at 1.8.0 but not in the `dependencies` block today. |
| `jose` | no change (`^6.2.3`) | PEM parse + JWK export |
| `@noble/curves` | **deferred** | only if secp256k1 is later requested |

### 4.3 Error contract

Two classes mirroring Apinizer's 400 vs 500 split (§8):

- **`KeystoreValidationException`** — user-fixable (empty password, alias clash, key-cert mismatch, unsupported curve/size/format). The message is shown **verbatim** (i18n'd via `tools.keystore.error.*`) in a toast.
- **`KeystoreEngineException`** — parse/unexpected. Logged and shown as the friendlier "Password is wrong or the file is corrupt". A wrong store password surfaces here (node-forge MAC failure), never as a raw stack.

**Never log** key material, passwords, or keystore bytes (§10.2) — including inside caught-exception messages and stack traces.

---

## 5. Model C — Keystore-Alias → mTLS / Client-Cert / WSSE Bridge (Phase 5)

A keystore alias is one private key + one certificate chain. Two consumers want it in two different shapes:

- **mTLS request path** (`http.engine.ts:233-241, 1126-1142`): `HttpRequestOptions.certificates = { caCerts?: Buffer[], clientCert?: { cert?: Buffer, key?: Buffer, pfx?: Buffer, passphrase?: string } }` — raw file bytes as Node `Buffer`s mapped straight onto `https.Agent` (`pfx`+`passphrase`, else `cert`+`key`; `caCerts` → `ca`). This is the **only** place client certs attach to a connection.
- **WSSE signing path** (`wsse.engine.ts:87-93, 362-369`): `SignConfig = { privateKeyPem: string, certPem: string, … }` — **PEM strings** fed into xml-crypto `new SignedXml({ privateKey, publicCert })`. Sourced today from the renderer's user-pasted `WsSignConfig` (`types/index.ts:373`); there is currently **no link** between the `certificates` table and WSSE signing.

A **single resolver emitting canonical PEM** satisfies both — PEM strings feed WSSE directly, `Buffer.from(pem)` feeds the TLS agent. Don't build two bridges. This mirrors how OAuth2 token-fetch became one shared main-process helper reused by Send and Runner.

### 5.1 Schema

Extend the **existing** `certificates` table (columns today: `id, project_id, kind('ca'|'client'), host, crt_path, key_path, pfx_path, passphrase, enabled, created_at` — rows store **file paths**, never inline material) via an ALTER TABLE migration **plus** the CREATE TABLE at `database.ts:519`, **mirrored in `tests/main/handlers/helpers.ts` SCHEMA_SQL in the same change** (production ALTER migrations do not run against `createTestDb()`; a missing column makes handler INSERTs silently return `success:false` with `no such column` and reddens the CI quality job):

- `source TEXT NOT NULL DEFAULT 'file'` — `'file'` | `'keystore'`
- `keystore_id TEXT`
- `keystore_alias TEXT`

`crt_path`/`key_path`/`pfx_path` stay `NULL` for keystore rows. The store/key password rides the existing `passphrase` column, still `encryptSecret()`-encrypted (`safeStorage`, `enc:v1:` prefix) at the handler boundary and `decryptSecret()`-ed in `loadCertificatesFor`. **A keystore row still needs a `host` (or `*`)** — `certHostMatches` / `listCertificatesForHost` selection applies unchanged, or the row will never be selected for a request.

> **Passphrase modeling caveat (R11):** a keystore has BOTH a store password and a per-alias key password, while the row has one `passphrase` column. Model both explicitly (store password on a keystore reference / future `keystores` row, key password on the cert row), both `encryptSecret`-encrypted. Confirm before implementing — see Open Question Q4.

### 5.2 Resolver

`src/main/lib/keystore-bridge.ts`:

```ts
resolveKeystoreAlias(keystoreId: string, alias: string):
  { certPem: string; keyPem: string; chainPem?: string[]; passphrase?: string }
```

It opens the keystore (PKCS12/JKS) reusing the Keystore engine, pulls the alias's key + certificate chain, and exports canonical PEM. Prefer Node `crypto` (`X509Certificate`, `createPrivateKey` — already imported in `wsse.engine.ts`) for PKCS12→PEM where possible, to avoid pulling another ESM-only dependency into the externalized main bundle.

**It must re-impose the safety rails a keystore-backed row bypasses** (R12): `readCertFile`'s symlink-resolve + extension whitelist `{.crt,.cer,.pem,.key,.pfx,.p12}` + 1 MiB cap do not run for these rows, so the resolver needs its own size cap and trusted-source checks.

### 5.3 Wire into the existing junctions (no second path)

- **mTLS (Send):** in `request.handler.ts#loadCertificatesFor` (lines 139-164), branch on `row.source === 'keystore'` → `resolveKeystoreAlias(...)` → `clientCert = { cert: Buffer.from(certPem), key: Buffer.from(keyPem), passphrase }`, and push chain intermediates into `caCerts`. Identical downstream shape ⇒ **zero `http.engine.ts` changes**. Keep the existing `{error}` fail-fast contract so an alias that cannot be opened fails the request **loudly** rather than going out unauthenticated.
- **Runner (close the pre-existing gap in the same PR):** `runner.handler.ts` (lines 847, 1390-1396) calls `executeHttpRequest` directly and only sets `resolvedOptions.projectId` — it never calls `loadCertificatesFor`, so **Runner/Test-Suite runs attach NO client certificate today**. Route Runner through the **shared** resolver so Model C mTLS works on Run as well as Send (the Send≡Run parity class CLAUDE.md flags repeatedly). Note this also switches on **file-based** client certs for existing Runner runs — treat as a deliberate, documented behavior change (release note) and add a Runner-path test covering both file-backed and keystore-backed rows (R5).
- **WSSE:** extend `WsSignConfig` (`types/index.ts:373`) with a `{ certificateId }` / `{ keystoreId, alias }` alternative to pasted PEM, and resolve it **in main** (`soap.engine.ts:786` where `wsseConfig` is built, or in `soap.handler` before `executeSoap`) via the same resolver, populating `SignConfig.privateKeyPem` / `certPem`. Never ship resolved PEM to the renderer.

---

## 6. Implementation Phasing (Faz 0–5, mapped to issue #59)

### Faz 0 — Scaffold + JKS-write spike **(DE-RISK GATE)**

**Files:** `src/main/lib/jks-writer.ts` (PoC), `src/main/lib/keystore.ts` (skeleton: session Map + error classes + `resolveType`), `src/main/ipc/keystore.handler.ts` (skeleton), `src/main/ipc/index.ts`, `package.json` deps, `tests/main/keystore-interop.test.ts` (first KATs), `.github/workflows/build.yml` (`actions/setup-java`).

**Deliverable:** dependencies added; the Option-C JKS writer PoC proven against **real `keytool -list`** (the mandatory acceptance gate — must NOT stay `skipIf`-gated in CI); **multi-alias PKCS12 assembly prototyped** alongside it (R2); Model A confirmed. If the spike does not pass keytool cleanly, decide Option A vs C **now** — not after Faz 1–4 are built on C (R9).

### Faz 1 — Foundation (read-only)

**Ops:** `createEmpty`, `open`/`loadKeyStore` (+ `resolveType`), `inspect`, `aliasDetail`.
**Files:** engine read paths, `keystore:pickFile|createEmpty|inspect|aliasDetail|closeSession`, preload + `index.d.ts`, `keystore.store.ts`, `KeystoreTool.tsx`, `AliasTable.tsx`, `CertificateDetailDialog.tsx`, i18n en/tr, `types/index.ts` DTOs + catalog + Workbench registration.
**Deliverable:** a standalone keystore **viewer** — Open/Create empty-state, alias table (badge / algorithm / expiry coloring), Detail dialog.

### Faz 2 — Generate

**Ops:** `generateKeyPair` (RSA via node-forge, EC via @peculiar/x509), `generateSecretKey` (AES, PKCS12 only).
**Files:** engine generate paths, `GenerateKeyPairDialog.tsx`, Add-Entry menu, i18n additions, `tests/main/keystore.test.ts` generate suite.
**Deliverable:** self-signed client-certificate generation — the top mTLS value.

### Faz 3 — Import

**Ops:** `importPkcs12` (copyEntry), `importKeyMaterial` (PKCS#8/OpenSSL), `importPem`, `importTrustedCertificate`, `verifyKeyMatchesCertificate`.
**Files:** engine import paths + `parsePrivateKey`/`parseCertificates`, `ImportDialog.tsx` (5 formats), fixture additions in `generate.sh`, import test suites.
**Deliverable:** all import formats behind the cryptographic key-cert match gate.

### Faz 4 — Edit / Export / Persist

**Ops:** `renameAlias`, `changeStorePassword`, `setEntryPassword`, `deleteEntry`, `exportCertificate` (DER/PEM/PKCS7/PkiPath), `convert` (JKS⇄PKCS12), `saveAs` (Model A), dirty-guard. Plus the two include-now extras (`viewTlsCert`, `exportJwk`).
**Files:** engine mutate/export/convert/serialize paths, `ConvertExportDialogs.tsx`, unsaved-changes guard, i18n, edit/export test suites + interop round-trips.
**Deliverable:** feature-complete tool.

### Faz 5 — Model C mTLS/WSSE bridge (separate PR)

**Files:** §5 — `keystore-bridge.ts`, `database.ts` migration + CREATE TABLE, `certificate.repo.ts`, `helpers.ts` SCHEMA_SQL mirror, `request.handler.ts`, `runner.handler.ts`, `soap.engine.ts`/`soap.handler.ts`, `types/index.ts` `WsSignConfig`, `certificate.handler.ts` payloads + keystore picker IPC.
**Deliverable:** a keystore alias selectable as an mTLS client certificate (**Send *and* Run**) and as a WS-Security signing key, through one shared PEM resolver.

---

## 7. Risks & Mitigations (severity-sorted)

| # | Severity | Area | Risk | Mitigation |
|---|---|---|---|---|
| **R1** | **blocker** | JKS write interop proof self-disables in CI | The "mandatory acceptance gate" (`keytool -list` on the pure-TS writer output) is `describe.skipIf(!hasKeytool)`, and the CI `quality` job (ubuntu-latest) has **no `setup-java`**. Runners happen to ship a JDK today, but nothing asserts the test actually ran and nothing pins the JDK; a runner-image change or an accidental `continue-on-error` silently drops the only proof the key protector + "Mighty Aphrodite" integrity hash are byte-correct. Round-tripping via `jks-js` is **circular** — jks-js reading jks-js-shaped bytes proves nothing about keytool. | Add explicit `actions/setup-java` (Temurin) to the quality job and make the interop test **hard-fail in CI** rather than skip: keep `skipIf` for local dev but `if (process.env.CI && !hasKeytool) throw`. Prove **both** directions — TS-writer output opened by real keytool, and keytool-produced `client.jks` read by the engine. Keep openssl parity for the PKCS12 side. |
| **R2** | **blocker→high** | Multi-alias PKCS12 assembly in node-forge | `pkcs12.toPkcs12Asn1(key, cert, pass, opts)` is a **single key + single cert(chain)** API. A keystore with N alias entries cannot be exported/converted to one `.p12` with the high-level call — you must hand-assemble SafeBags/SafeContents and set `friendlyName` (alias) + `localKeyID` linking each cert to its key. The design lists `convert` (JKS⇄PKCS12) and `copyEntry` as core but treats P12 write as a one-liner. **Most underestimated item.** | Prototype multi-entry P12 assembly in **Faz 0** alongside the JKS spike; verify `keytool -list` shows every alias with the correct `friendlyName`. If manual ASN.1 proves fragile, explicitly scope MVP export to **single-alias** P12 and defer multi-alias convert — rather than discovering it in Faz 4. |
| **R3** | **high** | JKS vs JCEKS format contradiction | The narrative names magic `0xFEEDFEED` (JKS) but describes "SunJCE keyProtector" — SunJCE/JCEKS is a **different format** (magic `0xCECECECE`, PBEWithMD5AndTripleDES key protection). JKS proper uses Sun's proprietary SHA-1 keystream protector under OID `1.3.6.1.4.1.42.2.17.1.1`. An implementer reading "SunJCE" may build the wrong key-protection algorithm or wrong `EncryptedPrivateKeyInfo` OID, producing a file keytool rejects — and the skip-gated test won't catch it. | Fix the spec: target **JKS**, OID `1.3.6.1.4.1.42.2.17.1.1`, SHA-1 keystream XOR protector, SHA-1 store hash over `UTF-16BE(password) + "Mighty Aphrodite" + encoded data`. Pin the exact structure with a **keytool-generated known-answer vector** committed as a fixture and byte-compared — not merely round-tripped. |
| **R4** | **high** | `@peculiar/x509` ESM + WebCrypto provider | `@peculiar/x509` is ESM-first and drags an ESM subtree (`@peculiar/asn1-*`, `pvtsutils`, `pvutils`). Excluding only `@peculiar/x509` in `externalizeDepsPlugin` may leave a transitive as an externalized `require(ESM)` → `ERR_REQUIRE_ESM` launch crash (v1.4.19 class), invisible under system Node ≥22. Separately, it needs an explicit crypto provider (`x509.cryptoProvider.set(webcrypto)`) in the Electron main Node or cert generation throws at runtime. | Verify against the **BUILT app + smoke**, not bare node. Be prepared to exclude the whole `@peculiar/*` graph (multiple entries), not just `x509`. Wire and unit-test `cryptoProvider.set(require('crypto').webcrypto)` at engine init. Consider whether EC certs can be built with Node's own X509 tooling to avoid the dep entirely; if kept, gate on a built-app EC-cert smoke. |
| **R5** | medium | Model C Runner cert routing (Send≡Run) | Closing the Runner mTLS gap means routing `runner.handler` through the resolver — but Runner attaches **no** client cert today, so this silently turns on **file-based** client certs for ALL existing Runner/Test-Suite runs, not just keystore rows. That is a behavior change for users who have file certs configured but relied on Run not sending them. | Treat the Runner cert-attach as a deliberate, **documented** behavior change (release note); add a Runner-path interop test proving both file-backed and keystore-backed rows attach; confirm the `{error}` fail-fast contract propagates so an unopenable alias fails the Run loudly rather than going out unauthenticated. |
| **R6** | medium | PKCS12 AES vs 3DES / node-forge MAC interop | node-forge P12 defaults to 3DES; `algorithm:'aes256'` is correct for modern Java/OpenSSL-3 parity, but node-forge's integrity MAC is old-style SHA-1 PBE (not PBMAC1) and AES-in-P12 interop with keytool has historically been finicky. Wrong here ⇒ keytool/openssl refuse the exported P12. | Interop-test the P12 export with **both** `keytool -list` and `openssl pkcs12 -info` (both available on this dev machine). If MAC/AES interop fails, fall back to 3DES with a documented compatibility note, or emit the P12 via Node's own KeyObject export path where feasible. |
| **R7** | medium | Key–cert match verification across RSA/EC | Porting Apinizer's sign-probe/verify-probe requires per-key-type algorithm selection (RSA-PKCS1 vs PSS, ECDSA+hash, Ed25519 null-hash). A naive port picks one hash and throws or false-negatives for EC keys, surfacing "key does not match cert" on a **valid** pair. | Prefer the deterministic check: `crypto.createPublicKey(privateKey)` → export SPKI DER → compare to the certificate's SPKI DER (no algorithm selection; correct for RSA/EC/Ed). Keep the sign/verify probe only as a secondary check with explicit per-type handling and a test matrix over RSA-2048, P-256, P-384. |
| **R8** | medium | Session memory lifecycle | `Map<sessionId, session>` holds keystore bytes + **decrypted private keys** + passwords in the main heap, disposed only on explicit Close. No TTL, no cap, no dispose-on-tab-close. Users open several keystores, switch away, and long-lived plaintext key material accumulates for the whole app session; a main-process crash dump or swap could expose it. | Add idle eviction (dispose after N minutes untouched) + a max-open cap, and dispose on the **tool-tab-close** event, not only the Close button. Overwrite/null Buffers on dispose (best-effort). Assert in the handler test that `closeSession` removes the entry and no reveal works afterward. |
| **R9** | medium | Option A fallback cost is understated | "Keep Option A as a fallback if interop bugs prove unresolvable" implies a cheap pivot, but Option A = a new `download-keystore-go.js`, three per-platform `extraResources` overrides, six CI binary fetches, macOS notarization signing of an embedded Mach-O, an unsigned Windows `.exe` (SmartScreen/AV risk for a crypto tool), and a `verify-natives.js` blind spot. Discovering Option C is byte-wrong late forces this expensive pivot under release pressure. | De-risk Option C in **Faz 0** with the real keytool KAT **before any UI is built**. If the Faz 0 spike doesn't pass keytool cleanly, decide A vs C then. Do not treat A as a drop-in late escape hatch. |
| **R10** | low | Two divergent cert-build paths | RSA via node-forge and EC via `@peculiar/x509` are two independent X.509 builders that can encode SAN / keyUsage / basicConstraints / validity differently, so a generated RSA client cert and an EC client cert may not behave identically in downstream mTLS handshakes or keytool display. | Snapshot-test both builders' output extensions against a single expected profile; assert SAN/keyUsage/EKU parity across RSA and EC in the engine test so drift is caught. |
| **R11** | low | Model C passphrase model | A keystore has BOTH a store password and a per-alias key password, but the `certificates` row reuses the single existing `passphrase` column. Which password it holds is ambiguous, and JKS/JCEKS commonly use distinct store vs key passwords — one column silently breaks alias resolution when they differ. | Model both explicitly (store password on a keystore reference, key password on the cert row), both `encryptSecret`-encrypted at the handler boundary; mirror the new columns in `tests/main/handlers/helpers.ts` SCHEMA_SQL in the same change or handler INSERTs fail with `no such column`. |
| **R12** | low | `readCertFile` safety-rail bypass | A keystore-backed cert row skips `readCertFile`'s symlink-resolve + extension whitelist + 1 MiB cap. `resolveKeystoreAlias` must re-impose equivalents or the mTLS security posture regresses (unbounded read, untrusted source). | Add a size cap + trusted-source checks inside `keystore-bridge.ts`; unit-test that an oversized/untrusted keystore is rejected the same way `readCertFile` rejects a bad file. |

**Verdict.** Architecturally sound; the biggest wins (main-process tool, sessionId-not-base64, Model A no-DB, Option C over a bundled binary, single PEM resolver for mTLS+WSSE+Runner) are the right calls — they correctly dodge Testnizer's worst CI/packaging/signing pain. **APPROVE-WITH-BLOCKERS:** R1 and R2 must be fixed before Faz 0 is called done, and R3's terminology contradiction must be corrected in the spec before the writer is implemented.

---

## 8. Detailed Test Cases

**Total: 272 cases**, grouped by phase plus a cross-cutting suite.

### 8.0 Test infrastructure

**Three test files (+1 optional):**

1. **`tests/main/keystore.test.ts`** — ENGINE known-answer tests. Import the engine directly (**no Electron, no DB**): `import { KeystoreEngine, KeystoreValidationException, KeystoreEngineException } from '../../src/main/lib/keystore'`. Read fixtures with `readFileSync(join(__dirname,'../fixtures/certs/…'))`. Modeled verbatim on `tests/main/otp.test.ts` (RFC-vector style). Validation errors asserted as `expect(() => …).toThrow(KeystoreValidationException)` **with the exact §8 message string**; parse/unexpected errors as `KeystoreEngineException`. RSA-4096 keygen is slow — bump the file/it timeout to 30 000 ms. Default-serial and validity cases use `vi.useFakeTimers()` + `vi.setSystemTime(FIXED)` so hex serials and ISO-UTC dates are deterministic.
2. **`tests/main/handlers/keystore.test.ts`** — IPC ENVELOPE + NO-LEAK. `const harness = setupHandlerHarness()`, `vi.mock('electron', () => makeElectronMock())` (drive `dialog.showOpenDialog`/`showSaveDialog` per-test like `certificate.test.ts` / `save.test.ts`), `const { registerKeystoreHandlers } = await import('../../../src/main/ipc/keystore.handler')`, `beforeEach(() => { harness.reset(); registerKeystoreHandlers() })`, drive via `harness.invoke('keystore:…', args)`. Assert the `{success, data?|error?}` envelope, and — **the security spine** — that no response object anywhere contains a store/entry password, a private-key PEM/DER, or raw keystore bytes.
3. **`tests/main/keystore-interop.test.ts`** — `describe.skipIf(!hasKeytool && !hasOpenssl)` (probe with `spawnSync` at module load; **in CI, hard-fail instead of skip** per R1). Writes to `os.tmpdir()` and shells out to real `keytool` / `openssl`. This dev machine has keytool (sdkman) and openssl (homebrew).
4. **`tests/renderer/keystore-i18n.test.ts`** (optional) — en/tr key parity, modeled on `tests/renderer/mock-hint-i18n.test.ts`; runs in the **renderer jsdom** project, not `tools`.

**Do NOT** place keystore tests in `tests/renderer/tools/` — that vitest `tools` project is for pure-TS browser-safe modules only. `pretest`/`pretest:unit` flip better-sqlite3 to the node ABI automatically; engine tests need no DB, and the engine test must never `import 'electron'`.

**Value conventions.** `CertificateInfo` per §6.6: `serialNumber` = `serial.toString(16)` lowercase hex (no `0x`, no colons, no sign); `sha1Fingerprint`/`sha256Fingerprint` = **UPPERCASE** colon-separated hex (`^([0-9A-F]{2}:){19}[0-9A-F]{2}$` / 32 bytes); `notBefore`/`notAfter` = `yyyy-MM-dd'T'HH:mm:ss'Z'`; `version` = 3 (human X.509 version, not the DER 2); self-signed ⇒ `subjectDN === issuerDN`; `keySize` = RSA modulus bits or **EC field size** (P-256→256, P-384→384, P-521→**521**, secp256k1→256); `sigAlgName` Java-style (`SHA256withRSA` / `SHA256withECDSA`). DN rendering may differ between encoders (RFC2253 ordering/spacing) — assert **substring containment** of RDN components in engine tests, exact strings only inside the interop file where cross-derived from the same tool.

**Fixtures** — `tests/fixtures/certs/`, password `testpassword` throughout, all regenerable via `generate.sh` (documented in `README.md`):

*Existing:* `client.p12` (PKCS12, single PrivateKeyEntry alias `test-client`, chain length 2 = leaf `CN=test-client, O=Testnizer Tests` + root `CN=Testnizer Test CA, O=Testnizer Tests`, RSA-2048, SHA256withRSA, serial `1440ae30e9d843a5fb3f994c81f8defa697bfcea`, SHA-1 FP `B5:5E:66:78:5F:D4:6F:BA:F4:E0:90:0B:5C:C2:89:DD:A8:94:4C:60`, SHA-256 FP `EE:4E:BA:BD:8A:41:A1:AB:CE:0E:B7:8C:77:7C:BA:62:17:AB:09:94:B1:F5:A8:FC:1D:10:79:2D:97:B1:2B:DA`, no SAN); `bad.p12` (corrupt — literally the text "this is not a valid p12 file"); `ca.crt`; `client.crt`; `client.key` (traditional PKCS#1 `BEGIN RSA PRIVATE KEY` — the OpenSSL-PEM fixture); `ca.key`; `server.crt`/`server.key` (mismatch source); `selfsigned.crt`/`selfsigned.key`.

*To add via `generate.sh`:*

| Fixture | Command | Used by |
|---|---|---|
| `client.jks` | `keytool -importkeystore -srckeystore client.p12 -srcstoretype PKCS12 -srcstorepass testpassword -destkeystore client.jks -deststoretype JKS -deststorepass testpassword -destalias test-client -noprompt` | JKS load/inspect/convert |
| `truststore.jks` | `keytool -importcert -noprompt -alias testca -file ca.crt -keystore truststore.jks -storepass testpassword` | TrustedCertificateEntry cases |
| `keytool-diffpass.jks` | `keytool -genkeypair … -storepass testpassword -keypass differentpass` | entry-pw ≠ store-pw interop + negatives |
| `client.pkcs8.key` | `openssl pkcs8 -topk8 -nocrypt -in client.key -out client.pkcs8.key` | importKeyMaterial PKCS#8 |
| `ec-p256.key` / `.pkcs8.key` / `.crt` | `openssl ecparam -genkey -name prime256v1` + pkcs8 + self-sign | EC import / field size |
| `ec-p384.key` / `.pkcs8.key` / `.crt` | same with `secp384r1` | EC 384 coverage |
| `client.der.b64` | `openssl x509 -in client.crt -outform DER \| base64` | base64-DER trusted-cert import |
| `secret.p12` | `keytool -genseckey -alias aes-secret -keyalg AES -keysize 256 -storetype PKCS12 -keystore secret.p12 -storepass testpassword -keypass testpassword` | secret-key copy / JKS skip |
| `multi.p12` | key entry `test-client` + trusted `ca-root` + secret `aes-secret` | all-aliases import, JKS secret-skip |
| `client-ec.p12` *(optional)* | P-256 key+cert, alias `ec-client` | EC keySize=field-size read path |

Prefer generating throwaway keystores into `os.tmpdir()` at runtime for interop rather than committing more binaries.

---

### 8.1 Faz 1 — Foundation (read-only): `createEmpty`, `loadKeyStore`/`resolveType`, `inspect`, `aliasDetail` — 50 cases

**Scope.** Only the four read-only/foundation operations: two engine calls (`createEmpty`, `loadKeyStore` + `resolveType`) plus the two read-only projections (`inspect` → `AliasSummary[]`, `aliasDetail` → `CertificateInfo[]`). No mutation ops. Behavior pinned to §4.1-4.3, §6.1-6.6, DTO field names §5, and the exact §8 error strings.

**Session-model note.** Passwords / entry-passwords / raw bytes live ONLY in the main `Map<sessionId,session>`; `inspect`/`aliasDetail` take `{sessionId}` and the session already carries the store password + type (established at open time — `pickFile` reads bytes at pick time, the renderer's open form supplies password + type). Handler cases therefore first establish a session, capture `sessionId`, then invoke. A wrong password surfaces at the first parse (`inspect`) as a generic `KeystoreEngineException` mapped to the friendly "wrong password or corrupt" message. `closeSession` frees bytes/passwords; an unknown/closed sessionId yields a **Testnizer-added** error (`Keystore session not found` — NOT in the §8 catalogue; flag it for i18n).

**DN/serial rendering caveat.** `subjectDN`/`issuerDN` come from the X500Principal-equivalent; node-forge / @peculiar may emit RFC2253 ordering/spacing differing from OpenSSL's display. Assert `subjectDN` **contains** both `CN=test-client` and `O=Testnizer Tests` (issuer contains `CN=Testnizer Test CA`) rather than pinning punctuation; keep exact-string checks only inside the interop file. `serialNumber` asserted case-insensitively. **Fingerprints are the one place to pin exactly.** Because these goldens track committed fixtures, a `generate.sh` re-run must refresh them — the interop file enforces that by deriving expected values from `openssl x509` / `keytool -list -v` on the same fixture.

#### Group A — `createEmpty` (KS-F1-01 … KS-F1-09)

**KS-F1-01 — createEmpty JKS produces an empty in-memory keystore** · *positive*
- **Preconditions:** `KeystoreEngine` importable; no session exists.
- **Steps:** (1) `engine.createEmpty({ type:'JKS', storePassword:'changeit' })` (handler: `harness.invoke('keystore:createEmpty', {type:'JKS', storePassword:'changeit'})`). (2) Capture `sessionId` and `meta`.
- **Expected:** Success. `meta.type==='JKS'`; `meta.aliasCount===0`; non-empty `sessionId`. Handler envelope `{success:true, data:{sessionId, meta}}`. An immediate `inspect` yields `aliases: []`.
- **Notes:** §4.1 output `KeystoreMutationResponse{aliasCount=0}`; §6.1 `resolveType('JKS')→JKS`. Bytes/password stay in the main session only.

**KS-F1-02 — createEmpty PKCS12 produces an empty keystore** · *positive*
- **Preconditions:** `KeystoreEngine` importable.
- **Steps:** `engine.createEmpty({ type:'PKCS12', storePassword:'changeit' })`.
- **Expected:** Success. `meta.type==='PKCS12'`; `aliasCount===0`; `sessionId` present.
- **Notes:** §4.1 for PKCS12; node-forge path; no BouncyCastle provider ordering (§6.9 dropped).

**KS-F1-03 — createEmpty rejects an empty store password** · *negative*
- **Steps:** `engine.createEmpty({ type:'JKS', storePassword:'' })`.
- **Expected:** Throws `KeystoreValidationException`, message exactly `Store password cannot be empty`. Handler: `{success:false, error:'Store password cannot be empty'}`. **No session created.**
- **Notes:** §4.1 `@NotBlank`; §8 catalogue line 1.

**KS-F1-04 — createEmpty rejects a whitespace-only store password (@NotBlank)** · *edge*
- **Steps:** `engine.createEmpty({ type:'PKCS12', storePassword:'   ' })`.
- **Expected:** Throws `KeystoreValidationException` `Store password cannot be empty` (whitespace-only is blank, matching Java `@NotBlank`). No session created.
- **Notes:** Boundary of `@NotBlank` vs `@NotEmpty`.

**KS-F1-05 — createEmpty rejects an unsupported keystore type** · *negative*
- **Steps:** `engine.createEmpty({ type:'JCEKS', storePassword:'changeit' })`.
- **Expected:** Throws `KeystoreValidationException` `Unsupported keystore type: JCEKS`. No session created. Also verify `'BKS'` → `Unsupported keystore type: BKS`.
- **Notes:** `createEmpty` routes type through `resolveType` (§6.1); §8.

**KS-F1-06 — createEmpty normalizes a lowercase type to canonical case** · *edge*
- **Steps:** `engine.createEmpty({ type:'pkcs12', storePassword:'changeit' })`.
- **Expected:** Success. `meta.type==='PKCS12'`; `aliasCount` 0. Also assert `'jks'` → `'JKS'`.
- **Notes:** §6.1 "büyük harfe çevir".

**KS-F1-07 — createEmpty with empty type defaults to JKS** · *edge*
- **Steps:** `engine.createEmpty({ type:'', storePassword:'changeit' })`.
- **Expected:** `resolveType('')` → `'JKS'` (§6.1 empty/null default). `meta.type==='JKS'`; `aliasCount` 0.
- **Notes:** Documents the resolveType-default vs `@NotBlank`-type tension; the port follows resolveType's empty→JKS default. **If** the implementation instead enforces `@NotBlank` on type at the createEmpty boundary, this case flips to expecting a validation error — confirm with the implementer.

**KS-F1-08 — createEmpty never leaks the store password to the renderer** · *security*
- **Preconditions:** Handler harness registered.
- **Steps:** (1) `harness.invoke('keystore:createEmpty', {type:'PKCS12', storePassword:'s3cr3t-pw'})`. (2) Deep-inspect the returned data (`JSON.stringify`) for the password substring.
- **Expected:** `success:true`. The serialized response contains **no** `storePassword`/`password` field and the literal `s3cr3t-pw` appears nowhere. Only `{sessionId, meta:{type,aliasCount}}` crosses the bridge.
- **Notes:** §3.3; mirrors `otp.test.ts` "never returns the secret".

**KS-F1-09 — createEmpty session is immediately inspectable as empty** · *positive*
- **Steps:** (1) `sessionId = createEmpty({type:'JKS', storePassword:'changeit'})`. (2) `engine.inspect` on that session (handler: `keystore:inspect {sessionId}`).
- **Expected:** `KeystoreInspectResponse { type:'JKS', aliasCount:0, aliases:[] }`.
- **Notes:** Confirms `loadOrCreate` (§6.3) + `inspect` (§6.5) over a freshly created store.

#### Group B — `loadKeyStore` / `resolveType` / `pickFile` (KS-F2-01 … KS-F2-19)

**KS-F2-01 — resolveType maps null/undefined to JKS** · *positive*
- **Steps:** `engine.resolveType(null)` and `engine.resolveType(undefined)`.
- **Expected:** Both return `'JKS'`.
- **Notes:** §6.1 (Apinizer default).

**KS-F2-02 — resolveType maps empty string to JKS** · *edge*
- **Steps:** `engine.resolveType('')`. — **Expected:** `'JKS'`. — **Notes:** §6.1.

**KS-F2-03 — resolveType is case-insensitive for JKS** · *positive*
- **Steps:** `resolveType('jks')`, `('Jks')`, `('JKS')`. — **Expected:** All `'JKS'`. — **Notes:** §6.1 upper-case then match.

**KS-F2-04 — resolveType maps pkcs12 (any case) to PKCS12** · *positive*
- **Steps:** `resolveType('pkcs12')`, `('PKCS12')`. — **Expected:** Both `'PKCS12'`. — **Notes:** §6.1.

**KS-F2-05 — resolveType rejects an unknown type (JCEKS)** · *negative*
- **Steps:** `resolveType('JCEKS')`.
- **Expected:** Throws `KeystoreValidationException` `Unsupported keystore type: JCEKS`.
- **Notes:** §6.1/§8. The `<type>` token is echoed verbatim — confirm whether the message uses the raw or upper-cased value; the test asserts the raw input token.

**KS-F2-06 — resolveType rejects a near-miss alias (P12)** · *negative*
- **Steps:** `resolveType('P12')`; also `resolveType('PKCS#12')`.
- **Expected:** `Unsupported keystore type: P12` and `Unsupported keystore type: PKCS#12`. Only the exact tokens JKS/PKCS12 are accepted.
- **Notes:** §6.1 — guards against fuzzy matching.

**KS-F2-07 — loadKeyStore rejects empty content** · *negative*
- **Steps:** `engine.loadKeyStore(Buffer.alloc(0), 'changeit', 'PKCS12')`; separately with an empty base64 string.
- **Expected:** Throws `KeystoreValidationException` `Keystore content cannot be empty`.
- **Notes:** §6.2 step 1; §8 line 2. `loadKeyStore` is the strict-load path used by inspect (distinct from `loadOrCreate`).

**KS-F2-08 — loadKeyStore parses a valid PKCS12 with the correct password** · *positive*
- **Preconditions:** `client.p12` (password `testpassword`).
- **Steps:** (1) `bytes = readFileSync('tests/fixtures/certs/client.p12')`. (2) `engine.loadKeyStore(bytes,'testpassword','PKCS12')`. (3) Enumerate aliases.
- **Expected:** No throw. Exactly one alias `test-client`, a key entry (`isKeyEntry` true) with certificate chain length **2**. `aliasCount===1`.
- **Notes:** Known-answer anchored by `keytool -list -v`. §6.2 PKCS12 load.

**KS-F2-09 — loadKeyStore rejects a PKCS12 with the wrong password** · *negative*
- **Steps:** `engine.loadKeyStore(<client.p12>, 'WRONGpassword', 'PKCS12')`.
- **Expected:** Throws **`KeystoreEngineException`** (technical/parse class, **not** validation). UI mapping per §8 is the friendly "wrong password or corrupt file" (e.g. `tools.keystore.error.wrongPasswordOrCorrupt`). The private key is never returned.
- **Notes:** Assert the error class is distinct from validation.

**KS-F2-10 — loadKeyStore parses a valid JKS with the correct password** · *interop*
- **Preconditions:** `client.jks` (from client.p12 via keytool, password `testpassword`).
- **Steps:** (1) read bytes; (2) `engine.loadKeyStore(bytes,'testpassword','JKS')`; (3) enumerate aliases.
- **Expected:** No throw. Single alias `test-client`, key entry, chain length 2, `aliasCount===1` — matching the PKCS12 source (KS-F2-08).
- **Notes:** Exercises the `jks-js` read path (§S.3). `describe.skipIf` if the fixture is absent. keytool may lower-case the alias — assert case-insensitively.

**KS-F2-11 — loadKeyStore rejects a corrupted PKCS12** · *negative*
- **Preconditions:** `bad.p12` (literal text, not a real p12).
- **Steps:** `engine.loadKeyStore(<bad.p12>, 'testpassword', 'PKCS12')`.
- **Expected:** Throws `KeystoreEngineException` (parse failure) → friendly "wrong password or corrupt file". Never returns a partial keystore.
- **Notes:** §8 generic parse-exception path; distinguishes technical from validation errors.

**KS-F2-12 — loadKeyStore with a type/content mismatch fails to parse** · *edge*
- **Steps:** `engine.loadKeyStore(<client.p12 bytes>, 'testpassword', 'JKS')` — declaring the wrong type.
- **Expected:** Throws `KeystoreEngineException` — the JKS reader rejects the missing `0xFEEDFEED` magic. No aliases returned.
- **Notes:** Ensures the declared type is honored (no silent format sniffing inside strict `loadKeyStore`). Auto-detection belongs to `pickFile`/`typeAutoDetected`.

**KS-F2-13 — loadKeyStore treats a null/empty password as an empty char[]** · *edge*
- **Steps:** (1) Create an empty PKCS12 with store password `''` and serialize it (or use a committed empty-password fixture). (2) `engine.loadKeyStore(serializedBytes, null, 'PKCS12')`.
- **Expected:** No throw — a null password is coerced to an empty `char[]` (§6.2 step 3 / §6.13 `toChars(null)`) and the empty keystore loads. `aliasCount` 0.
- **Notes:** §6.2 step 3: library null-intolerance handled by empty-string coercion.

**KS-F2-14 — pickFile reads bytes at pick time and auto-detects PKCS12** · *positive*
- **Preconditions:** Handler harness; dialog mocked (certificate.handler pattern).
- **Steps:** (1) `dialogMock.showOpenDialog.mockResolvedValueOnce({canceled:false, filePaths:[abs('tests/fixtures/certs/client.p12')]})`. (2) `harness.invoke('keystore:pickFile')`.
- **Expected:** `success:true`; `data = { sessionId (non-empty), meta:{fileName:'client.p12', …}, typeAutoDetected:'PKCS12' }`. The file was read via `fs` **inside the handler at pick time** (a session now holds the bytes in main). The renderer receives **no** raw bytes.
- **Notes:** Reading at pick time dodges the ~/Downloads TCC EPERM. PKCS12 detected via ASN.1 DER SEQUENCE (`0x30 0x82`).

**KS-F2-15 — pickFile auto-detects JKS by magic 0xFEEDFEED** · *positive*
- **Steps:** dialog → `client.jks`; `harness.invoke('keystore:pickFile')`.
- **Expected:** `success:true`; `data.typeAutoDetected === 'JKS'` (first four bytes `FE ED FE ED`). `sessionId` present.
- **Notes:** Distinguishes JKS from PKCS12 for the open-form default.

**KS-F2-16 — pickFile returns success:false when the dialog is canceled** · *edge*
- **Steps:** dialog → `{canceled:true, filePaths:[]}`; invoke `keystore:pickFile`.
- **Expected:** `{success:false, error:'Cancelled'}` (matching `certificate:pickFile`). No session created.
- **Notes:** Mirrors `certificate.test.ts` "returns success:false on cancel".

**KS-F2-17 — pickFile surfaces a read error at pick time for an unreadable file** · *negative*
- **Steps:** dialog → `{canceled:false, filePaths:[join(tmpDir,'nope.p12')]}` (never written); invoke `keystore:pickFile`.
- **Expected:** `{success:false, error: /couldn't read|read/i}`. No dangling session with an unreadable path is created.
- **Notes:** Mirrors `certificate.test.ts` "surfaces an error at pick time" — no silent success.

**KS-F2-18 — pickFile of an unrecognized file yields no auto-detected type** · *edge*
- **Steps:** dialog → `bad.p12`; invoke `keystore:pickFile`.
- **Expected:** `success:true` (bytes were readable); `data.typeAutoDetected` is null/undefined (no JKS magic, no valid DER header). A session is created holding the raw bytes; a later `inspect` fails (KS-F3-06).
- **Notes:** Auto-detect is best-effort; parse enforcement happens at inspect — detection and parsing are decoupled.

**KS-F2-19 — pickFile never returns raw keystore bytes to the renderer** · *security*
- **Steps:** (1) Pick `client.p12` as in KS-F2-14. (2) `JSON.stringify` the response and inspect for byte content.
- **Expected:** The response contains only `{sessionId, meta, typeAutoDetected}`. No base64/hex blob of the keystore, no Buffer, no filePath outside `meta.fileName`. Raw bytes remain in the main-process session Map.
- **Notes:** Core of the sessionId security model.

#### Group C — `inspect` (KS-F3-01 … KS-F3-09)

**KS-F3-01 — inspect summarizes the client.p12 key entry** · *positive*
- **Preconditions:** Session open on `client.p12` (PKCS12, `testpassword`).
- **Steps:** (1) Establish the session. (2) `engine.inspect(session)` / `keystore:inspect {sessionId}`.
- **Expected:** `{ type:'PKCS12', aliasCount:1, aliases:[one AliasSummary] }`. `aliases[0]`: `alias 'test-client'`; `entryType 'KEY'`; `hasPrivateKey true`; `chainLength 2`; `keyAlgorithm 'RSA'`; `subjectDN` contains `CN=test-client` AND `O=Testnizer Tests`; `issuerDN` contains `CN=Testnizer Test CA`; `notBefore`/`notAfter` present in ISO-UTC.
- **Notes:** §4.2 / §5 AliasSummary / §6.5. chainLength 2 confirmed by keytool. DN asserted by substring.

**KS-F3-02 — inspect summarizes the JKS variant identically** · *interop*
- **Preconditions:** Session open on `client.jks` (JKS, `testpassword`).
- **Steps:** `engine.inspect(session)`.
- **Expected:** `type:'JKS'`, `aliasCount:1`; `aliases[0].alias ~ 'test-client'` (case-insensitive), `entryType 'KEY'`, `hasPrivateKey true`, `keyAlgorithm 'RSA'`, `chainLength 2` — same summary as the PKCS12 source.
- **Notes:** Cross-format parity (jks-js read). skipIf fixture missing.

**KS-F3-03 — inspect of an empty keystore returns zero aliases** · *edge*
- **Steps:** (1) `createEmpty({type:'PKCS12', storePassword:'changeit'})`. (2) `keystore:inspect {sessionId}`.
- **Expected:** `{type:'PKCS12', aliasCount:0, aliases:[]}` — `aliases` must be an empty **array**, not null.

**KS-F3-04 — inspect classifies a trusted-certificate entry as CERTIFICATE** · *positive*
- **Preconditions:** `truststore.jks` (single trustedCertEntry alias `testca` = ca.crt, `testpassword`).
- **Steps:** (1) Open a session on truststore.jks (JKS). (2) `inspect`.
- **Expected:** `aliasCount 1`; `aliases[0]`: alias `testca`; `entryType 'CERTIFICATE'`; `hasPrivateKey false`; `chainLength 1`; `keyAlgorithm 'RSA'`; `subjectDN` contains `CN=Testnizer Test CA`; `issuerDN` contains the same (self-signed root, subject==issuer).
- **Notes:** §6.5 `isKeyEntry` false → entryType CERTIFICATE, chain fallback to `getCertificate` (chainLength 1). Requires the new fixture.

**KS-F3-05 — inspect emits notBefore/notAfter in strict ISO-8601 UTC** · *edge*
- **Steps:** `inspect`; read `aliases[0].notBefore` / `notAfter`.
- **Expected:** Both match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`, are UTC (trailing `Z`, no offset/millis), and `notAfter > notBefore` (fixtures are 3650-day validity, ~10 years apart).
- **Notes:** §5 / §6.5. Do not pin absolute dates (fixture regen); assert format + ordering + span.

**KS-F3-06 — inspect on a wrong-password session returns a parse error envelope** · *negative*
- **Preconditions:** Session bound to client.p12 bytes but password `nope`.
- **Steps:** `keystore:inspect {sessionId}`.
- **Expected:** `{success:false, error:<friendly "wrong password or corrupt file">}` (`KeystoreEngineException` mapped per §8). No AliasSummary produced; no key material returned.
- **Notes:** First point where a bad password is detected in the session model.

**KS-F3-07 — inspect response carries no private-key or password material** · *security*
- **Steps:** (1) `harness.invoke('keystore:inspect', {sessionId})`. (2) `JSON.stringify` the data and scan.
- **Expected:** Only AliasSummary metadata crosses (alias, entryType, hasPrivateKey, subjectDN, issuerDN, notBefore, notAfter, keyAlgorithm, chainLength). **No** PEM, **no** DER, **no** private key, **no** `testpassword`. `hasPrivateKey` is a boolean flag, never the key.
- **Notes:** §3.3. `AliasSummary` (§5) has no key/pem field by construction — assert the shape stays within it.

**KS-F3-08 — inspect on an unknown/closed sessionId errors cleanly** · *negative*
- **Steps:** (1) `harness.invoke('keystore:inspect', {sessionId:'does-not-exist'})`. (2) Separately: create a session, `closeSession` it, then inspect.
- **Expected:** Both return `{success:false, error:'Keystore session not found'}` (or the engine's canonical session-missing message). No crash, no leak.
- **Notes:** **Testnizer-added error** — not in the §8 catalogue; flag the exact string for i18n. Also verifies `closeSession` frees the session.

**KS-F3-09 — inspect enumerates every alias in a multi-entry keystore** · *edge*
- **Preconditions:** Optional `multi.p12` (key entry `test-client` + trusted cert `testca`), `testpassword`.
- **Steps:** Open a session; `inspect`.
- **Expected:** `aliasCount 2`; includes a KEY summary (`test-client`, hasPrivateKey true) and a CERTIFICATE summary (`testca`, hasPrivateKey false). Order need not be pinned; both present exactly once.
- **Notes:** §6.5 loop. skipIf fixture absent; buildable from client key + ca.crt trusted import.

#### Group D — `aliasDetail` (KS-F4-01 … KS-F4-13)

**KS-F4-01 — aliasDetail returns full CertificateInfo for the leaf key entry** · *positive*
- **Preconditions:** Session open on `client.p12`.
- **Steps:** `engine.aliasDetail(session,'test-client')` / `keystore:aliasDetail {sessionId, alias:'test-client'}`.
- **Expected:** `KeystoreAliasDetail { alias:'test-client', entryType:'KEY', hasPrivateKey:true, chain:[…] }`. `chain[0]` (leaf): `subjectDN` contains `CN=test-client` + `O=Testnizer Tests`; `issuerDN` contains `CN=Testnizer Test CA`; `serialNumber === '1440ae30e9d843a5fb3f994c81f8defa697bfcea'` (case-insensitive); `version 3`; `sigAlgName 'SHA256withRSA'`; `publicKeyAlgorithm 'RSA'`; `keySize 2048`; `sha1Fingerprint 'B5:5E:66:78:5F:D4:6F:BA:F4:E0:90:0B:5C:C2:89:DD:A8:94:4C:60'`; `sha256Fingerprint 'EE:4E:BA:BD:8A:41:A1:AB:CE:0E:B7:8C:77:7C:BA:62:17:AB:09:94:B1:F5:A8:FC:1D:10:79:2D:97:B1:2B:DA'`; `subjectAlternativeNames []`; `pem` BEGIN/END CERTIFICATE.
- **Notes:** §4.3/§5/§6.6. Goldens derived from the committed fixture (openssl). `sigAlgName` uses Java naming (map from `sha256WithRSAEncryption`).

**KS-F4-02 — aliasDetail fingerprints are uppercase, colon-separated hex of the exact byte length** · *edge*
- **Steps:** `aliasDetail(session,'test-client')`; inspect both fingerprints.
- **Expected:** `sha1Fingerprint` matches `/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/` (20 bytes, 59 chars) and equals the KS-F4-01 golden; `sha256Fingerprint` matches `/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/` (32 bytes, 95 chars). No lowercase, no spaces.
- **Notes:** §6.6 — guards the exact separator/case formatting (a common port bug).

**KS-F4-03 — aliasDetail serialNumber equals toString(16) with no separators or sign** · *edge*
- **Steps:** `aliasDetail`; compare lower-cased `chain[0].serialNumber` to `1440ae30e9d843a5fb3f994c81f8defa697bfcea`.
- **Expected:** Case-insensitive equal; hex only; no `0x` prefix, no colons, no leading `00`.
- **Notes:** §6.6. This fixture's serial starts with nibble `1`, so no leading-zero/sign ambiguity — note the caveat for future fixtures whose high bit is set.

**KS-F4-04 — aliasDetail PEM round-trips back to the same certificate** · *positive*
- **Steps:** (1) `aliasDetail`; (2) take `chain[0].pem` and re-parse (or `openssl x509 -in - -noout -fingerprint -sha256`); (3) compare to `chain[0].sha256Fingerprint`.
- **Expected:** PEM starts `-----BEGIN CERTIFICATE-----`, ends `-----END CERTIFICATE-----`, body 64-char wrapped, and the re-parsed SHA-256 fingerprint matches. The PEM is the **public** certificate (never a private key).
- **Notes:** §6.6.

**KS-F4-05 — aliasDetail returns the full certificate chain in leaf-to-root order** · *interop*
- **Steps:** `aliasDetail`; inspect `chain.length` and `chain[1]`.
- **Expected:** `chain.length === 2`. `chain[0]` = leaf (`CN=test-client`). `chain[1]` = CA: subject contains `CN=Testnizer Test CA`, issuer the same (self-signed root), `publicKeyAlgorithm 'RSA'`.
- **Notes:** §6.5 full chain. If the Node engine surfaces only the leaf (forge not assembling the bundled CA) that is a divergence from keytool — this case is the guard; the engine must reconstruct the chain from the p12's cert bags.

**KS-F4-06 — aliasDetail on a missing alias returns 'Alias not found'** · *negative*
- **Steps:** `keystore:aliasDetail {sessionId, alias:'nope'}`.
- **Expected:** `{success:false, error:'Alias not found: nope'}` (`KeystoreValidationException`).
- **Notes:** §4.3 `requireAlias`; §8. The token is echoed verbatim.

**KS-F4-07 — aliasDetail with an empty alias returns 'Alias cannot be empty'** · *negative*
- **Steps:** `keystore:aliasDetail {sessionId, alias:''}`; separately `alias:'   '`.
- **Expected:** Both `{success:false, error:'Alias cannot be empty'}`.
- **Notes:** §6.13 `requireAlias`; §8.

**KS-F4-08 — aliasDetail on a trusted-cert entry has no private key and a single-cert chain** · *positive*
- **Preconditions:** `truststore.jks` (alias `testca`).
- **Steps:** Open a JKS session; `aliasDetail(session,'testca')`.
- **Expected:** `{alias:'testca', entryType:'CERTIFICATE', hasPrivateKey:false, chain:[one CertificateInfo]}`. `chain.length 1` (getCertificate fallback). `chain[0].subjectDN` contains `CN=Testnizer Test CA`, issuer equals subject. No private-key material anywhere.
- **Notes:** §4.3 "Zincir yoksa `getCertificate(alias)` tek sertifikaya düşülür".

**KS-F4-09 — aliasDetail computes keySize as EC field size for an EC certificate** · *edge*
- **Preconditions:** Optional `client-ec.p12` (P-256, alias `ec-client`, `testpassword`).
- **Steps:** Open a PKCS12 session; `aliasDetail(session,'ec-client')`.
- **Expected:** `chain[0].publicKeyAlgorithm 'EC'`; `keySize 256` (field size, **not** modulus bits); `sigAlgName 'SHA256withECDSA'`; `entryType 'KEY'`, `hasPrivateKey true`.
- **Notes:** §6.6 EC → field size. Distinct code path from RSA. skipIf fixture absent (EC generation is a later phase).

**KS-F4-10 — aliasDetail never returns the private key of a key entry** · *security*
- **Steps:** (1) `harness.invoke('keystore:aliasDetail',{sessionId, alias:'test-client'})`. (2) `JSON.stringify`; scan for private-key markers and the password.
- **Expected:** `hasPrivateKey` is true, but the response contains **no** `BEGIN PRIVATE KEY` / `BEGIN RSA PRIVATE KEY` / `BEGIN EC PRIVATE KEY` block, no raw key bytes, and no `testpassword`. Only public `CertificateInfo` (incl. public PEM) crosses.
- **Notes:** Core guarantee: even for a private-key entry, aliasDetail exposes only the public chain. `KeystoreAliasDetail` (§5) has no privateKey field by construction — assert it.

**KS-F4-11 — aliasDetail reports X.509 version 3 for a v3 certificate** · *edge*
- **Steps:** `aliasDetail`; read `chain[0].version`.
- **Expected:** `version === 3` (integer human-facing X.509 version, not the zero-based DER encoding 2).
- **Notes:** §6.6 — guards against the off-by-one (DER 2 vs displayed 3).

**KS-F4-12 — aliasDetail on an unknown/closed session errors cleanly** · *negative*
- **Steps:** `harness.invoke('keystore:aliasDetail',{sessionId:'does-not-exist', alias:'test-client'})`.
- **Expected:** `{success:false, error:'Keystore session not found'}`. No crash, no leak.
- **Notes:** Same guard as KS-F3-08; not a §8 catalogue string — flag for i18n.

**KS-F4-13 — aliasDetail handler returns the standard envelope on success** · *positive*
- **Steps:** `harness.invoke('keystore:aliasDetail', {sessionId, alias:'test-client'})`.
- **Expected:** Exactly the `{success:true, data:KeystoreAliasDetail}` shape (data present, error absent).
- **Notes:** Confirms `keystore.handler` follows the project-wide `wrap(fn)` envelope.

---

### 8.2 Faz 2 — Generate: `generateKeyPair` + `generateSecretKey` — 63 cases

**Scope.** `keystore:generateKeyPair` (RSA 1024/2048/3072/4096; EC secp256r1/384r1/521r1/secp256k1; subjectDN, SAN, keyUsage, serial dec/0x-hex, validityDays, basicConstraintsCa, self-signed X.509v3) and `keystore:generateSecretKey` (AES 128/192/256, PKCS12-only). Grounded in §4.8-4.9, §6.6-6.8, DTOs §5, error catalogue §8.

**Pattern.** `session = engine.createEmpty({type,storePassword})` → `engine.generateKeyPair(session.sessionId, {...})` → `engine.inspect(sessionId)` for AliasSummary and `engine.aliasDetail(sessionId, alias)` for full `CertificateInfo`. RSA-4096 keygen is slow (~1-2 s) — bump the it() timeout to 30 000 ms. Default-serial and validity cases wrap with `vi.useFakeTimers()` + `vi.setSystemTime(FIXED)` so hex serial and ISO-UTC dates are deterministic. **No filesystem fixtures needed** — every keystore starts from `createEmpty`; the only pre-populated state ("alias already exists") is produced by a first generate inside the test. All PKCS12/JKS sessions use storePassword `changeit` unless stated.

**Interop.** Serialize the session (`engine.serialize` / `meta.base64Content`), `fs.writeFile` to `os.tmpdir()/<rand>.p12|.jks`, then spawn `keytool -list -storetype …` and `openssl pkcs12 -info -nokeys` / `openssl x509 -noout -text`. Uses storePassword `testpassword` to match fixture convention.

#### Group A — `generateKeyPair` (KS-F2-01 … KS-F2-48)

**KS-F2-01 — RSA with default keySize resolves to 2048 (happy path)** · *positive*
- **Preconditions:** Empty PKCS12 session S (`createEmpty({type:'PKCS12', storePassword:'changeit'})`), aliasCount 0.
- **Steps:** (1) `generateKeyPair(S, {alias:'srv', keyAlgorithm:'RSA', basicConstraintsCa:false})` — omit keySize, curve, subjectDN, SAN, validityDays, serialNumber, keyUsage, entryPassword. (2) `inspect(S)`. (3) `aliasDetail(S,'srv')`.
- **Expected:** meta `{type:'PKCS12', aliasCount:1}`. inspect: `aliases[0]={alias:'srv', entryType:'KEY', hasPrivateKey:true, keyAlgorithm:'RSA', chainLength:1}`. `aliasDetail.chain[0].keySize===2048` (default), `version===3`, `publicKeyAlgorithm==='RSA'`, `sigAlgName==='SHA256withRSA'`, `subjectDN===issuerDN==='CN=srv'` (self-signed, default DN), `notAfter-notBefore ≈ 365 days`.
- **Notes:** §4.8 defaults: RSA→2048, SHA256withRSA, validity 365, subject=issuer=CN=alias.

**KS-F2-02 — RSA 1024** · *positive* — Steps: `generateKeyPair(S,{alias:'r1024', keyAlgorithm:'RSA', keySize:1024, basicConstraintsCa:false})`; `aliasDetail`. **Expected:** aliasCount 1; `chain[0].keySize===1024`, `publicKeyAlgorithm==='RSA'`, `version===3`, `subjectDN===issuerDN==='CN=r1024'`. **Notes:** §6.8 RSA ∈ {1024,2048,3072,4096} — smallest allowed.

**KS-F2-03 — RSA 2048 explicit** · *positive* — Steps: `generateKeyPair(S,{alias:'r2048', …keySize:2048…})`; `aliasDetail`. **Expected:** aliasCount 1; `keySize===2048`; `sigAlgName==='SHA256withRSA'`. **Notes:** Explicit value equals the default — guards default-only handling.

**KS-F2-04 — RSA 3072** · *positive* — Steps: `generateKeyPair(S,{alias:'r3072', …keySize:3072…})`; `aliasDetail`. **Expected:** aliasCount 1; `keySize===3072`. **Notes:** Enumerated RSA size.

**KS-F2-05 — RSA 4096 (largest allowed)** · *positive* — Steps: `generateKeyPair(S,{alias:'r4096', …keySize:4096…})`; `aliasDetail`. **Expected:** aliasCount 1; `keySize===4096`, `publicKeyAlgorithm==='RSA'`. **Notes:** Slow keygen — 30 000 ms timeout.

**KS-F2-06 — EC with default curve resolves to secp256r1 (P-256)** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'ecdef', keyAlgorithm:'EC', basicConstraintsCa:false})` (omit curve); `aliasDetail(S,'ecdef')`.
- **Expected:** aliasCount 1; `publicKeyAlgorithm==='EC'`, `keySize===256` (P-256 field size), `sigAlgName==='SHA256withECDSA'`, `version===3`, `subjectDN===issuerDN==='CN=ecdef'`.
- **Notes:** §4.8/§6.8 default EC curve = secp256r1. @peculiar/x509 EC cert build path.

**KS-F2-07 — EC P-256 curve-alias normalization (P-256 / prime256v1 / secp256r1)** · *positive*
- **Steps:** Generate `ecA` with `curve:'P-256'`, `ecB` with `'prime256v1'`, `ecC` with `'secp256r1'`; `aliasDetail` each.
- **Expected:** All three succeed and produce the identical curve: `publicKeyAlgorithm==='EC'`, `keySize===256`. `meta.aliasCount` grows 1→2→3.
- **Notes:** §6.8 `resolveCurve` — case-insensitive alias mapping.

**KS-F2-08 — EC secp384r1 (P-384)** · *positive* — Steps: `generateKeyPair(S,{alias:'ec384', keyAlgorithm:'EC', curve:'P-384', …})`; `aliasDetail`. **Expected:** aliasCount 1; `publicKeyAlgorithm==='EC'`, `keySize===384`. **Notes:** §6.8 `p-384 → secp384r1`.

**KS-F2-09 — EC secp521r1 (P-521)** · *positive* — Steps: `generateKeyPair(S,{alias:'ec521', keyAlgorithm:'EC', curve:'P-521', …})`; `aliasDetail`. **Expected:** aliasCount 1; `publicKeyAlgorithm==='EC'`, `keySize===521` (odd field size, **not** rounded to 512/544). **Notes:** §6.6 — catches naive byte-length math.

**KS-F2-10 — EC secp256k1** · *positive* — Steps: `generateKeyPair(S,{alias:'eck1', keyAlgorithm:'EC', curve:'secp256k1', …})`; `aliasDetail`. **Expected:** aliasCount 1; `publicKeyAlgorithm==='EC'`, `keySize===256`, self-signed `subjectDN===issuerDN==='CN=eck1'`. **Notes:** §6.8 keeps secp256k1 as-is. The design defers secp256k1 elsewhere, but §4.8 lists it as allowed — assert acceptance here (may require `@noble/curves`; otherwise this flips to the KS-F2-39 rejection form and must be reconciled).

**KS-F2-11 — RSA into a JKS keystore (jks-writer path)** · *positive*
- **Preconditions:** Empty JKS session S (`createEmpty({type:'JKS', storePassword:'changeit'})`).
- **Steps:** `generateKeyPair(S,{alias:'jkskey', keyAlgorithm:'RSA', keySize:2048, entryPassword:'changeit', basicConstraintsCa:false})`; `inspect(S)`.
- **Expected:** meta `{type:'JKS', aliasCount:1}`; `aliases[0]={alias:'jkskey', entryType:'KEY', hasPrivateKey:true, keyAlgorithm:'RSA', chainLength:1}`. Serialized bytes begin with JKS magic `0xFEEDFEED`.
- **Notes:** §S.3 pure-TS JKS writer. RSA keypairs must be storable in JKS (only secret keys are PKCS12-only).

**KS-F2-12 — custom multi-RDN subjectDN** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'corp', keyAlgorithm:'RSA', keySize:2048, subjectDN:'CN=api.example.com, OU=Platform, O=Example Inc, C=TR', basicConstraintsCa:false})`; `aliasDetail`.
- **Expected:** `chain[0].subjectDN` and `issuerDN` both equal the supplied DN (RDN **set** identity; ordering may be normalized by the X500 encoder), self-signed. CN component = `api.example.com`.
- **Notes:** §6.8 subject=issuer=subjectDN. Assert on RDN components, not exact string order.

**KS-F2-13 — SAN dNSName entries** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'san-dns', …, subjectAlternativeNames:['example.com','www.example.com','*.api.example.com']})`; `aliasDetail`.
- **Expected:** `chain[0].subjectAlternativeNames === ['example.com','www.example.com','*.api.example.com']` — all encoded as **dNSName**. SAN extension present, `critical=false`.
- **Notes:** §6.8 non-IP → dNSName. Wildcard preserved.

**KS-F2-14 — SAN IPv4 encoded as iPAddress** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'san-ip4', …, subjectAlternativeNames:['10.0.0.5','192.168.1.1']})`; `aliasDetail`.
- **Expected:** SAN contains both, each encoded as **iPAddress** GeneralName (regex `\d{1,3}(\.\d{1,3}){3}`).
- **Notes:** §6.8 IPv4 pattern → iPAddress tag.

**KS-F2-15 — SAN IPv6 (colon) encoded as iPAddress** · *edge*
- **Steps:** `generateKeyPair(S,{alias:'san-ip6', …, subjectAlternativeNames:['2001:db8::1','::1']})`; `aliasDetail`.
- **Expected:** SAN includes the IPv6 values encoded as **iPAddress** (colon-containing → iPAddress per §6.8), not dNSName.
- **Notes:** Verifies the colon-detection branch, not just the IPv4 regex.

**KS-F2-16 — SAN mixed DNS + IPv4 + duplicate** · *edge*
- **Steps:** `generateKeyPair(S,{alias:'san-mix', …, subjectAlternativeNames:['svc.local','svc.local','127.0.0.1']})`; `aliasDetail`.
- **Expected:** Succeeds. `svc.local` as dNSName, `127.0.0.1` as iPAddress. The duplicate is either de-duped or preserved per encoder — assert both a DNS and an IP entry are present and **no error is thrown**.
- **Notes:** Document the actual de-dup behavior in the test.

**KS-F2-17 — keyUsage single value (digitalSignature)** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'ku1', …, keyUsage:['digitalSignature'], basicConstraintsCa:false})`; decode extensions.
- **Expected:** Succeeds, aliasCount 1. KeyUsage extension present (`critical=true`) with only the digitalSignature bit set.
- **Notes:** §6.8 `resolveKeyUsage` single bit.

**KS-F2-18 — keyUsage bit-OR of multiple values** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'kuMulti', …, keyUsage:['digitalSignature','keyCertSign','cRLSign'], basicConstraintsCa:true})`; decode.
- **Expected:** KeyUsage = OR of the three bits, `critical=true`. basicConstraints `cA=true` also present.
- **Notes:** §6.8 bit OR; pairs naturally with a CA cert.

**KS-F2-19 — keyUsage full enumerated set incl. contentCommitment alias** · *positive*
- **Steps:** Generate with all nine values `['digitalSignature','nonRepudiation','keyEncipherment','dataEncipherment','keyAgreement','keyCertSign','cRLSign','encipherOnly','decipherOnly']`; repeat with `'contentCommitment'` in place of `'nonRepudiation'`; decode KeyUsage.
- **Expected:** Both requests succeed; all nine bits set. `nonRepudiation` and `contentCommitment` resolve to the **same** bit (bit 1) per §6.8.

**KS-F2-20 — empty keyUsage array omits the extension** · *edge*
- **Steps:** `generateKeyPair(S,{alias:'kuNone', …, keyUsage:[]})`; decode extensions.
- **Expected:** Succeeds. **No** KeyUsage extension present (empty → extension not added, §6.8).
- **Notes:** Distinguish empty-array from omitted (both omit).

**KS-F2-21 — basicConstraintsCa=true → CA cert** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'rootca', …, subjectDN:'CN=Test Root CA', basicConstraintsCa:true})`; decode BasicConstraints.
- **Expected:** BasicConstraints present, `critical=true`, `cA=TRUE`. Self-signed `subjectDN===issuerDN==='CN=Test Root CA'`.

**KS-F2-22 — basicConstraintsCa=false → end-entity cert** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'leaf', …, basicConstraintsCa:false})`; decode.
- **Expected:** BasicConstraints present, `critical=true`, `cA=FALSE`.
- **Notes:** `basicConstraintsCa` is a required boolean field in the DTO.

**KS-F2-23 — serialNumber as decimal string** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'serDec', …, serialNumber:'123456789'})`; `aliasDetail`.
- **Expected:** `chain[0].serialNumber === '75bcd15'` (123456789 in lowercase hex).
- **Notes:** §6.8 no `0x` → decimal parse; §6.6 serial rendered base-16.

**KS-F2-24 — serialNumber as 0x-hex string** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'serHex', …, serialNumber:'0x0A1B2C3D'})`; `aliasDetail`.
- **Expected:** `chain[0].serialNumber === 'a1b2c3d'` (0x stripped, hex parsed, lowercase hex without leading zero).
- **Notes:** §6.8 `0x` prefix → hex parse. Confirm leading-zero handling.

**KS-F2-25 — empty/omitted serialNumber defaults to now-millis** · *positive*
- **Preconditions:** `vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-23T00:00:00Z'))`.
- **Steps:** `generateKeyPair(S,{alias:'serDef', …})` (omit serialNumber); `aliasDetail`.
- **Expected:** `chain[0].serialNumber === Date.now().toString(16) === '1985e1a5800'` (millis 1753228800000 in hex). `notBefore === '2026-07-23T00:00:00Z'`.
- **Notes:** §4.8/§6.8 default serial = `System.currentTimeMillis()`.

**KS-F2-26 — custom validityDays (730)** · *positive*
- **Preconditions:** Frozen clock.
- **Steps:** `generateKeyPair(S,{alias:'v730', …, validityDays:730})`; `aliasDetail`.
- **Expected:** `notAfter - notBefore === 730*86_400_000` ms exactly. Both fields ISO-UTC.
- **Notes:** §6.8 `notAfter = now + validityDays*86_400_000`.

**KS-F2-27 — default validityDays = 365 when omitted** · *positive* — Steps: generate `v365` omitting validityDays; `aliasDetail`. **Expected:** `notAfter - notBefore === 365*86_400_000` ms. **Notes:** §4.8.

**KS-F2-28 — validityDays=1 (minimum boundary)** · *edge* — Steps: generate `v1` with `validityDays:1`; `aliasDetail`. **Expected:** `notAfter - notBefore === 86_400_000` (24 h). **Notes:** §6.8 `validityDays ≥ 1`.

**KS-F2-29 — validityDays=0/negative clamps to minimum ≥1** · *edge*
- **Steps:** Generate `v0` with `validityDays:0`; repeat with `-5`; `aliasDetail` each.
- **Expected:** Does not throw for either. `notAfter > notBefore` (clamped to the ≥1 floor). Assert `notAfter-notBefore >= 86_400_000`.
- **Notes:** §6.8 constrains to ≥1 but is silent on whether 0/neg clamps to 1 or to default 365 — capture the engine's actual floor and document it.

**KS-F2-30 — explicit entryPassword protects the key entry** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'ep', …, entryPassword:'entrySecret'})`; `inspect`; `aliasDetail(S,'ep')`.
- **Expected:** aliasCount 1. Key entry stored under `entrySecret`. `aliasDetail` (public read) succeeds. A later recover with the wrong entry pw surfaces the §8 `Cannot recover key entry …` message (cross-check).
- **Notes:** §6.8 step 5 `setKeyEntry(alias,key,entryPassword,[cert])`.

**KS-F2-31 — without entryPassword uses store password** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'noep', …})` (omit entryPassword); `inspect`; serialize + reload with store pw `changeit`.
- **Expected:** aliasCount 1. Key recoverable with the store password. Round-trip reload still lists `noep` as a key entry.
- **Notes:** Consistency with other ops that fall back to store pw.

**KS-F2-32 — self-signed CertificateInfo full field extraction** · *positive*
- **Preconditions:** Frozen clock.
- **Steps:** `generateKeyPair(S,{alias:'full', keyAlgorithm:'RSA', keySize:2048, subjectDN:'CN=full', subjectAlternativeNames:['full.local'], keyUsage:['digitalSignature'], serialNumber:'0x10', validityDays:365, basicConstraintsCa:false})`; `aliasDetail(S,'full')`.
- **Expected:** `chain[0]`: `subjectDN===issuerDN==='CN=full'`; `serialNumber==='10'`; `version===3`; `sigAlgName==='SHA256withRSA'`; `publicKeyAlgorithm==='RSA'`; `keySize===2048`; `notBefore`/`notAfter` ISO-UTC ending `Z`; both fingerprints UPPERCASE hex with `:` separators (`^[0-9A-F]{2}(:[0-9A-F]{2})+$`); `subjectAlternativeNames===['full.local']`; `pem` starts `-----BEGIN CERTIFICATE-----` and ends `-----END CERTIFICATE-----` with 64-char wrapped body.
- **Notes:** §6.6 — the master shape assertion for a generated cert.

**KS-F2-33 — explicit signatureAlgorithm override** · *edge*
- **Steps:** `generateKeyPair(S,{alias:'sig384', keyAlgorithm:'RSA', keySize:2048, signatureAlgorithm:'SHA384withRSA', …})`; `aliasDetail`.
- **Expected:** `chain[0].sigAlgName==='SHA384withRSA'` (overrides the SHA256withRSA default, §6.8 step 3).

**KS-F2-34 — aliasCount increments across sequential generations** · *positive*
- **Steps:** `generateKeyPair(S,{alias:'a1', keyAlgorithm:'RSA', keySize:2048, …})` → meta1; `generateKeyPair(S,{alias:'a2', keyAlgorithm:'EC', curve:'P-256', …})` → meta2; `inspect(S)`.
- **Expected:** `meta1.aliasCount===1`, `meta2.aliasCount===2`. inspect returns a1(RSA) + a2(EC). Session `dirty` set true (Model A Save-As enabled).
- **Notes:** §6.4 `mutate` aliasCount = `keyStore.aliases().size()`.

**KS-F2-35 — empty alias is rejected** · *negative* — Steps: `generateKeyPair(S,{alias:'', …})`. **Expected:** Throws `KeystoreValidationException` `Alias cannot be empty`; handler `{success:false, error:'Alias cannot be empty'}`; aliasCount unchanged (0). **Notes:** §8.

**KS-F2-36 — duplicate alias is rejected** · *negative*
- **Preconditions:** Session already contains alias `dup`.
- **Steps:** `generateKeyPair(S,{alias:'dup', keyAlgorithm:'RSA', keySize:2048, …})`.
- **Expected:** Throws with message exactly `Alias already exists: dup`. aliasCount stays 1; the existing entry is **not** overwritten.
- **Notes:** §4.8 "alias yeni olmalı"; §8.

**KS-F2-37 — unsupported RSA key size (512)** · *negative* — Steps: `keySize:512`. **Expected:** Throws `Unsupported RSA key size: 512`; no entry added. **Notes:** §6.8 whitelist; §8.

**KS-F2-38 — unsupported RSA key size (2047 non-standard)** · *negative* — Steps: `keySize:2047`. **Expected:** Throws `Unsupported RSA key size: 2047`. **Notes:** Off-by-one near a valid size — the whitelist is exact, not a range.

**KS-F2-39 — unsupported EC curve** · *negative* — Steps: `{keyAlgorithm:'EC', curve:'brainpoolP256r1'}`. **Expected:** Throws `Unsupported EC curve: brainpoolP256r1`; no entry added. **Notes:** §6.8 curve whitelist; §8.

**KS-F2-40 — unsupported key algorithm** · *negative* — Steps: `{keyAlgorithm:'DSA'}`. **Expected:** Throws `Unsupported key algorithm: DSA`; no entry added. **Notes:** §4.8 keyAlgorithm ∈ {RSA,EC}; §8.

**KS-F2-41 — invalid serialNumber (non-numeric)** · *negative* — Steps: `serialNumber:'xyz'`. **Expected:** Throws `Invalid serial number: xyz`; no entry added. **Notes:** §6.8 `resolveSerialNumber`; §8.

**KS-F2-42 — invalid serialNumber (malformed 0x-hex)** · *negative* — Steps: `serialNumber:'0xZZ'`. **Expected:** Throws `Invalid serial number: 0xZZ`. **Notes:** Confirms the hex-branch parse failure also surfaces the invalid-serial message with the original input.

**KS-F2-43 — unsupported keyUsage value** · *negative*
- **Steps:** `keyUsage:['digitalSignature','superPower']`.
- **Expected:** Throws `Unsupported key usage: superPower`; **no entry added** (the whole op fails, not partial).
- **Notes:** §6.8 enumerated set; §8. An unknown token in an otherwise-valid list still aborts.

**KS-F2-44 — meta returned to the renderer leaks no private key or passwords** · *security*
- **Preconditions:** Handler harness; PKCS12 session via `keystore:createEmpty({type:'PKCS12', storePassword:'topsecret'})`.
- **Steps:** `res = harness.invoke('keystore:generateKeyPair',{sessionId, alias:'k', keyAlgorithm:'RSA', keySize:2048, entryPassword:'entrypw', basicConstraintsCa:false})`; `JSON.stringify(res)`.
- **Expected:** `res={success:true, data:{sessionId, meta:{type:'PKCS12', aliasCount:1}}}` (+ optional public alias summaries). The serialized response contains **none** of: `PRIVATE KEY`, `topsecret`, `entrypw`, raw keystore base64 bytes.
- **Notes:** sessionId model — Buffer + passwords + private keys stay in the main-process Map.

**KS-F2-45 — aliasDetail after generateKeyPair exposes only the public certificate/PEM** · *security*
- **Preconditions:** PKCS12 session with a generated RSA key entry `pubonly` (entryPassword `x`).
- **Steps:** `engine.aliasDetail(S,'pubonly')`; inspect `chain[0].pem` and the whole response.
- **Expected:** `chain[0].pem` is a CERTIFICATE block only. No `BEGIN PRIVATE KEY` / `BEGIN RSA PRIVATE KEY` / `BEGIN EC PRIVATE KEY` block and no entryPassword. `hasPrivateKey===true` is a boolean flag, not key material.
- **Notes:** §4.3/§6.6.

**KS-F2-46 — Interop: generated RSA PKCS12 opens in OpenSSL with cert + key** · *interop*
- **Preconditions:** `describe.skipIf(!hasOpenssl)`; PKCS12 session S (storePassword `testpassword`).
- **Steps:** (1) generate `iop` RSA-2048 with `subjectDN:'CN=iop'`; (2) serialize → `os.tmpdir()/iop.p12`; (3) `openssl pkcs12 -info -in iop.p12 -passin pass:testpassword -nokeys -clcerts`; (4) `openssl pkcs12 -in iop.p12 -passin pass:testpassword -nocerts -noout`.
- **Expected:** openssl exits 0. Cert output shows `subject=/CN=iop` and `issuer=/CN=iop` (self-signed). Bag lists a friendlyName/localKeyID matching alias `iop`. The key command succeeds (a private key bag exists).

**KS-F2-47 — Interop: generated RSA JKS lists PrivateKeyEntry in keytool** · *interop*
- **Preconditions:** `describe.skipIf(!hasKeytool)`; JKS session S (storePassword `testpassword`).
- **Steps:** (1) generate `jio` RSA-2048 with `entryPassword:'testpassword'`; (2) serialize → `os.tmpdir()/jio.jks`; (3) `keytool -list -keystore jio.jks -storepass testpassword -storetype JKS`.
- **Expected:** keytool exits 0; output contains `jio` and `PrivateKeyEntry` and a fingerprint line. Confirms the pure-TS jks-writer (magic + SHA-1 store integrity + key protector) is readable by the reference JRE.
- **Notes:** §S.3 Option C validation — the highest-risk write path. **Must hard-fail in CI (R1).**

**KS-F2-48 — Interop: generated EC P-256 cert shows prime256v1 in OpenSSL** · *interop*
- **Preconditions:** `skipIf(!hasOpenssl)`; PKCS12 session (storePassword `testpassword`).
- **Steps:** (1) generate `ecio` EC P-256; (2) serialize → `ecio.p12`; (3) `openssl pkcs12 -in ecio.p12 -passin pass:testpassword -nokeys -clcerts -out cert.pem`; (4) `openssl x509 -in cert.pem -noout -text`.
- **Expected:** shows `Public Key Algorithm: id-ecPublicKey`, `ASN1 OID: prime256v1` (or `NIST CURVE: P-256`), `Signature Algorithm: ecdsa-with-SHA256`; Issuer == Subject.
- **Notes:** Confirms the @peculiar/x509 EC self-signed cert is interoperable and correctly curve-tagged.

#### Group B — `generateSecretKey` (KS-F2-49 … KS-F2-63)

**KS-F2-49 — AES with default keySize (256) in PKCS12** · *positive*
- **Steps:** `generateSecretKey(S,{alias:'aes', entryPassword:'changeit'})` (omit keyAlgorithm and keySize); `inspect(S)`.
- **Expected:** meta `{type:'PKCS12', aliasCount:1}`. keyAlgorithm defaults to `AES`, keySize to 256. inspect: `aliases[0]={alias:'aes', entryType:'KEY', hasPrivateKey:false, chainLength:0}` with no subjectDN/issuerDN (secret key, no cert).
- **Notes:** §4.9 defaults; §5 `KeystoreGenerateSecretKeyRequest`.

**KS-F2-50 — AES 128** · *positive* — Steps: `generateSecretKey(S,{alias:'aes128', keyAlgorithm:'AES', keySize:128, entryPassword:'changeit'})`; `inspect`. **Expected:** aliasCount 1; SecretKeyEntry present; no error. **Notes:** §4.9 keySize ∈ {128,192,256}.

**KS-F2-51 — AES 192** · *positive* — Steps: same with `keySize:192`. **Expected:** aliasCount 1; `aes192` present. **Notes:** Mid enumerated size (JCE unlimited-strength policy is irrelevant to node-forge).

**KS-F2-52 — AES 256 explicit** · *positive* — Steps: same with `keySize:256`. **Expected:** aliasCount 1; `aes256` present. **Notes:** Max = default; guards default-only handling.

**KS-F2-53 — without entryPassword falls back to store password** · *positive*
- **Steps:** `generateSecretKey(S,{alias:'aesnoep', keyAlgorithm:'AES', keySize:256})` (omit entryPassword); serialize + reload with store pw `changeit`; inspect.
- **Expected:** aliasCount 1; secret entry protected with the store pw; reload with `changeit` still lists `aesnoep`.
- **Notes:** §4.9 `PasswordProtection(entryPassword | store)`.

**KS-F2-54 — inspect summary reflects secret-key semantics** · *edge*
- **Preconditions:** PKCS12 session with a generated AES-256 entry `sk`.
- **Steps:** `inspect(S)`; `aliasDetail(S,'sk')` (if supported for secret keys).
- **Expected:** AliasSummary for `sk`: `entryType==='KEY'`, `hasPrivateKey===false` (a secret key is not a private key), `chainLength===0`, subjectDN/issuerDN/notBefore/notAfter/keyAlgorithm null/undefined (no X509 leaf). `aliasDetail.chain===[]`.
- **Notes:** §6.5 leaf is null for a SecretKeyEntry — distinguishes secret keys from private-key entries in the UI badge.

**KS-F2-55 — aliasCount increments alongside key-pair entries** · *positive*
- **Preconditions:** Session already holding one RSA key entry (aliasCount 1).
- **Steps:** `generateSecretKey(S,{alias:'sk2', keyAlgorithm:'AES', keySize:256, entryPassword:'changeit'})`; `inspect(S)`.
- **Expected:** `meta.aliasCount===2`; inspect returns both the RSA key entry and the AES secret entry; `dirty=true`.

**KS-F2-56 — rejected on a JKS keystore** · *negative*
- **Preconditions:** Empty **JKS** session.
- **Steps:** `generateSecretKey(S,{alias:'skjks', keyAlgorithm:'AES', keySize:256, entryPassword:'changeit'})`.
- **Expected:** Throws `KeystoreValidationException` `Secret keys can only be stored in a PKCS12 keystore`. aliasCount stays 0.
- **Notes:** §4.9 constraint; §8.

**KS-F2-57 — empty alias is rejected** · *negative* — Steps: `generateSecretKey(S,{alias:'', keyAlgorithm:'AES', keySize:256})`. **Expected:** Throws `Alias cannot be empty`. **Notes:** §8 shared alias validation.

**KS-F2-58 — duplicate alias is rejected** · *negative* — Preconditions: session already contains secret alias `skdup`. Steps: generate the same alias again. **Expected:** Throws `Alias already exists: skdup`; existing entry preserved. **Notes:** §8.

**KS-F2-59 — unsupported AES key size (512)** · *negative* — Steps: `keySize:512`. **Expected:** Throws `Unsupported AES key size: 512`; no entry added. **Notes:** §4.9; §8.

**KS-F2-60 — unsupported AES key size (100 non-multiple)** · *negative* — Steps: `keySize:100`. **Expected:** Throws `Unsupported AES key size: 100`. **Notes:** Non-standard size outside the whitelist.

**KS-F2-61 — unsupported secret key algorithm (non-AES)** · *negative* — Steps: `{keyAlgorithm:'DES', keySize:56}`. **Expected:** Throws `Unsupported secret key algorithm: DES`; no entry added. **Notes:** §4.9 AES only; §8.

**KS-F2-62 — secret material never crosses IPC to the renderer** · *security*
- **Preconditions:** Handler harness; PKCS12 session via `createEmpty({type:'PKCS12', storePassword:'storepw'})`.
- **Steps:** `res = harness.invoke('keystore:generateSecretKey',{sessionId, alias:'skx', keyAlgorithm:'AES', keySize:256, entryPassword:'entrypw'})`; `JSON.stringify(res)`.
- **Expected:** `res={success:true, data:{sessionId, meta:{type:'PKCS12', aliasCount:1}}}`. The serialized response contains **none** of: raw AES key bytes / base64 of the key, `storepw`, `entrypw`, keystore file bytes.
- **Notes:** Design security invariant.

**KS-F2-63 — Interop: generated AES-256 PKCS12 shows SecretKeyEntry in keytool** · *interop*
- **Preconditions:** `skipIf(!hasKeytool)`; PKCS12 session (storePassword `testpassword`).
- **Steps:** (1) `generateSecretKey(S,{alias:'skio', keyAlgorithm:'AES', keySize:256, entryPassword:'testpassword'})`; (2) serialize → `os.tmpdir()/skio.p12`; (3) `keytool -list -keystore skio.p12 -storepass testpassword -storetype PKCS12`.
- **Expected:** keytool exits 0; output contains `skio` and `SecretKeyEntry`.
- **Notes:** §4.9 secret keys are PKCS12-only. `entryPassword` must equal storepass for `keytool -list` to read secret entries without `-srckeypass` gymnastics.

---

### 8.3 Faz 3 — Import: `importPkcs12`, `importKeyMaterial`, `importPem`, `importTrustedCertificate`, `verifyKeyMatchesCertificate` — 45 cases

**Pattern.** Engine tests: `createEmpty` (or open a fixture) → `sessionId` → call the engine op directly (`engine.importPkcs12(sessionId,{sourceBytes,…})`, `engine.importKeyMaterial(sessionId,{…})`, …) → assert returned meta (aliasCount/type) → follow up with `engine.inspect` / `engine.aliasDetail` where cert fields matter. Validation errors are `KeystoreValidationException` with the exact §8 message; parse/unexpected errors are `KeystoreEngineException`. `verifyKeyMatchesCertificate` is exercised directly if exported (recommended), otherwise through `importKeyMaterial` with matched vs mismatched pairs.

**Fixture note.** `importPkcs12` always loads the **source** as PKCS12, so `client.jks` is only ever an open-target, never an import source. `client.key` is traditional PKCS#1 (`BEGIN RSA PRIVATE KEY`) — that IS the OpenSSL-PEM fixture. A key entry with an **empty** certificate chain cannot be produced with openssl; construct it in-test via a stubbed source keystore object (`isKeyEntry=true` / `getCertificateChain=[]`) or a crafted p12.

#### Group A — `importPkcs12` (KS-F3-01 … KS-F3-14)

**KS-F3-01 — single-alias key entry into empty PKCS12 target** · *positive*
- **Preconditions:** Empty PKCS12 session (`createEmpty {type:'PKCS12', storePassword:'target-pw'}`); fixture `client.p12`.
- **Steps:** (1) `sourceBytes = readFileSync('tests/fixtures/certs/client.p12')`; (2) `engine.importPkcs12(sessionId,{sourceBytes, sourcePassword:'testpassword', sourceAlias:'test-client'})` (no alias override, no entryPassword); (3) `inspect` + `aliasDetail`.
- **Expected:** `meta.type==='PKCS12'`, `meta.aliasCount===1`. `inspect.aliases[0]`: alias `test-client`, `entryType 'KEY'`, `hasPrivateKey true`, `keyAlgorithm 'RSA'`, `chainLength 2`. `aliasDetail.chain[0].subjectDN` contains `test-client`, `chain[0].keySize 2048`, `chain[1].subjectDN` contains `Testnizer Test CA`. No throw.
- **Notes:** Baseline `copyEntry` key-entry path (§6.10:656-659). Omitted entryPassword → `resolveEntryPassword` falls back to the target store password.

**KS-F3-02 — all-aliases (sourceAlias omitted) from a single-entry source** · *positive*
- **Steps:** `engine.importPkcs12(sessionId,{sourceBytes:<client.p12>, sourcePassword:'testpassword'})` with `sourceAlias` UNDEFINED; `inspect`.
- **Expected:** `meta.aliasCount===1`; the single key entry `test-client` copied (chainLength 2). No throw.
- **Notes:** §4.4 empty sourceAlias ⇒ copy ALL importable entries. `ca.crt` lives inside the key chain, not as a separate alias, so the count stays 1.

**KS-F3-03 — all-aliases copies both a KEY and a trusted-CERTIFICATE alias** · *positive*
- **Preconditions:** Empty PKCS12 session; fixture `multi.p12` = key alias `test-client` + trusted-cert alias `ca-root`.
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<multi.p12>, sourcePassword:'testpassword'})`; `inspect`.
- **Expected:** `meta.aliasCount===2`. `{'test-client': entryType 'KEY', hasPrivateKey true}` and `{'ca-root': entryType 'CERTIFICATE', hasPrivateKey false, chainLength 1}`. No throw.
- **Notes:** Exercises the copyEntry cert branch (§6.10:665-666 `setCertificateEntry`) alongside the key branch in one pass.

**KS-F3-04 — target alias override** · *positive*
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<client.p12>, sourcePassword:'testpassword', sourceAlias:'test-client', alias:'my-imported-key'})`; `inspect`.
- **Expected:** `aliasCount===1`; the entry appears under `my-imported-key` (NOT `test-client`); `hasPrivateKey true`, `chainLength 2`.
- **Notes:** §4.4 / §6.10 targetAlias = alias override.

**KS-F3-05 — distinct entryPassword protects the imported key** · *edge*
- **Preconditions:** Empty PKCS12 session with store password `target-pw`.
- **Steps:** (1) import with `alias:'k1', entryPassword:'entry-secret'`; (2) attempt to recover the key with the STORE password; (3) recover with `entry-secret`.
- **Expected:** Import succeeds (aliasCount 1). Store-password recovery fails with the §8 message `Cannot recover key entry 'k1'. The entry password differs from the store password — please provide the entry password.`; recovery with `entry-secret` succeeds.
- **Notes:** `resolveEntryPassword` uses entryPassword when supplied (§6.13).

**KS-F3-06 — secret key INTO a PKCS12 target is copied** · *positive*
- **Preconditions:** Empty PKCS12 target; fixture `secret.p12` = AES-256 SecretKey alias `aes-secret`.
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<secret.p12>, sourcePassword:'testpassword', sourceAlias:'aes-secret'})`; `inspect`.
- **Expected:** `aliasCount===1`; entry `aes-secret` present; a key entry with `hasPrivateKey=false`, `keyAlgorithm='AES'`. No throw.
- **Notes:** §6.10:660-662 — SecretKey + PKCS12 target ⇒ `setEntry`, returns 1.

**KS-F3-07 — FLAGSHIP: all-aliases into a JKS target skips the secret key, copies key/cert** · *positive*
- **Preconditions:** Empty **JKS** session (`createEmpty {type:'JKS', storePassword:'jks-pw'}`); `multi.p12` = KEY `test-client` + trusted-CERT `ca-root` + AES SecretKey `aes-secret`.
- **Steps:** `importPkcs12(jksSessionId,{sourceBytes:<multi.p12>, sourcePassword:'testpassword'})` (no sourceAlias ⇒ all); `inspect`.
- **Expected:** `meta.aliasCount===2` (key + cert). `aes-secret` is **NOT** present. No throw, no error — the secret is silently skipped (copyEntry returns 0 + logs, §6.10:663). The import still counts as success because ≥1 entry was copied.
- **Notes:** Core Faz-3 requirement: JKS cannot hold secret keys. Assert absence AND overall success (the op must not fail just because one entry was un-copyable).

**KS-F3-08 — secret-key-only source into a JKS target → No importable entries** · *negative*
- **Preconditions:** Empty JKS session; `secret.p12` (only the AES SecretKey alias).
- **Steps:** `importPkcs12(jksSessionId,{sourceBytes:<secret.p12>, sourcePassword:'testpassword', sourceAlias:'aes-secret'})`.
- **Expected:** Throws `KeystoreValidationException` `No importable entries found in the source keystore`. JKS session unchanged (aliasCount 0).
- **Notes:** §4.4 + §6.10 — every candidate returns 0 ⇒ nothing copied ⇒ error.

**KS-F3-09 — sourceAlias not present in source** · *negative*
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<client.p12>, sourcePassword:'testpassword', sourceAlias:'does-not-exist'})`.
- **Expected:** Throws `Source alias not found: does-not-exist`. Target unchanged.
- **Notes:** §8 with the actual alias interpolated.

**KS-F3-10 — target alias collision** · *negative*
- **Preconditions:** Session that already contains alias `test-client` (import once via KS-F3-01, or pre-seed).
- **Steps:** Import the same source alias again.
- **Expected:** Throws `Target alias already exists: test-client`. No overwrite; aliasCount unchanged at 1.
- **Notes:** copyEntry pre-check §6.10:654. **Note the message is `Target alias already exists`** — importPkcs12-specific, not the generic `Alias already exists`.

**KS-F3-11 — empty source content** · *negative*
- **Steps:** `importPkcs12(sessionId,{sourceBytes: Buffer.alloc(0), sourcePassword:'testpassword'})` (or undefined / `''`).
- **Expected:** Throws `Source keystore content cannot be empty`. No mutation.
- **Notes:** §8 — validated before any parse attempt.

**KS-F3-12 — wrong source password → engine (not validation) error, no key leak** · *negative*
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<client.p12>, sourcePassword:'WRONG'})`.
- **Expected:** Throws `KeystoreEngineException` (unexpected/parse class, NOT validation). Root cause conveys a MAC/verification failure; the UI maps it to "Parola yanlış veya dosya bozuk" (§8:713/718). Target unchanged. The thrown error string/stack must contain **no** private-key bytes.
- **Notes:** node-forge PKCS12 MAC check fails on a wrong password. Assert the error-class split and no secret leak.

**KS-F3-13 — key entry with an empty certificate chain** · *edge*
- **Preconditions:** A synthetic PKCS12 source whose key entry has NO certificate chain (constructed in-test / crafted fixture).
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<no-chain source>, sourcePassword:'testpassword', sourceAlias:'orphan-key'})`.
- **Expected:** Throws `Key entry has no certificate chain: orphan-key`. No mutation.
- **Notes:** §6.10:658 + §8:738. If a real fixture cannot be produced, cover via a stubbed source keystore object exposing `isKeyEntry=true` / `getCertificateChain=[]`.

**KS-F3-14 — bad/corrupted source bytes** · *negative*
- **Steps:** `importPkcs12(sessionId,{sourceBytes:<bad.p12>, sourcePassword:'testpassword'})`.
- **Expected:** Throws `KeystoreEngineException` (parse failure). Root cause surfaced; envelope-safe at the handler layer. Target unchanged.
- **Notes:** Distinguishes malformed-file (engine class) from validation class.

#### Group B — `importKeyMaterial` (KS-F3-15 … KS-F3-27)

**KS-F3-15 — RSA PKCS#8 key + cert (happy path)** · *positive*
- **Preconditions:** Empty PKCS12 session; `client.pkcs8.key` + `client.crt`.
- **Steps:** `importKeyMaterial(sessionId,{alias:'rsa-pkcs8', privateKeyPem, certificatePem})`; `aliasDetail`.
- **Expected:** `aliasCount===1`; `entryType 'KEY'`, `hasPrivateKey true`; `chain[0].publicKeyAlgorithm 'RSA'`, `keySize 2048`, subjectDN contains `test-client`. `verifyKeyMatchesCertificate` passed silently (§6.7 RSA→SHA256withRSA).
- **Notes:** §4.5 PKCS#8 path; `parsePrivateKey` recognises PKCS#8 (§6.11).

**KS-F3-16 — RSA OpenSSL/PKCS#1 traditional key + cert** · *positive*
- **Preconditions:** `client.key` (`BEGIN RSA PRIVATE KEY`) + `client.crt`.
- **Steps:** `importKeyMaterial(sessionId,{alias:'rsa-openssl', privateKeyPem:<client.key>, certificatePem:<client.crt>})`; `aliasDetail`.
- **Expected:** aliasCount 1; key entry created; key-match passes; `chain[0].keySize 2048`, `publicKeyAlgorithm 'RSA'`.
- **Notes:** §4.5 OpenSSL path — confirms `parsePrivateKey` handles PKCS#1 traditional RSA (§6.11).

**KS-F3-17 — EC P-256 PKCS#8 key + cert** · *positive*
- **Steps:** `importKeyMaterial(sessionId,{alias:'ec256', privateKeyPem:<ec-p256.pkcs8.key>, certificatePem:<ec-p256.crt>})`; `aliasDetail`.
- **Expected:** aliasCount 1; `chain[0].publicKeyAlgorithm 'EC'`, `keySize 256`. Key-match verified via §6.7 EC→SHA256withECDSA.
- **Notes:** EC branch + EC field-size extraction (§6.6).

**KS-F3-18 — EC P-256 SEC1 (`BEGIN EC PRIVATE KEY`) key** · *positive*
- **Steps:** `importKeyMaterial(sessionId,{alias:'ec256-sec1', privateKeyPem:<ec-p256.key>, certificatePem:<ec-p256.crt>})`.
- **Expected:** aliasCount 1; key-match passes; keyAlgorithm EC, keySize 256.
- **Notes:** §6.11 `parsePrivateKey` must recognise SEC1 EC keys, not just PKCS#8.

**KS-F3-19 — EC P-384 key + cert (curve/field-size coverage)** · *positive*
- **Steps:** `importKeyMaterial(sessionId,{alias:'ec384', privateKeyPem:<ec-p384.pkcs8.key>, certificatePem:<ec-p384.crt>})`; `aliasDetail`.
- **Expected:** aliasCount 1; `publicKeyAlgorithm 'EC'`, `keySize 384`. Key-match via SHA256withECDSA.
- **Notes:** A second EC curve confirms field-size extraction generalises (256 vs 384).

**KS-F3-20 — multi-cert chain in certificatePem** · *positive*
- **Steps:** `importKeyMaterial(sessionId,{alias:'chain-key', privateKeyPem:<client.pkcs8.key>, certificatePem:<client.crt + '\n' + ca.crt>})`; `aliasDetail`.
- **Expected:** aliasCount 1; `chain.length===2`; `chain[0]` leaf `test-client`, `chain[1]` `Testnizer Test CA`. The key-match is performed against the **FIRST (leaf)** cert and passes.
- **Notes:** §4.5 "≥1 cert" + `parseCertificates` collects all CERTIFICATE blocks (§6.11). The key must match the leaf, not the CA.

**KS-F3-21 — key does NOT match certificate** · *negative*
- **Steps:** `importKeyMaterial(sessionId,{alias:'mismatch', privateKeyPem:<client.key>, certificatePem:<server.crt>})`.
- **Expected:** Throws `KeystoreValidationException` `Private key does not match the provided certificate`. **No entry added** (aliasCount unchanged).
- **Notes:** Core §6.7 gate — prevents silent wrong-pair insertion.

**KS-F3-22 — empty private key** · *negative* — Steps: `importKeyMaterial(sessionId,{alias:'k', privateKeyPem:'', certificatePem:<client.crt>})`. **Expected:** Throws `Private key (PEM) cannot be empty`; no mutation. **Notes:** §8 — checked before parse.

**KS-F3-23 — no private key block / unparseable key** · *negative*
- **Steps:** (A) `privateKeyPem = <client.crt>` (a CERTIFICATE, no key block); (B) `privateKeyPem = '-----BEGIN PRIVATE KEY-----\nZ3JiYWdl\n-----END PRIVATE KEY-----'`.
- **Expected:** (A) throws `No private key found in the provided PEM`; (B) throws `Could not parse private key from PEM: <detay>` (detail = underlying parser message). Both `KeystoreValidationException`. No mutation.
- **Notes:** §8:732/737 — two distinct messages: no key block detected vs parse throw.

**KS-F3-24 — missing/invalid certificate** · *negative*
- **Steps:** `importKeyMaterial(sessionId,{alias:'k', privateKeyPem:<client.pkcs8.key>, certificatePem:''})`; variant with `'not a cert'`.
- **Expected:** Throws `At least one certificate (PEM) is required`. No mutation.
- **Notes:** §4.5 "≥1 cert zorunlu". Distinct from importPem's `A certificate is required to import a private key`.

**KS-F3-25 — alias already exists (requireNewAlias)** · *negative*
- **Preconditions:** Session already containing alias `dup`.
- **Steps:** `importKeyMaterial(sessionId,{alias:'dup', privateKeyPem:<client.pkcs8.key>, certificatePem:<client.crt>})`.
- **Expected:** Throws `Alias already exists: dup`. No overwrite.
- **Notes:** §4.5 `requireNewAlias` (§6.13) — imports never silently replace an existing alias.

**KS-F3-26 — empty alias** · *negative* — Steps: `importKeyMaterial(sessionId,{alias:'', …})`. **Expected:** Throws `Alias cannot be empty`; no mutation. **Notes:** §6.13/§8.

**KS-F3-27 — entryPassword protects the key entry** · *edge*
- **Preconditions:** PKCS12 session, store pw `store-pw`.
- **Steps:** `importKeyMaterial(sessionId,{alias:'prot', privateKeyPem:<client.pkcs8.key>, certificatePem:<client.crt>, entryPassword:'ep'})`; recover with store pw (expect fail), then with `ep` (expect ok).
- **Expected:** Import succeeds (aliasCount +1). Key recoverable only with `ep`; store-pw recovery yields §8 `Cannot recover key entry 'prot'. The entry password differs from the store password — please provide the entry password.`

#### Group C — `importPem` (KS-F3-28 … KS-F3-33)

**KS-F3-28 — combined key+cert block → key entry** · *positive*
- **Steps:** `pemContent = client.pkcs8.key + '\n' + client.crt + '\n' + ca.crt`; `importPem(sessionId,{alias:'combined', pemContent})`; `aliasDetail`.
- **Expected:** aliasCount 1; `entryType 'KEY'`, `hasPrivateKey true`, `chain.length===2` (leaf+CA). Key-match against the leaf passed.
- **Notes:** §4.6 — private key present ⇒ cert mandatory + key-match ⇒ key entry. Both parsed from the SAME pemContent (§6.11).

**KS-F3-29 — cert-only (no private key) → trusted certificate entry** · *positive*
- **Steps:** `importPem(sessionId,{alias:'ca-trust', pemContent:<ca.crt>})`; `aliasDetail`.
- **Expected:** aliasCount 1; `entryType 'CERTIFICATE'`, `hasPrivateKey false`, `chain.length===1`, `chain[0].subjectDN` contains `Testnizer Test CA`.
- **Notes:** §4.6 — no private key ⇒ first cert imported as a trusted cert entry (`setCertificateEntry`).

**KS-F3-30 — cert-only multi-cert PEM imports the FIRST cert** · *edge*
- **Steps:** `pemContent = client.crt + '\n' + ca.crt` (no key); `importPem(sessionId,{alias:'first-only', pemContent})`; `aliasDetail`.
- **Expected:** aliasCount 1; a single CERTIFICATE entry whose `chain[0].subjectDN` contains `test-client` (the FIRST cert). `ca.crt` is NOT imported.
- **Notes:** §4.6 "ilk cert'i trusted cert entry olarak ekle".

**KS-F3-31 — private key present but no certificate** · *negative*
- **Steps:** `importPem(sessionId,{alias:'keyonly', pemContent:<client.pkcs8.key>})`.
- **Expected:** Throws `A certificate is required to import a private key`. No mutation.
- **Notes:** §4.6 + §8:733 — the importPem-specific message (distinct from importKeyMaterial's).

**KS-F3-32 — neither key nor certificate found** · *negative*
- **Steps:** `importPem(sessionId,{alias:'empty', pemContent:'-----BEGIN NONSENSE-----\nZ3Ji\n-----END NONSENSE-----'})`; variant `'hello world'`.
- **Expected:** Throws `No private key or certificate found in the provided PEM`. No mutation.
- **Notes:** §8:734 — both parse paths empty.

**KS-F3-33 — key + mismatched cert in the same block** · *negative*
- **Steps:** `importPem(sessionId,{alias:'mm', pemContent:<client.key + '\n' + server.crt>})`.
- **Expected:** Throws `Private key does not match the provided certificate`. No mutation.
- **Notes:** §4.6 routes through the same §6.7 gate when a key is present.

#### Group D — `importTrustedCertificate` (KS-F3-34 … KS-F3-38)

**KS-F3-34 — from PEM** · *positive*
- **Steps:** `importTrustedCert(sessionId,{alias:'ca', certificateContent:<ca.crt PEM>})`; `aliasDetail`.
- **Expected:** aliasCount 1; `entryType 'CERTIFICATE'`, `hasPrivateKey false`, `chain[0].subjectDN` contains `Testnizer Test CA`, `issuerDN == subjectDN` (self-signed root).
- **Notes:** §4.7 PEM path (§6.11 CERTIFICATE-block branch).

**KS-F3-35 — from base64 DER (no PEM headers)** · *interop*
- **Preconditions:** `client.der.b64` = base64 of DER-encoded `client.crt` (no BEGIN/END).
- **Steps:** `importTrustedCert(sessionId,{alias:'der-cert', certificateContent:<blob>})`; `aliasDetail`.
- **Expected:** aliasCount 1; CERTIFICATE entry; `chain[0].subjectDN` contains `test-client`; parsed via the base64-DER decode branch (§6.11: no `-----BEGIN` ⇒ base64 DER decode).
- **Notes:** §4.7 explicitly accepts PEM OR base64 DER.

**KS-F3-36 — content has no certificate** · *negative*
- **Steps:** `importTrustedCert(sessionId,{alias:'x', certificateContent:'not base64, not pem'})`; variant with a valid-base64-but-not-DER blob.
- **Expected:** Throws `No certificate found in the provided content`. No mutation.
- **Notes:** §8 — both PEM-block-absent and DER-decode-fails routes land here.

**KS-F3-37 — alias already exists** · *negative* — Preconditions: session already contains `ca`. Steps: import again. **Expected:** Throws `Alias already exists: ca`; no overwrite. **Notes:** §4.7 `requireNewAlias` (§6.13).

**KS-F3-38 — empty alias** · *negative* — Steps: `importTrustedCert(sessionId,{alias:'', certificateContent:<ca.crt>})`. **Expected:** Throws `Alias cannot be empty`; no mutation. **Notes:** §8.

#### Group E — `verifyKeyMatchesCertificate` + IPC security (KS-F3-39 … KS-F3-45)

**KS-F3-39 — RSA matching pair passes** · *positive*
- **Steps:** Parse the private key from `client.pkcs8.key` and the public key from `client.crt`; call `engine.verifyKeyMatchesCertificate(privateKey, publicKey)`.
- **Expected:** Returns without throwing. Internally signs the probe `apinizer-keystore-studio-key-match-probe` (US-ASCII) with SHA256withRSA and verifies it (or performs the SPKI-DER compare).
- **Notes:** §6.7 RSA branch.

**KS-F3-40 — EC matching pair passes** · *positive*
- **Steps:** Parse `ec-p256.key` + `ec-p256.crt`; `engine.verifyKeyMatchesCertificate(ecPriv, ecPub)`.
- **Expected:** Returns without throwing; uses SHA256withECDSA (§6.7 EC branch).
- **Notes:** Confirms the EC path is wired (not only RSA).

**KS-F3-41 — mismatched pair throws** · *negative*
- **Steps:** `engine.verifyKeyMatchesCertificate(clientPriv, serverPub)`.
- **Expected:** Throws `Private key does not match the provided certificate` (`KeystoreValidationException`).
- **Notes:** §6.7 — the single source of the mismatch guard used by KS-F3-21 and KS-F3-33.

**KS-F3-42 — unsupported algorithm is best-effort skipped** · *edge*
- **Preconditions:** An Ed25519 keypair+cert generated in-test via `crypto.generateKeyPairSync('ed25519')`.
- **Steps:** `engine.verifyKeyMatchesCertificate(edPriv, edPub)`.
- **Expected:** Returns **without throwing** (sigAlg resolves to null for unsupported algorithms ⇒ early return, §6.7:619). No false-negative rejection.
- **Notes:** Guards against blocking a legitimate but unverifiable algorithm. Security-adjacent: the skip must be explicit, not an accidental pass of a mismatched supported-alg pair. *(If the SPKI-DER compare is adopted as primary, this case instead asserts the compare handles Ed25519 correctly.)*

**KS-F3-43 — the check actually validates (not stubbed)** · *security*
- **Steps:** (1) Confirm the matching pair passes (KS-F3-39). (2) Swap in `server.crt`'s public key while keeping client's private key — assert it now throws. (3) *(white-box, optional)* confirm the probe text is the exact US-ASCII constant and that `verify()` — not a hardcoded `true` — gates the result.
- **Expected:** Matching ⇒ pass; any real modulus/curve-point change ⇒ throw `Private key does not match the provided certificate`. Proves a genuine sign+verify (or SPKI compare), closing the silent wrong-pair insertion hole (§6.7:625).
- **Notes:** Prevents a regression where the probe is stubbed/short-circuited to always return true.

**KS-F3-44 — import handlers never leak private key / password / raw bytes** · *security*
- **Preconditions:** `setupHandlerHarness` + `makeElectronMock`; keystore handlers registered; a live sessionId from `keystore:createEmpty`.
- **Steps:** (1) `harness.invoke('keystore:importKeyMaterial',{sessionId, alias:'sec', privateKeyPem:<client.pkcs8.key>, certificatePem:<client.crt>})`. (2) Repeat for `keystore:importPkcs12` (with sourceBytes + `sourcePassword:'testpassword'`) and `keystore:importTrustedCert`. (3) `blob = JSON.stringify(res)`.
- **Expected:** Each `res = {success:true, data:<KeystoreMeta>}`. `blob` does **not** contain `PRIVATE KEY`, does **not** contain `testpassword` or any store/entry password, and does **not** contain the raw keystore base64 bytes. `data` carries only meta (type, aliasCount, `AliasSummary[]` / public `CertificateInfo` + public PEM).
- **Notes:** Enforces the design's security spine — this is the reason the tool is main-process, not renderer-pure.

**KS-F3-45 — validation vs engine error both return `{success:false}` without leaking** · *security*
- **Steps:** (1) Validation: `harness.invoke('keystore:importPkcs12',{sessionId, sourceBytes:'', sourcePassword:'x'})`. (2) Engine: `harness.invoke('keystore:importPkcs12',{sessionId, sourceBytes:<client.p12>, sourcePassword:'WRONG'})`. (3) Inspect both envelopes.
- **Expected:** (1) `{success:false, error:'Source keystore content cannot be empty'}` — the verbatim §8 validation string. (2) `{success:false, error:<root-cause / friendly "Parola yanlış veya dosya bozuk">}` — engine class, still no stack/keys in the error. Neither error string contains `PRIVATE KEY` or the attempted password.
- **Notes:** §8 two-class contract at the IPC boundary; `wrap(fn)` must catch both.

---

### 8.4 Faz 4 — Edit / Export / Persist: `renameAlias` · `changeStorePassword` · `setEntryPassword` · `deleteEntry` · `exportCertificate` · `convert` · `saveAs` — 54 cases

**Pattern.** Engine tests build sessions with `engine.createEmpty({type,storePassword})` + `generateKeyPair`/`generateSecretKey`/`importTrustedCert` for fully deterministic fixtures, OR `engine.loadOrCreate(readFileSync(fixture), pw, type)` for the on-disk `.p12`/`.jks`. Assert `KeystoreMutationResponse` (`type`, `aliasCount`, `dirty`) and, after re-`inspect`/`aliasDetail`, exact `CertificateInfo` fields. Round-trip export: mock `fs` to capture the bytes handed to `writeFile`, re-parse with node-forge/@peculiar to prove leaf equality.

Handler tests mock `dialog.showSaveDialog`/`showOpenDialog` (already in `makeElectronMock`) and `node:fs/promises` (or `fs`) so `saveAs`/`exportCertificate` writes are captured, never touching disk. **The security invariant of this file:** every successful main→renderer response has NO `base64Content`, NO raw keystore Buffer/bytes, NO `password`/`storePassword`/`entryPassword`/`newPassword`, and NO private-key PEM — only safe meta or, for export/saveAs, only `{path}`.

**Password-model note.** PKCS12 uses one password for MAC + keys, so **every "entry password differs from store password" case MUST use a JKS session** where `generateKeyPair` was given a distinct `entryPassword`.

#### Group A — `renameAlias` (KS-F4-01 … KS-F4-08)

**KS-F4-01 — rename on RSA key entry preserves key + chain + cert identity** · *positive*
- **Preconditions:** S = `loadOrCreate(client.p12,'testpassword','PKCS12')`; alias `test-client` is a key entry (chain length 2). PKCS12 entry pw == store pw.
- **Steps:** (1) capture `aliasDetail(S,'test-client')` → serialNumber, sha1Fingerprint, `subjectDN='CN=test-client'`; (2) `keystore:renameAlias {sessionId:S, alias:'test-client', newAlias:'client2', entryPassword:'testpassword'}`; (3) `keystore:inspect`; (4) `keystore:aliasDetail {alias:'client2'}`.
- **Expected:** rename → success, `KeystoreMutationResponse {type:'PKCS12', aliasCount:1, dirty:true}`. inspect: `aliases=[{alias:'client2', entryType:'KEY', hasPrivateKey:true, chainLength:2}]`; old `test-client` absent. `aliasDetail('client2').chain[0]` has **identical** serialNumber, sha1Fingerprint, subjectDN — only the alias changed. Envelope carries no keystore bytes / password / private key.
- **Notes:** Rename = read key+chain with entryPassword → `setKeyEntry(newAlias,…)` → `deleteEntry(old)`. Cert bytes must be byte-identical (fingerprint proves it).

**KS-F4-02 — rename on a cert-only (trusted) entry needs no entry password** · *positive*
- **Preconditions:** S = `createEmpty('PKCS12','changeit')`; `importTrustedCert(S,{alias:'root', certificateContent:<ca.crt>})`.
- **Steps:** `keystore:renameAlias {alias:'root', newAlias:'root-ca'}` with **no** entryPassword; `inspect`.
- **Expected:** success, `aliasCount:1`, `dirty:true`. inspect lists only `{alias:'root-ca', entryType:'CERTIFICATE', hasPrivateKey:false, chainLength:1}`. No error despite the omitted entryPassword (cert entries take the `setCertificateEntry` path, §4.10).
- **Notes:** Guards the key-entry vs certificate-entry branch split.

**KS-F4-03 — resolves to store password when entryPassword omitted (pw == store pw)** · *positive*
- **Preconditions:** S = `createEmpty('JKS','storepass')`; `generateKeyPair(S,{alias:'a', keyAlgorithm:'RSA', keySize:2048, entryPassword:'storepass'})`.
- **Steps:** `renameAlias {alias:'a', newAlias:'b'}` with entryPassword OMITTED; `aliasDetail(S,'b')`.
- **Expected:** success (resolveEntryPassword falls back to `storepass`, which recovers the key). `aliasDetail('b')` returns the RSA cert (`publicKeyAlgorithm:'RSA'`, `keySize:2048`). aliasCount 1.
- **Notes:** §6.13 `resolveEntryPassword(null → storePw)` happy path.

**KS-F4-04 — alias not found** · *negative* — Steps: `renameAlias {alias:'ghost', newAlias:'x'}`. **Expected:** `{success:false, error:'Alias not found: ghost'}` (`requireAlias`). Keystore unchanged (aliasCount still 1, dirty unchanged). **Notes:** §8; the engine test asserts `toThrow` with the same message.

**KS-F4-05 — new alias empty** · *negative* — Steps: `renameAlias {alias:'test-client', newAlias:''}`; repeat with `'   '`. **Expected:** Both `{success:false, error:'New alias cannot be empty'}` (`requireNewAlias` treats whitespace as blank). No mutation. **Notes:** §8.

**KS-F4-06 — target alias already exists (collision)** · *negative*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(alias:'a')`; `importTrustedCert(alias:'b')` → 2 aliases.
- **Steps:** `renameAlias {alias:'a', newAlias:'b', entryPassword:'pw'}`.
- **Expected:** `{success:false, error:'Alias already exists: b'}`. aliasCount stays 2, both originals intact. **Notes:** §8.

**KS-F4-07 — key entry password differs from store pw and is not supplied** · *negative*
- **Preconditions:** S = `createEmpty('JKS','storepass')`; `generateKeyPair(S,{alias:'a', keyAlgorithm:'RSA', keySize:2048, entryPassword:'entrypw'})` — DISTINCT entry pw (JKS supports per-entry pw).
- **Steps:** `renameAlias {alias:'a', newAlias:'b'}` with entryPassword OMITTED (resolves to `storepass`, which is wrong).
- **Expected:** `{success:false, error:"Cannot recover key entry 'a'. The entry password differs from the store password — please provide the entry password."}`. No mutation. Then supplying `entryPassword:'entrypw'` succeeds (positive counter-check).
- **Notes:** **Must be JKS** — PKCS12 uses one password, so this branch is unreachable there. Same message family as convert/setEntryPassword/changeStorePassword recovery failures.

**KS-F4-08 — newAlias equals current alias; and empty alias** · *edge*
- **Steps:** (1) `renameAlias {alias:'test-client', newAlias:'test-client', entryPassword:'testpassword'}`; (2) `renameAlias {alias:'', newAlias:'x'}`.
- **Expected:** (1) `{success:false, error:'Alias already exists: test-client'}` (requireNewAlias sees it exists). (2) `{success:false, error:'Alias cannot be empty'}` (requireAlias runs first). Keystore unchanged either way.
- **Notes:** Validation ordering: `requireAlias(alias)` before `requireNewAlias(newAlias)`.

#### Group B — `changeStorePassword` (KS-F4-09 … KS-F4-15)

**KS-F4-09 — re-encrypts a single key entry; working pw becomes new** · *positive*
- **Preconditions:** S = `createEmpty('PKCS12','oldpass')`; `generateKeyPair(alias:'a', RSA-2048, entryPassword:'oldpass')`.
- **Steps:** (1) `changeStorePassword {newPassword:'newpass'}`; (2) `aliasDetail(S,'a')`; (3) `saveAs` (mock showSaveDialog → `/tmp/out.p12`, mock fs.writeFile).
- **Expected:** success, `{type:'PKCS12', aliasCount:1, dirty:true}`. The session's working store password is now `newpass`; `aliasDetail` still returns the RSA cert. Envelope carries **no** password. Saved bytes open with `newpass` only (proven in KS-F4-14).
- **Notes:** §4.11 — each key entry read (per-alias entry pw or old store pw) then re-set with newPassword; store serialized with newPassword.

**KS-F4-10 — with aliasEntryPasswords map (multiple distinct entry pws)** · *positive*
- **Preconditions:** S = `createEmpty('JKS','storepass')`; `generateKeyPair(k1, RSA, entryPassword:'p1')`; `generateKeyPair(k2, EC P-256, entryPassword:'p2')`.
- **Steps:** `changeStorePassword {newPassword:'newstore', aliasEntryPasswords:{k1:'p1', k2:'p2'}}`; `inspect`.
- **Expected:** success, `{type:'JKS', aliasCount:2, dirty:true}`. Both entries re-encrypted under `newstore`; inspect returns k1 (RSA) + k2 (EC P-256). After this the UI resets `aliasEntryPasswords={}` (per-entry pws now all equal the new store pw). Every entry recoverable with `newstore`.
- **Notes:** §4.11 + UI note (line 385/805). Verifies the map is consumed per-alias.

**KS-F4-11 — on a cert-only truststore (no key re-encrypt)** · *positive*
- **Preconditions:** S = `createEmpty('JKS','old')`; `importTrustedCert(alias:'ca')`.
- **Steps:** `changeStorePassword {newPassword:'brandnew'}`; `saveAs` → `/tmp/trust.jks`.
- **Expected:** success, `{aliasCount:1, dirty:true}`. No key entries to re-encrypt; only the store integrity password changes. Saved JKS opens with `brandnew` (`keytool -list -storepass brandnew`) and fails with `old`.
- **Notes:** Covers the no-key-entries branch.

**KS-F4-12 — new password empty** · *negative* — Steps: `changeStorePassword {newPassword:''}`; repeat with `'   '`. **Expected:** Both `{success:false, error:'New password cannot be empty'}`. Session store password unchanged, dirty unchanged. **Notes:** §8 — the changeStorePassword variant, distinct from convert's message.

**KS-F4-13 — an entry pw differs and is missing from the map** · *negative*
- **Preconditions:** S = `createEmpty('JKS','storepass')`; `generateKeyPair(k1, entryPassword:'storepass')`; `generateKeyPair(k2, entryPassword:'secret2')`.
- **Steps:** `changeStorePassword {newPassword:'newstore', aliasEntryPasswords:{}}` (k2 omitted → resolves to old store pw, wrong for k2).
- **Expected:** `{success:false, error:"Cannot recover key entry 'k2'. The entry password differs from the store password — please provide the entry password."}`. Store password **NOT** changed (atomic failure — no partial re-encrypt visible). Supplying `{k2:'secret2'}` then succeeds.
- **Notes:** Failure must not leave the session half-mutated; a re-inspect must still open with the ORIGINAL store pw.

**KS-F4-14 — saved file opens ONLY with the new password** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('JKS','oldpw')`; `generateKeyPair(a, RSA-2048, entryPassword:'oldpw')`.
- **Steps:** (1) `changeStorePassword {newPassword:'newpw'}`; (2) `saveAs` → `os.tmpdir()/cs.jks` (real fs in the interop file); (3) `keytool -list -keystore cs.jks -storepass newpw`; (4) same with `-storepass oldpw`.
- **Expected:** newpw → exit 0, lists alias `a` as PrivateKeyEntry. oldpw → non-zero / "password was incorrect". Proves re-encryption + the new store integrity hash are consistent.
- **Notes:** Highest-value proof that the pure-TS jks-writer produces a keytool-valid MAC after re-key.

**KS-F4-15 — redundant map entry (alias pw already == store pw)** · *edge*
- **Preconditions:** S = `createEmpty('PKCS12','same')`; `generateKeyPair(a, EC P-384, entryPassword:'same')`.
- **Steps:** `changeStorePassword {newPassword:'fresh', aliasEntryPasswords:{a:'same'}}`.
- **Expected:** success, `{type:'PKCS12', aliasCount:1, dirty:true}`. The redundant map entry is harmless. `aliasDetail('a')` → EC, `keySize:384`, `publicKeyAlgorithm:'EC'`.
- **Notes:** Ensures the map path and the fallback path converge.

#### Group C — `setEntryPassword` (KS-F4-16 … KS-F4-22)

**KS-F4-16 — rotates a key entry's password (old fails, new works)** · *positive*
- **Preconditions:** S = `createEmpty('JKS','store')`; `generateKeyPair(a, RSA-2048, entryPassword:'oldentry')`.
- **Steps:** (1) `setEntryPassword {alias:'a', entryPassword:'oldentry', newEntryPassword:'newentry'}`; (2) `renameAlias {alias:'a', newAlias:'a', entryPassword:'oldentry'}` (probe — should now fail recovery); (3) `setEntryPassword {alias:'a', entryPassword:'newentry', newEntryPassword:'newentry2'}` (probe — new pw live).
- **Expected:** (1) success, `{aliasCount:1, dirty:true}`. (2) `{success:false, error:"Cannot recover key entry 'a'…"}` (old entry pw dead). (3) success. Envelope never returns any password.
- **Notes:** §4.12 — read with the current entry pw, re-set with newEntryPassword.

**KS-F4-17 — current entryPassword omitted falls back to store pw** · *positive*
- **Preconditions:** S = `createEmpty('JKS','storepw')`; `generateKeyPair(a, entryPassword:'storepw')`.
- **Steps:** `setEntryPassword {alias:'a', newEntryPassword:'distinct'}` with entryPassword OMITTED.
- **Expected:** success, `{aliasCount:1, dirty:true}`. resolveEntryPassword falls back to `storepw`, recovers the key, re-encrypts under `distinct`. Key now recoverable only with `distinct`.
- **Notes:** §6.13 fallback branch for setEntryPassword.

**KS-F4-18 — rejected on a certificate-only entry** · *negative*
- **Preconditions:** S = `createEmpty('JKS','store')`; `importTrustedCert(alias:'ca')`.
- **Steps:** `setEntryPassword {alias:'ca', newEntryPassword:'x'}`.
- **Expected:** `{success:false, error:'Entry password can only be set on a key entry: ca'}`. No mutation.
- **Notes:** §8 — key-entry constraint (§4.12).

**KS-F4-19 — new entry password empty** · *negative* — Steps: `setEntryPassword {alias:'a', entryPassword:'store', newEntryPassword:''}`; repeat with `'   '`. **Expected:** Both `{success:false, error:'New entry password cannot be empty'}`; no mutation. **Notes:** §8 — validated before attempting key recovery.

**KS-F4-20 — wrong current entry password** · *negative*
- **Preconditions:** S = `createEmpty('JKS','store')`; `generateKeyPair(a, entryPassword:'realpw')`.
- **Steps:** `setEntryPassword {alias:'a', entryPassword:'wrongpw', newEntryPassword:'new'}`.
- **Expected:** `{success:false, error:"Cannot recover key entry 'a'. The entry password differs from the store password — please provide the entry password."}`. No mutation; `realpw` still valid.
- **Notes:** UnrecoverableKeyException → the recovery-failure message (§8).

**KS-F4-21 — alias not found** · *negative* — Steps: `setEntryPassword {alias:'nope', newEntryPassword:'x'}`. **Expected:** `{success:false, error:'Alias not found: nope'}` (requireAlias runs first); no mutation. **Notes:** §8; ordering: requireAlias before key-entry / empty checks.

**KS-F4-22 — survives save + keytool key recovery with the new pw** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('JKS','store')`; `generateKeyPair(a, RSA-2048, entryPassword:'store')`.
- **Steps:** (1) `setEntryPassword {alias:'a', entryPassword:'store', newEntryPassword:'keypw'}`; (2) `saveAs` → `os.tmpdir()/ep.jks`; (3) `keytool -keypasswd -alias a -keystore ep.jks -storepass store -keypass keypw -new keypw2`; (4) same with `-keypass store`.
- **Expected:** (3) succeeds (key recovered). (4) fails ("Cannot recover key"). Proves the jks-writer wrote the key-protection blob under the new entry password correctly.
- **Notes:** Directly exercises `jks-writer.ts` key protection encrypt vs keytool decrypt.

#### Group D — `deleteEntry` (KS-F4-23 … KS-F4-28)

**KS-F4-23 — removes a key entry and decrements aliasCount** · *positive*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(a)`; `importTrustedCert(b)` → 2 aliases.
- **Steps:** `deleteEntry {alias:'a'}`; `inspect`; `aliasDetail {alias:'a'}`.
- **Expected:** delete → success, `{type:'PKCS12', aliasCount:1, dirty:true}`. inspect returns only `b`. `aliasDetail('a')` → `{success:false, error:'Alias not found: a'}`. **Notes:** §4.13.

**KS-F4-24 — removes a cert-only entry** · *positive*
- **Preconditions:** S = `createEmpty('JKS','pw')`; `importTrustedCert(ca)`; `generateKeyPair(k)` → 2 aliases.
- **Steps:** `deleteEntry {alias:'ca'}`; `inspect`.
- **Expected:** success, `{aliasCount:1, dirty:true}`; inspect returns only the key entry `k`. **Notes:** deleteEntry does not care about entry type.

**KS-F4-25 — deleting the last entry yields a valid empty keystore** · *edge*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(only)` → 1 alias.
- **Steps:** `deleteEntry {alias:'only'}`; `inspect`; `saveAs` (mock dialog → `/tmp/empty.p12`).
- **Expected:** delete → success, `{aliasCount:0, dirty:true}`. inspect → `{type:'PKCS12', aliasCount:0, aliases:[]}`. saveAs writes a well-formed empty PKCS12 (re-loadable with `pw`). No crash on zero-entry mutate/store.
- **Notes:** Empty-store serialization is a real edge for node-forge / jks-writer.

**KS-F4-26 — alias not found** · *negative* — Steps: `deleteEntry {alias:'missing'}`. **Expected:** `{success:false, error:'Alias not found: missing'}`; aliasCount unchanged (1), dirty unchanged. **Notes:** §8 (requireAlias).

**KS-F4-27 — empty alias** · *negative* — Steps: `deleteEntry {alias:''}`; repeat with `'   '`. **Expected:** Both `{success:false, error:'Alias cannot be empty'}`; no mutation. **Notes:** §8.

**KS-F4-28 — purges private-key material from the saved working copy** · *security*
- **Preconditions:** S = `loadOrCreate(client.p12,'testpassword','PKCS12')`.
- **Steps:** (1) `deleteEntry {alias:'test-client'}`; (2) `saveAs` (capture bytes via mocked fs.writeFile); (3) re-parse the captured bytes with `node-forge pkcs12FromAsn1(pw='testpassword')`.
- **Expected:** The re-parsed keystore has 0 aliases and contains **no** PKCS8/keyBag for test-client — the private key is gone from the persisted bytes, not merely hidden from inspect. The delete envelope carries no key material.
- **Notes:** Confirms deletion mutates the actual working Buffer, not just the alias summary list.

#### Group E — `exportCertificate` (KS-F4-29 … KS-F4-38)

**KS-F4-29 — PEM writes the leaf cert with correct extension/contentType** · *positive*
- **Preconditions:** S = `loadOrCreate(client.p12,'testpassword','PKCS12')`. Mock showSaveDialog → `/tmp/test-client.pem`, mock fs.writeFile capturing bytes.
- **Steps:** `exportCertificate {alias:'test-client', format:'PEM'}`; inspect the default filename passed to showSaveDialog and the captured bytes.
- **Expected:** success, `data {path:'/tmp/test-client.pem'}`. Default save filename `test-client.pem` (`sanitize(alias)+'.pem'`), contentType `application/x-pem-file`. Written text starts `-----BEGIN CERTIFICATE-----`, is 64-col wrapped, and decodes to the leaf DER whose subject is `CN=test-client`. **No private key** in output; the envelope has no cert bytes/key — only `{path}`.
- **Notes:** §4.14 PEM row. `dirty` is **not** affected by export.

**KS-F4-30 — DER produces raw leaf, `.cer` / `application/pkix-cert`** · *positive*
- **Steps:** `exportCertificate {alias:'test-client', format:'DER'}`; capture bytes; parse.
- **Expected:** success, `{path:'/tmp/test-client.cer'}`. Default filename `test-client.cer`, contentType `application/pkix-cert`. Bytes are raw DER (first byte `0x30`), byte-equal to `cert.getEncoded()` of the leaf; parses to subject `CN=test-client`. No BEGIN/END wrapper. **Notes:** §4.14 DER row.

**KS-F4-31 — PKCS7 emits the full chain, `.p7b` / `application/x-pkcs7-certificates`** · *interop*
- **Preconditions:** openssl available; chain = [leaf, CA] (length 2). Write to `os.tmpdir()/tc.p7b`.
- **Steps:** `exportCertificate {alias:'test-client', format:'PKCS7'}`; `openssl pkcs7 -inform DER -in tc.p7b -print_certs`.
- **Expected:** success, `{path:…/tc.p7b}`, contentType `application/x-pkcs7-certificates`, filename `test-client.p7b`. `-print_certs` lists **TWO** certs (`CN=test-client` AND `CN=Testnizer Test CA`) — `generateCertPath(chain)` includes the whole chain, not just the leaf.
- **Notes:** §4.14/§6.12. Contrast with DER/PEM which are leaf-only (KS-F4-34).

**KS-F4-32 — PKIPATH emits a reverse-order cert SEQUENCE, `.pkipath` / `application/pkix-pkipath`** · *interop*
- **Steps:** `exportCertificate {alias:'test-client', format:'PKIPATH'}`; `openssl asn1parse -inform DER -in tc.pkipath`.
- **Expected:** success, `{path:…/tc.pkipath}`, contentType `application/pkix-pkipath`, filename `test-client.pkipath`. Bytes are a DER `SEQUENCE OF Certificate` containing 2 certs in **PkiPath order (root-first — CA then leaf, reverse of PKCS7)**. asn1parse shows an outer SEQUENCE wrapping two Certificate SEQUENCEs.
- **Notes:** §4.14 — assert ordering explicitly.

**KS-F4-33 — default format is PEM when format omitted** · *positive*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(a, EC P-256, entryPassword:'pw')`. Mock dialog → `/tmp/a.pem`.
- **Steps:** `exportCertificate {alias:'a'}` with NO format field.
- **Expected:** success; treated as PEM (§4.14 default). filename `a.pem`, contentType `application/x-pem-file`. Output is a single BEGIN/END CERTIFICATE block for the EC self-signed leaf.

**KS-F4-34 — DER/PEM export ONLY the leaf even with a multi-cert chain** · *edge*
- **Steps:** (1) export PEM; count BEGIN CERTIFICATE blocks. (2) export DER; parse and count certs.
- **Expected:** PEM output contains **exactly one** certificate block (leaf `CN=test-client`); DER output is a single certificate. The CA is NOT included — DER/PEM are `chain[0]`-only per §4.14, unlike PKCS7/PKIPATH.
- **Notes:** Guards against accidentally exporting the whole chain in leaf-only formats.

**KS-F4-35 — sanitizes unsafe alias characters in the filename** · *edge*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(alias:'my client:cert/1', …)`. Mock showSaveDialog to capture `defaultPath`.
- **Steps:** `exportCertificate {alias:'my client:cert/1', format:'DER'}`.
- **Expected:** Default save filename `my_client_cert_1.cer` — `sanitizeFileName` replaces every `[^a-zA-Z0-9._-]` with `_` (§6.13). success, `{path}` reflects whatever the dialog returned.
- **Notes:** The alias lookup uses the raw alias; only the FILENAME is sanitized.

**KS-F4-36 — unsupported format** · *negative* — Steps: `exportCertificate {alias:'test-client', format:'JCEKS'}`. **Expected:** `{success:false, error:'Unsupported export format: JCEKS'}`. showSaveDialog **not** called; no file written. **Notes:** §8; allow-list `DER|PEM|PKCS7|PKIPATH` (case-normalized).

**KS-F4-37 — alias not found; and save-dialog canceled** · *negative*
- **Steps:** (1) `exportCertificate {alias:'nope', format:'PEM'}`; (2) `exportCertificate {alias:'test-client', format:'PEM'}` with showSaveDialog mocked → `{canceled:true, filePath:undefined}`.
- **Expected:** (1) `{success:false, error:'Alias not found: nope'}`. (2) `success:true` with `data {canceled:true}` (or `{path:null}`); `fs.writeFile` NOT called, nothing written. Neither changes keystore state.
- **Notes:** requireAlias runs before the dialog; cancel is a clean no-op (mirrors the save.handler pattern).

**KS-F4-38 — key entry with no certificate chain** · *edge*
- **Preconditions:** Constructed fixture — a JKS session whose alias `orphan` is a key entry with an EMPTY cert chain (reachable only by loading a hand-built keystore).
- **Steps:** `exportCertificate {alias:'orphan', format:'DER'}`.
- **Expected:** `{success:false, error:'Key entry has no certificate chain: orphan'}` (§8). No file written.
- **Notes:** Defensive branch — normal flows never produce a chainless key entry, so this needs a crafted fixture. Document it as the only way to hit §8:738.

#### Group F — `convert` (KS-F4-39 … KS-F4-47)

**KS-F4-39 — PKCS12 → JKS preserves the RSA key entry (keytool interop)** · *interop*
- **Preconditions:** keytool available. S = `loadOrCreate(client.p12,'testpassword','PKCS12')`.
- **Steps:** (1) `convert {targetType:'JKS', newPassword:'jkspass', entryPassword:'testpassword'}` → new session S2; (2) `saveAs S2` → `os.tmpdir()/conv.jks`; (3) `keytool -list -v -keystore conv.jks -storepass jkspass`.
- **Expected:** convert → success, data references a **NEW** session `{type:'JKS', aliasCount:1, dirty:true}`. Original S untouched (still PKCS12). keytool shows alias `test-client`, `PrivateKeyEntry`, chain length 2, subject `CN=test-client` — proving the private key was PKCS8-encoded and the jks-writer wrote a keytool-readable store.
- **Notes:** §4.15 + §S.4 — the primary requirement; exercises `jks-writer.ts`.

**KS-F4-40 — JKS → PKCS12 preserves the key entry (openssl interop)** · *interop*
- **Preconditions:** openssl available. S = `loadOrCreate(client.jks,'testpassword','JKS')`.
- **Steps:** (1) `convert {targetType:'PKCS12', newPassword:'p12pass', entryPassword:'testpassword'}` → S2; (2) `saveAs S2` → `conv.p12`; (3) `openssl pkcs12 -info -in conv.p12 -passin pass:p12pass -nokeys`; (4) `openssl pkcs12 -in conv.p12 -passin pass:p12pass -nocerts -nodes | grep 'BEGIN PRIVATE KEY'`.
- **Expected:** convert → success, new session `{type:'PKCS12', aliasCount:1, dirty:true}`. `-info` lists the friendlyName/alias and cert chain; `-nocerts` extracts a private key. Proves the node-forge PKCS12 build from a JKS-sourced key+chain.
- **Notes:** §S.4 JKS→PKCS12 (pure JS, no jks-writer).

**KS-F4-41 — PKCS12 → JKS with an EC (P-256) key entry** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('PKCS12','pw')`; `generateKeyPair(ec, EC P-256, entryPassword:'pw')` (@peculiar self-signed).
- **Steps:** (1) `convert {targetType:'JKS', newPassword:'jkspw', entryPassword:'pw'}` → S2; (2) `saveAs` → `ec.jks`; (3) `keytool -list -v -keystore ec.jks -storepass jkspw`.
- **Expected:** success; keytool shows alias `ec`, `PrivateKeyEntry`, `Signature algorithm name: SHA256withECDSA`, `Subject Public Key Algorithm: 256-bit EC key`. Proves EC private keys are PKCS8-encoded for the JKS writer (not just RSA).
- **Notes:** §S.4 PKCS8 rule applies to EC too; guards the @peculiar → PKCS8 → jks-writer path.

**KS-F4-42 — PKCS12 → JKS skips a secret (AES) key entry** · *edge*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateSecretKey(aes, AES-256, entryPassword:'pw')`; `generateKeyPair(kp, RSA, entryPassword:'pw')` → 2 aliases.
- **Steps:** `convert {targetType:'JKS', newPassword:'jkspw', entryPassword:'pw'}` → S2; `inspect(S2)`.
- **Expected:** success; S2 `{type:'JKS', aliasCount:1}`. inspect contains ONLY `kp` — the AES secret was silently skipped (JKS cannot hold secret keys, §6.10 return 0). **No error** thrown for the skip.
- **Notes:** Converse (PKCS12→PKCS12) would keep it — contrast with KS-F4-47.

**KS-F4-43 — cert-only truststore JKS → PKCS12** · *positive*
- **Preconditions:** S = `createEmpty('JKS','trust')`; `importTrustedCert(ca)`; `importTrustedCert(srv)` → 2 cert-only entries.
- **Steps:** `convert {targetType:'PKCS12', newPassword:'p12pw'}` (no entryPassword needed — no key entries) → S2; `inspect(S2)`.
- **Expected:** success; S2 `{type:'PKCS12', aliasCount:2}`. Both copied as CERTIFICATE entries (`setCertificateEntry` path). Fingerprints of `ca`/`srv` unchanged from source.
- **Notes:** §6.10 certificate branch; convert works with zero key entries.

**KS-F4-44 — new store password empty** · *negative* — Steps: `convert {targetType:'JKS', newPassword:''}`; repeat with `'   '`. **Expected:** Both `{success:false, error:'New store password is required for convert format'}`. No new session; original unchanged. **Notes:** §8 — the **convert-specific** empty-password message, distinct from changeStorePassword's.

**KS-F4-45 — unsupported target type** · *negative* — Steps: `convert {targetType:'BKS', newPassword:'x'}`; repeat with `'jceks'`. **Expected:** `{success:false, error:'Unsupported keystore type: BKS'}` and `… : jceks` (message echoes the raw input pre-uppercase per §6.1). No new session. **Notes:** §6.1 allow-list = {JKS, PKCS12}.

**KS-F4-46 — key entry password differs and is not supplied (UnrecoverableKey)** · *negative*
- **Preconditions:** S = `createEmpty('JKS','storepass')`; `generateKeyPair(a, entryPassword:'entrypw')`.
- **Steps:** `convert {targetType:'PKCS12', newPassword:'newpw'}` with entryPassword OMITTED.
- **Expected:** `{success:false, error:"Cannot recover key entry 'a'. The entry password differs from the store password — please provide the entry password."}`. No new session. Supplying `entryPassword:'entrypw'` then converts successfully.
- **Notes:** §4.15; same message family as F4-07/13/20.

**KS-F4-47 — multi-alias PKCS12 → JKS preserves all entries (count parity)** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('PKCS12','pw')`; `generateKeyPair(rsa1, RSA-2048, entryPassword:'pw')`; `generateKeyPair(ec1, EC P-384, entryPassword:'pw')`; `importTrustedCert(ca)` → 3 aliases.
- **Steps:** (1) `convert {targetType:'JKS', newPassword:'jkspw', entryPassword:'pw'}` → S2; (2) `saveAs` → `multi.jks`; (3) `keytool -list -keystore multi.jks -storepass jkspw`.
- **Expected:** success; S2 `aliasCount:3`. keytool shows 3 entries: `rsa1` (PrivateKeyEntry), `ec1` (PrivateKeyEntry), `ca` (trustedCertEntry). Confirms convert copies **every** entry (Apinizer parity, §S.4).
- **Notes:** Multi-key JKS write is the trickiest jks-writer path (multiple key-protected blobs + one store MAC). See also risk R2 for the PKCS12 direction.

#### Group G — `saveAs` + session lifecycle (KS-F4-48 … KS-F4-54)

**KS-F4-48 — writes PKCS12 bytes, returns `{path}`, clears dirty** · *positive*
- **Preconditions:** S = `createEmpty('PKCS12','pw')`; `generateKeyPair(a, entryPassword:'pw')` → dirty true. Mock showSaveDialog → `{canceled:false, filePath:'/tmp/out.p12'}`, mock fs.writeFile capture.
- **Steps:** (1) `saveAs {sessionId:S}`; (2) `inspect` to read dirty; (3) re-parse captured bytes with `node-forge pkcs12FromAsn1(pw='pw')`.
- **Expected:** success, `data {path:'/tmp/out.p12'}`. `fs.writeFile` called once with the keystore Buffer and that path. Session `dirty` is now **false** (Model A). Re-parse yields alias `a` with a private key — valid PKCS12. Envelope returns ONLY `{path}`, never the bytes.
- **Notes:** §4.16 Model A. Default dialog filename/extension derived from type (`.p12`).

**KS-F4-49 — writes JKS via the pure-TS jks-writer** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('JKS','storepw')`; `generateKeyPair(a, RSA-2048, entryPassword:'storepw')`. Dialog → `os.tmpdir()/save.jks`.
- **Steps:** (1) `saveAs`; (2) `keytool -list -keystore save.jks -storepass storepw`; (3) `xxd save.jks | head`.
- **Expected:** success, `{path:…/save.jks}`, `dirty=false`. First 4 bytes `FE ED FE ED`. keytool → alias `a` PrivateKeyEntry, **no** MAC/integrity warning — proving the SHA-1 store hash and key protection are correct.
- **Notes:** Core proof of Option C. **Must hard-fail in CI (R1).**

**KS-F4-50 — dialog canceled leaves the file unwritten and dirty untouched** · *edge*
- **Preconditions:** Session with `dirty=true`. Mock showSaveDialog → `{canceled:true, filePath:undefined}`.
- **Steps:** `saveAs {sessionId:S}`; `inspect` to read dirty.
- **Expected:** `success:true` with `data {canceled:true}` (or `{path:null}`); `fs.writeFile` NOT called. Session `dirty` **remains true** (Model A only clears dirty on an actual write). No file on disk.
- **Notes:** Mirrors save.handler "Cancelled" behavior.

**KS-F4-51 — PKCS12 round-trip openable by openssl with the store password** · *interop*
- **Preconditions:** openssl available. S = `loadOrCreate(client.p12,'testpassword','PKCS12')` then `renameAlias` to `renamed` (entryPassword `testpassword`). Real showSaveDialog → `os.tmpdir()/rt.p12`.
- **Steps:** (1) `saveAs`; (2) `openssl pkcs12 -info -in rt.p12 -passin pass:testpassword -nokeys`; (3) same with `-passin pass:wrongpw`.
- **Expected:** Correct pass → exit 0, prints the cert chain and friendlyName `renamed`. Wrong pass → "mac verify failure" / non-zero. Confirms a mutated-then-saved PKCS12 stays interoperable and password-bound.
- **Notes:** Ties Edit + Persist together end-to-end.

**KS-F4-52 — saveAs never leaks keystore bytes or passwords across IPC** · *security*
- **Preconditions:** S = `loadOrCreate(client.p12,'testpassword','PKCS12')`. Mock showSaveDialog → `/tmp/s.p12`, mock fs.writeFile capture.
- **Steps:** (1) `saveAs` via the handler; (2) deep-inspect the returned envelope `data`; (3) assert nothing password-shaped is written in plaintext (grep the captured Buffer for ASCII `testpassword`).
- **Expected:** `data === {path:'/tmp/s.p12'}` (plus optional type) — **no** base64Content, **no** Buffer, **no** `password`/`storePassword` field, **no** private-key PEM. The written file is encrypted PKCS12 (the store password is not present as ASCII plaintext). The renderer only learns the path it will display.
- **Notes:** Enforces the sessionId-in-main security model. Pair with equivalent assertions on the renameAlias / changeStorePassword / setEntryPassword / deleteEntry envelopes.

**KS-F4-53 — saveAs after changeStorePassword persists the NEW password only** · *interop*
- **Preconditions:** keytool available. S = `createEmpty('JKS','oldpw')`; `generateKeyPair(a, RSA-2048, entryPassword:'oldpw')`; then `changeStorePassword {newPassword:'newpw'}`.
- **Steps:** (1) `saveAs` → `os.tmpdir()/chained.jks`; (2) `keytool -list -keystore chained.jks -storepass newpw`; (3) same with `oldpw`.
- **Expected:** `dirty=false` after save. newpw → success (alias `a`); oldpw → failure. Proves the Edit→Persist chain writes the post-change working password and that `saveAs` serializes the **current** session state, not the loaded original.
- **Notes:** Guards against `saveAs` snapshotting a stale pre-mutation buffer.

**KS-F4-54 — any Faz-4 op on an unknown/disposed sessionId fails cleanly** · *negative*
- **Preconditions:** Session created then `keystore:closeSession {sessionId:S}`.
- **Steps:** (1) `renameAlias {sessionId:S, alias:'a', newAlias:'b'}`; (2) `deleteEntry {sessionId:'never-existed', alias:'a'}`; (3) `saveAs {sessionId:S}`.
- **Expected:** Every call → `{success:false}` with a clear error (e.g. "Session not found") — the handler `wrap(fn)` returns an envelope rather than throwing/rejecting across IPC. No stale Buffer/password is accessible after `closeSession`.
- **Notes:** Session-lifecycle safety for the whole phase; asserts `closeSession` frees the in-main working copy.

---

### 8.5 Cross-cutting suite — 60 cases (KS-X-01 … KS-X-60)

These exercise the tool end-to-end across every phase (engine, IPC/session, renderer store, persistence, packaging, i18n, and the Phase-5 bridge), independent of any single unit. They enforce the chosen-design invariants: main-process engine with a sessionId model, pure-TS JKS writer (Option C) with keystore-go as fallback only, node-forge (RSA/PKCS12) + @peculiar/x509 (EC certs), and Save-As-only persistence (Model A).

**Placement.** Interop → `tests/main/keystore-interop.test.ts` (`describe.skipIf(!hasKeytool && !hasOpenssl)`, detected via `which keytool` / `java -version` and `which openssl` at module load; drive the engine API directly, write real files to a tmp dir, `execFileSync` the external tool, assert on stdout). Negative catalogue → `tests/main/keystore.test.ts` (engine, `rejects.toThrow(/exact message/)`) **plus** `tests/main/handlers/keystore.test.ts` (`{success:false, error:<same message>}`). Security → handler harness. Packaging/native → assertions plus the existing CI smoke gate (`npm run test:e2e:smoke`, which launches the production main bundle). i18n → `tests/renderer/keystore-i18n.test.ts`.

**Extra fixtures for this suite:** `keytool-diffpass.jks` (`keytool -genkeypair … -storepass testpassword -keypass differentpass`) drives the key-protector interop and the "Cannot recover key entry" negative. EC fixtures are generated at test time by the engine and verified with openssl, since @peculiar/x509 owns the EC cert path.

#### Group A — Cross-tool interop (KS-X-01 … KS-X-12)

**KS-X-01 — tool-generated `.p12` opens in `openssl pkcs12 -info`** · *interop*
- **Preconditions:** openssl on PATH (skipIf); writable tmp dir.
- **Steps:** (1) `createEmpty {type:'PKCS12', storePassword:'testpassword'}`; (2) `generateKeyPair {alias:'leaf', keyAlgorithm:'RSA', keySize:2048, subjectDN:'CN=interop', validityDays:365}`; (3) `saveAs` → `tmp/out.p12`; (4) `openssl pkcs12 -info -in tmp/out.p12 -passin pass:testpassword -nokeys`, then again with `-nocerts -noenc` for the key.
- **Expected:** openssl exits 0; stdout shows friendlyName/alias `leaf`, one certificate (`CN=interop`) and one RSA private key bag; MAC verification passes (no "Mac verify error"). Confirms node-forge PKCS12 + MAC are OpenSSL-compatible.
- **Notes:** Also run without `-passin` to assert `Mac verify error: invalid password?`, proving the MAC actually protects the store.

**KS-X-02 — tool-generated `.jks` opens in real `keytool -list`** · *interop*
- **Preconditions:** keytool/JDK on PATH (skipIf). Exercises `jks-writer.ts` (Option C).
- **Steps:** (1) `createEmpty {type:'JKS', storePassword:'testpassword'}`; (2) `generateKeyPair {alias:'jkskey', keyAlgorithm:'RSA', keySize:2048}`; (3) `saveAs` → `tmp/out.jks`; (4) `keytool -list -v -keystore tmp/out.jks -storepass testpassword`.
- **Expected:** keytool exits 0; output shows `Keystore type: JKS`, one entry `jkskey` of type `PrivateKeyEntry`, plus fingerprints and cert chain. No "Invalid keystore format" / "DerInputStream" error. **Highest-risk interop point** (a frozen format written by pure TS).
- **Notes:** Assert the store-integrity check passes with the correct storepass; a mangled SHA-1 store hash makes keytool throw "Keystore was tampered with, or password was incorrect". **Must hard-fail in CI (R1).**

**KS-X-03 — keytool-produced `.jks` opens in the tool (reverse interop)** · *interop*
- **Preconditions:** `client.jks` produced by `keytool -importkeystore` from client.p12.
- **Steps:** (1) load `client.jks` with storePassword `testpassword`; (2) `inspect`; (3) `aliasDetail('test-client')`.
- **Expected:** `typeAutoDetected='JKS'`; inspect returns `aliasCount>=1` with alias `test-client`, `entryType KEY`, `hasPrivateKey=true`, `keyAlgorithm 'RSA'`; `aliasDetail.chain[0]` has subjectDN `CN=test-client` and a valid PEM. The jks-js read path parses keytool's Sun key protection.
- **Notes:** Round-trips against KS-X-02 — the format we write and read is the format keytool writes and reads.

**KS-X-04 — openssl-produced `.p12` opens in the tool (reverse interop)** · *interop*
- **Steps:** (1) load `client.p12` with `testpassword`; (2) `inspect`; (3) `aliasDetail('test-client')`.
- **Expected:** `typeAutoDetected='PKCS12'`; alias `test-client` present, `hasPrivateKey=true`; chain length 2 (leaf + CA) with leaf `issuerDN` == CA `subjectDN`; fingerprints uppercase colon-separated. node-forge decodes OpenSSL PBES2/PBES1 bags.
- **Notes:** Also verify `bad.p12` surfaces the friendly "password wrong or file corrupt" error (ties to KS-X-13).

**KS-X-05 — PKCS12→JKS convert verified by the opposite tool (keytool)** · *interop*
- **Steps:** (1) load `client.p12`; (2) `convert {targetType:'JKS', newPassword:'testpassword'}`; (3) `saveAs` → `tmp/converted.jks`; (4) `keytool -list -v -keystore tmp/converted.jks -storepass testpassword`.
- **Expected:** keytool reports type JKS, the same entry count and alias `test-client` as the source, PrivateKeyEntry recoverable; leaf fingerprint matches the source `.p12` leaf. Convert preserves entries and key recoverability across formats (§6:900).
- **Notes:** Assert entry-count parity: openssl-listed count of client.p12 == keytool-listed count of converted.jks.

**KS-X-06 — JKS→PKCS12 convert verified by the opposite tool (openssl)** · *interop*
- **Steps:** (1) load `client.jks`; (2) `convert {targetType:'PKCS12', newPassword:'testpassword'}`; (3) `saveAs` → `tmp/converted.p12`; (4) `openssl pkcs12 -info -in tmp/converted.p12 -passin pass:testpassword -nokeys`.
- **Expected:** openssl exits 0, MAC verifies, lists alias `test-client` with the RSA cert chain; a follow-up `-nocerts` call extracts a private key (proving the key survived JKS→PKCS12).
- **Notes:** Completes the both-directions convert matrix, each verified by the **opposite** external tool.

**KS-X-07 — EC (P-256/384/521) keypair `.p12` round-trips through openssl** · *interop*
- **Steps:** (1) `createEmpty` PKCS12; (2) for each curve in [P-256, P-384, P-521] `generateKeyPair {alias:'ec'+curve, keyAlgorithm:'EC', curve, signatureAlg:'SHA256withECDSA'}`; (3) `saveAs`; (4) `openssl pkcs12 -info -nokeys`, then `openssl x509 -noout -text` on the extracted cert.
- **Expected:** openssl parses each store; `x509 -text` shows `Public Key Algorithm: id-ecPublicKey`, the correct named curve (prime256v1 / secp384r1 / secp521r1), and a valid ECDSA-with-SHA256 signature.
- **Notes:** secp256k1 is deferred (WebCrypto lacks it) — assert `generateKeyPair EC secp256k1` throws `Unsupported EC curve: secp256k1` unless `@noble/curves` was wired (ties to KS-X-31 and KS-F2-10).

**KS-X-08 — JKS entry password ≠ store password is keytool-interoperable both ways** · *interop*
- **Preconditions:** keytool on PATH; `keytool-diffpass.jks` (storepass `testpassword`, keypass `differentpass`).
- **Steps:** **Direction A:** open `keytool-diffpass.jks` in the tool with store pw `testpassword`; `aliasDetail` providing `entryPassword:'differentpass'`. **Direction B:** in the tool `createEmpty` JKS, `generateKeyPair` with `entryPassword:'differentpass'`, `saveAs` → `tmp/diff.jks`, then `keytool -exportcert -alias … -keystore tmp/diff.jks -storepass testpassword -keypass differentpass`.
- **Expected:** A recovers the key only when the correct entry password is supplied. B: keytool exports the cert successfully with `-keypass differentpass`, proving the tool's key protector is byte-compatible with keytool's. Without the entry pw both sides report a recovery failure.
- **Notes:** Directly validates the subtlest part of Option C against the real Sun implementation.

**KS-X-09 — exported cert formats re-parse in openssl (PEM/DER/PKCS7/PKIPATH)** · *interop*
- **Steps:** (1) `format:'PEM'` → `openssl x509 -in file -noout -subject`; (2) `format:'DER'` → `openssl x509 -inform DER -in file -noout -subject`; (3) `format:'PKCS7'` → `openssl pkcs7 -in file -print_certs` (matching `-inform`); (4) `format:'PKIPATH'` → parse as an ASN.1 SEQUENCE of certs.
- **Expected:** Every format parses without error; subject matches `CN=test-client`; PKCS7/PKIPATH contain the full chain (leaf+CA). **Only PUBLIC certificate bytes are written** — `BEGIN PRIVATE KEY` appears in no exported file (cross-check with grep).
- **Notes:** Ties export interop to the security invariant.

**KS-X-10 — fingerprints match `openssl x509 -fingerprint`** · *interop*
- **Steps:** (1) `aliasDetail('test-client')` → read `chain[0].sha1Fingerprint` and `sha256Fingerprint`; (2) `openssl x509 -in client.crt -noout -fingerprint -sha1` and `-sha256`.
- **Expected:** Tool fingerprints equal openssl's byte-for-byte after normalizing case/colons (spec requires uppercase, colon-separated).
- **Notes:** Known-answer: pin the exact expected fingerprints of the committed `client.crt` so this also runs without openssl.

**KS-X-11 — chained cross-tool round-trip (tool → keytool → tool)** · *interop*
- **Steps:** (1) Tool: `createEmpty` JKS, `generateKeyPair alias:'roundtrip'`, `saveAs` → `tmp/a.jks`; (2) `keytool -importkeystore -srckeystore tmp/a.jks -srcstoretype JKS -destkeystore tmp/b.p12 -deststoretype PKCS12 -srcstorepass testpassword -deststorepass testpassword`; (3) Tool: load `tmp/b.p12`, `inspect` + `aliasDetail('roundtrip')`.
- **Expected:** The tool re-opens keytool's PKCS12 output; alias `roundtrip`, key recoverable, leaf fingerprint identical to the originally generated cert.
- **Notes:** Strongest single interop signal — combines write-JKS, keytool convert, and read-PKCS12.

**KS-X-12 — AES secret key in PKCS12 is listed by keytool as SecretKeyEntry** · *interop*
- **Steps:** (1) `createEmpty` PKCS12; (2) `generateSecretKey {alias:'aeskey', keyAlgorithm:'AES', keySize:256}`; (3) `saveAs` → `tmp/secret.p12`; (4) `keytool -list -v -keystore tmp/secret.p12 -storepass testpassword -storetype PKCS12`.
- **Expected:** keytool lists `aeskey` as `SecretKeyEntry`. Confirms node-forge's PKCS12 secret-bag encoding is keytool-readable.
- **Notes:** keytool needs `-storetype PKCS12` to surface secret entries. Contrast KS-X-32 (the same op on JKS is rejected before write).

#### Group B — Full §8 negative catalogue (KS-X-13 … KS-X-34)

**KS-X-13 — wrong store password → friendly, non-technical error** · *negative*
- **Steps:** `loadKeyStore(client.p12, storePassword:'wrongpass')`.
- **Expected:** `KeystoreEngineException` is caught and surfaced as the friendly `Password is wrong or the file is corrupt` (§8:718 mapping), **not** a raw node-forge "PKCS#12 MAC could not be verified" stack. Handler returns `{success:false, error:<friendly>}`.
- **Notes:** Also assert `bad.p12` (garbage content) yields the same friendly class, not an uncaught throw.

**KS-X-14 — empty store password rejected on createEmpty** · *negative* — Steps: `createEmpty {type:'PKCS12', storePassword:''}`. **Expected:** `Store password cannot be empty` (validation class, shown verbatim in a toast). **Notes:** §8:722.

**KS-X-15 — empty keystore content rejected on load** · *negative* — Steps: `loadKeyStore` with a zero-length Buffer / empty file. **Expected:** `Keystore content cannot be empty` (§8:723). **Notes:** `pickFile` reading a 0-byte file must reach this validation, not a downstream parse crash.

**KS-X-16 — unsupported keystore type rejected** · *negative* — Steps: `createEmpty {type:'BKS', storePassword:'x'}`. **Expected:** `Unsupported keystore type: BKS` (§8:724). resolveType allow-lists only JKS/PKCS12 (empty→JKS default). **Notes:** BKS/UBER/BCFKS are explicitly deferred — confirm they are rejected, not silently coerced.

**KS-X-17 — alias empty and alias-not-found rejected on lookups** · *negative*
- **Steps:** `aliasDetail(sessionId,'')`; `aliasDetail(sessionId,'ghost')`; likewise `deleteEntry` and `exportCertificate` with `'ghost'`.
- **Expected:** `Alias cannot be empty` and `Alias not found: ghost` (§8:725) across **every** alias-taking op (the `requireAlias` guard). No partial mutation, dirty flag unchanged.
- **Notes:** Covers two catalogue entries; assert consistency across all alias-consuming channels.

**KS-X-18 — generating into an existing alias is rejected** · *negative* — Preconditions: session already has alias `dup`. Steps: `generateKeyPair {alias:'dup', keyAlgorithm:'RSA', keySize:2048}`. **Expected:** `Alias already exists: dup` (§8:725); existing entry untouched. **Notes:** Also applies to importTrustedCert/importKeyMaterial with a colliding target alias.

**KS-X-19 — rename validation: empty new alias / target already exists** · *negative*
- **Preconditions:** Session has aliases `a` and `b`.
- **Steps:** `renameAlias {alias:'a', newAlias:''}`; `renameAlias {alias:'a', newAlias:'b'}`.
- **Expected:** `New alias cannot be empty` (§8:726) and `Target alias already exists: b` (§8:731). The tracked entry-password map is not corrupted on failure.
- **Notes:** Follow-up positive: a successful rename carries the tracked entry password to the new alias (§9.5:804).

**KS-X-20 — change-store-password / convert password validation** · *negative*
- **Steps:** `changeStorePassword {newPassword:''}`; `convert {targetType:'JKS', newPassword:''}`.
- **Expected:** `New password cannot be empty` and `New store password is required for convert format` (both §8:727).
- **Notes:** Two distinct catalogue entries with similar intent — assert both strings exactly.

**KS-X-21 — set-entry-password validation (empty / non-key entry)** · *negative*
- **Preconditions:** Session has key entry `k` and trusted-cert entry `trust`.
- **Steps:** `setEntryPassword {alias:'k', newEntryPassword:''}`; `setEntryPassword {alias:'trust', newEntryPassword:'x'}`.
- **Expected:** `New entry password cannot be empty` (§8:728) and `Entry password can only be set on a key entry: trust` (§8:729).
- **Notes:** Entry passwords are meaningless on trusted-cert/secret entries and must be blocked; entryType is checked before mutation.

**KS-X-22 — import-PKCS12 source validation trio** · *negative*
- **Steps:** (1) `importPkcs12 {sourceBytes: empty}`; (2) `importPkcs12 {sourceBytes: client.p12, sourceAlias:'ghost'}`; (3) import a source whose only entries are unsupported for the target.
- **Expected:** `Source keystore content cannot be empty`; `Source alias not found: ghost`; `No importable entries found in the source keystore` (§8:730-731). The third fires e.g. when importing a PKCS12 containing only a secret key into a JKS target (§:905).
- **Notes:** The third trigger doubles as the JKS-target secret-skip behavior check.

**KS-X-23 — import key material: missing/invalid private key** · *negative*
- **Steps:** `importKeyMaterial {privateKeyPem:'', certificatePem:<valid>}`; then `privateKeyPem` = a CERTIFICATE block (no key).
- **Expected:** `Private key (PEM) cannot be empty`; `No private key found in the provided PEM` (§8:732).

**KS-X-24 — import key material: missing certificate** · *negative*
- **Steps:** `importKeyMaterial {privateKeyPem:<valid>, certificatePem:''}`; and an importPem/importKeyMaterial path where the cert list resolves empty.
- **Expected:** `A certificate is required to import a private key` and `At least one certificate (PEM) is required` (§8:733). A key entry cannot exist without at least one cert.
- **Notes:** Which string fires depends on the import channel (paired importKeyMaterial vs multi-cert importPem).

**KS-X-25 — pasted PEM with neither key nor cert** · *negative* — Steps: `importPem {pemContent:'just some text, no PEM blocks'}`. **Expected:** `No private key or certificate found in the provided PEM` (§8:734). **Notes:** Pasted-PEM auto-detects: key+cert→key entry, cert-only→trusted, neither→this error.

**KS-X-26 — trusted-cert import with no certificate in content** · *negative*
- **Steps:** `importTrustedCert {alias:'t', certificateContent:'not a cert'}`; and with a PEM that is a private key, not a cert.
- **Expected:** `No certificate found in the provided content` (§8:735). Accepts PEM or base64 DER; anything else rejected.
- **Notes:** Positive counterpart: `ca.crt` (PEM) and its base64-DER both import as a TrustedCertificateEntry.

**KS-X-27 — key/cert mismatch is cryptographically rejected (CRITICAL)** · *negative*
- **Steps:** `importKeyMaterial {privateKeyPem: client.key, certificatePem: server.crt}`.
- **Expected:** `Private key does not match the provided certificate` (§8:736). The engine signs-then-verifies (§6.7, §10 item 4) — or compares SPKI DER — and refuses to create an inconsistent key entry.
- **Notes:** Assert **both** an RSA mismatch (client.key/server.crt) and an EC mismatch are caught.

**KS-X-28 — unparseable private key PEM surfaces the root cause** · *negative*
- **Steps:** `importKeyMaterial {privateKeyPem:'-----BEGIN PRIVATE KEY-----\nBADBASE64\n-----END PRIVATE KEY-----', certificatePem:<valid>}`.
- **Expected:** Matches `Could not parse private key from PEM: <detail>` (§8:737) with a non-empty detail. Validation (user-fixable) class, shown verbatim.
- **Notes:** The detail portion is engine-dependent; assert the prefix and that a detail follows.

**KS-X-29 — export cert on a key entry lacking a chain** · *negative*
- **Steps:** `exportCertificate {alias:'chainless', format:'PEM'}` on a key entry imported without any certificate chain.
- **Expected:** `Key entry has no certificate chain: chainless` (§8:738).
- **Notes:** If the engine forbids chainless key entries at import time (KS-X-24), document this message as defensive/unreachable — still assert it exists in the catalogue + i18n.

**KS-X-30 — recovering a key entry without its differing entry password** · *negative*
- **Preconditions:** `keytool-diffpass.jks` (entry pw `differentpass` ≠ store pw).
- **Steps:** Load with store pw `testpassword`; attempt an op requiring key recovery (convert, or aliasDetail requiring the key) **without** supplying entryPassword.
- **Expected:** `Cannot recover key entry '<alias>'. The entry password differs from the store password — please provide the entry password.` (§8:739). Supplying the correct entryPassword succeeds.
- **Notes:** Pairs with KS-X-08 — this is the failure branch of the same key-protector logic.

**KS-X-31 — generate key pair: unsupported size / curve / algorithm** · *negative*
- **Steps:** `{keyAlgorithm:'RSA', keySize:1023}`; `{keyAlgorithm:'EC', curve:'brainpoolP256'}`; `{keyAlgorithm:'DSA'}`.
- **Expected:** `Unsupported RSA key size: 1023`; `Unsupported EC curve: brainpoolP256`; `Unsupported key algorithm: DSA` (§8:740). Allow-list: RSA 1024/2048/3072/4096, EC P-256/384/521 (+secp256k1 only if `@noble/curves` is wired), algorithms RSA/EC only.
- **Notes:** RSA-1024 and secp256k1 are **allowed** by design (test flexibility, §10 item 7) — assert 1024 **succeeds** (optionally with a weak-key UI hint) while 1023 fails.

**KS-X-32 — generate secret key: unsupported algo/size + JKS rejection** · *negative*
- **Steps:** `generateSecretKey` on a JKS session; `{keyAlgorithm:'DES'}` on PKCS12; `{keyAlgorithm:'AES', keySize:200}`.
- **Expected:** `Secret keys can only be stored in a PKCS12 keystore`; `Unsupported secret key algorithm: DES`; `Unsupported AES key size: 200` (§8:741-742). The JKS check fires **first** regardless of algo/size. AES sizes limited to 128/192/256.
- **Notes:** UI corollary — the "Generate Secret Key" menu item is disabled for JKS sessions (§9.1:779); the engine still enforces it defensively.

**KS-X-33 — invalid serial number and unsupported key usage** · *negative*
- **Steps:** `{serialNumber:'not-a-number'}`; `{keyUsage:['telepathy']}`.
- **Expected:** `Invalid serial number: not-a-number`; `Unsupported key usage: telepathy` (§8:743). Serial accepts decimal/hex per spec; keyUsage allow-list is the X.509 value set (digitalSignature … cRLSign).
- **Notes:** Positive counterpart: a valid large hex serial and multi-value keyUsage produce a cert whose extensions `openssl x509 -text` confirms (links to KS-X-01).

**KS-X-34 — unsupported export format rejected** · *negative* — Steps: `exportCertificate {alias:'test-client', format:'JCEKS'}`. **Expected:** `Unsupported export format: JCEKS` (§8:744). Allow-list DER/PEM/PKCS7/PKIPATH. **Notes:** Completes the §8 catalogue — every line 722-744 mapped to a trigger.

#### Group C — Security invariants (KS-X-35 … KS-X-43)

**KS-X-35 — generateKeyPair never returns private key material to the renderer** · *security*
- **Steps:** Invoke `keystore:generateKeyPair` via the harness; deep-scan the entire `{success,data}` envelope.
- **Expected:** `data` is safe meta only (alias, keyAlgorithm, keySize, subjectDN, fingerprints, notAfter, PEM of the **public** cert). No property named `privateKey`/`privateKeyPem`/`d`/`keyMaterial`; no `BEGIN PRIVATE KEY` / `BEGIN RSA PRIVATE KEY` / `BEGIN EC PRIVATE KEY` substring anywhere in the serialized envelope.
- **Notes:** Mirror `otp.test.ts`'s `expect(data).not.toHaveProperty('secret')`; recurse the object graph for both key names and PEM substrings.

**KS-X-36 — generateSecretKey never returns raw secret bytes** · *security*
- **Steps:** Invoke `keystore:generateSecretKey` (PKCS12); scan the envelope.
- **Expected:** `data` has alias / `keyAlgorithm:'AES'` / keySize only; no base64/hex secret bytes, no `secret`/`keyMaterial` property. The AES key stays in the main-process session Buffer.

**KS-X-37 — no store/entry passwords appear in any IPC response** · *security*
- **Steps:** Drive a full lifecycle through the harness with distinctive passwords (store `STOREPW-SENTINEL`, entry `ENTRYPW-SENTINEL`); after every invoke assert neither sentinel appears anywhere in `JSON.stringify(response)`.
- **Expected:** No response envelope (createEmpty, inspect, generateKeyPair, changeStorePassword, setEntryPassword, convert, saveAs, closeSession) contains either sentinel. Passwords are inputs only; they never round-trip back.
- **Notes:** Sentinels make grep-style assertions unambiguous across all 18 ops.

**KS-X-38 — raw keystore bytes never cross IPC; renderer holds only sessionId + meta** · *security*
- **Steps:** (1) `createEmpty` + `generateKeyPair` — capture every response; (2) assert no response contains a Buffer/Uint8Array/ArrayBuffer of keystore content and no base64 blob resembling a keystore (no `fileBase64`, no `0xFEEDFEED`/PKCS12 header bytes); (3) assert renderer store state = `{sessionId, meta, dirty}` only.
- **Expected:** Only a string `sessionId` + safe meta cross the bridge. The keystore Buffer lives solely in the main `Map<sessionId,session>`. `saveAs`/`exportCertificate` write bytes in main via `fs` and return a path, never bytes.
- **Notes:** This is the core reason the design rejected the Apinizer base64-in-renderer model.

**KS-X-39 — Save-As writes only the encrypted keystore; no plaintext secret hits disk** · *security*
- **Steps:** (1) `saveAs` a session with a key entry to `tmp/out.p12`; (2) scan the written file bytes for the sentinel store/entry passwords in plaintext; (3) scan the tmp dir and OS temp for any intermediate plaintext key/password file.
- **Expected:** Only the password-protected keystore file is written; the passwords never appear as plaintext in it or in any temp file (they protect the MAC/key encryption but are not stored). No stray `.pem`/`.key` temp artifact. `dirty` flips to false only after a successful write (Model A).
- **Notes:** §10 item 1 — passwords in memory only, never written plaintext to disk.

**KS-X-40 — log hygiene: no key/secret/password/keystore bytes are logged** · *security*
- **Steps:** Spy on console-logger / `console.*` / `process.stderr`; run success ops and force error paths (KS-X-13 wrong password, KS-X-27 key-cert mismatch, parse failure) with sentinel secrets; inspect all captured output.
- **Expected:** Logs contain only meta (type, alias, op name) per §10 item 2. No private-key PEM, no secret bytes, no store/entry password sentinels, no raw keystore Buffer — **even inside caught-exception messages and stack traces**.
- **Notes:** Especially assert the friendly-error wrapping (KS-X-13) does not log the underlying node-forge exception verbatim if it echoes input bytes.

**KS-X-41 — DevTools/renderer cannot read the session Map or raw bytes** · *security*
- **Steps:** (1) Inspect `src/preload/index.ts` keystore bridge — every method is `ipcRenderer.invoke('keystore:*')` only; (2) assert no method returns or exposes the main-side session Map, keystore Buffer, or passwords; (3) in a renderer/jsdom test assert `window.api.keystore` exposes only the whitelisted invoke methods and no raw-bytes accessor.
- **Expected:** The contextIsolation boundary holds: the renderer (and thus DevTools / an XSS payload / a malicious extension) can only send channel messages and receive safe meta. No window global, no preload-leaked reference to keystore bytes or the session store.
- **Notes:** This test defends the main-process-tool design rationale.

**KS-X-42 — closeSession frees bytes and passwords; post-close access denied** · *security*
- **Steps:** `createEmpty` → sessionId; `closeSession(sessionId)`; `inspect(sessionId)` after close.
- **Expected:** After `closeSession` the session is removed from the main Map (bytes + passwords released, §10 item 3 ephemeral memory); a subsequent inspect/mutate returns `{success:false, error:'session not found' / 'invalid session'}` rather than operating on freed material.
- **Notes:** Also assert the app-quit / window-close path disposes all live sessions (see risk R8 for idle eviction).

**KS-X-43 — public-only exporters leak no private material (`exportJwk` / `viewTlsCert`)** · *security*
- **Steps:** `exportJwk` on an RSA key entry and an EC key entry; `viewTlsCert {host:'example.com', port:443}`.
- **Expected:** `exportJwk` returns a **public** JWK only — RSA has `n`/`e` but no `d`/`p`/`q`/`dp`/`dq`/`qi`; EC has `x`/`y` but no `d`. `viewTlsCert` returns the presented chain as `CertificateInfo[]` (public certs) only. Neither exposes a private key.
- **Notes:** `jose` is already a dep; assert the JWK is built from the public key, never the private.

#### Group D — Lifecycle, state, and scale (KS-X-44 … KS-X-50)

**KS-X-44 — session lifecycle + invalid sessionId handling** · *edge*
- **Steps:** `createEmpty` → S; `inspect(S)` ok; `inspect('bogus-id')`; `inspect(S)` after `closeSession(S)`.
- **Expected:** A valid sessionId works; an unknown/closed sessionId yields a clean `{success:false, error}` envelope (no throw crossing IPC, no undefined deref in main). The handler never leaks that the id was a Map key.

**KS-X-45 — dirty flag set on mutation, cleared on Save-As** · *edge*
- **Steps:** `createEmpty` → assert the chosen convention for initial dirty; `generateKeyPair` → `dirty=true` (afterMutation, §9.1:780); `renameAlias`/`deleteEntry` → dirty stays true; `saveAs` → `dirty=false`.
- **Expected:** Every mutating op sets `dirty=true` and triggers a re-inspect; `saveAs` (Model A) clears it. Read-only ops (`inspect`, `aliasDetail`, `exportCertificate`) do **NOT** set dirty.
- **Notes:** `exportCertificate` writes a file but does not dirty the in-memory keystore — assert it stays as-is.

**KS-X-46 — unsaved-changes guard on close/quit when dirty** · *edge*
- **Steps:** With `dirty=true`, attempt to close the keystore workspace tab / trigger app quit — assert a confirm guard ("You have unsaved changes") fires. Repeat with `dirty=false` → no guard.
- **Expected:** Closing/quitting a dirty session prompts before discarding (§9.7). A clean session closes silently. The guard is renderer-driven off `meta.dirty`.
- **Notes:** The guard text must have EN+TR keys (ties to KS-X-56).

**KS-X-47 — large truststore inspect stays responsive (sessionId model payoff)** · *edge*
- **Preconditions:** A generated fixture keystore with ~500+ trusted certs (cacerts-style bundle).
- **Steps:** Load it; `inspect(sessionId)` and measure the returned payload; `aliasDetail` on a handful of aliases.
- **Expected:** `inspect` returns compact `AliasSummary[]` (no PEM/bytes) so the IPC payload stays small and fast even at 500+ entries; full `CertificateInfo`/PEM are fetched lazily per alias. No base64 keystore blob crosses IPC (design notes 171, 982). No UI freeze / IPC size blowup.
- **Notes:** This is the concrete regression the sessionId model prevents versus the base64 model.

**KS-X-48 — concurrent tabs: independent sessions, store-global sessionId survives switches** · *edge*
- **Steps:** Open keystore A (SA) and keystore B (SB) in two tabs; mutate A (`generateKeyPair`) and B (`deleteEntry`) independently; switch tabs and re-inspect each.
- **Expected:** SA and SB are isolated in the main Map; a mutation on one never affects the other's meta/dirty/bytes. The Zustand store keeps the active sessionId keyed so switching tabs restores the correct session.
- **Notes:** Guards against a single-session global that would clobber on tab switch.

**KS-X-49 — pickFile reads bytes at pick time in main (no TCC EPERM) + type auto-detect** · *edge*
- **Preconditions:** Fixtures in a TCC-sensitive location (simulate ~/Downloads).
- **Steps:** `keystore:pickFile` → the native dialog returns a path; main reads bytes immediately via `fs` (certificate.handler pattern); return `{sessionId, meta, typeAutoDetected}`.
- **Expected:** Bytes are read in main **at pick time** (avoids the ~/Downloads TCC EPERM a deferred/renderer read would hit). `typeAutoDetected='PKCS12'` for `.p12`/`.pfx`, `'JKS'` for `.jks`; the user can override the detected type.
- **Notes:** Mirrors the mTLS client-cert capture-at-pick-time fix (commit `b1f4794`).

**KS-X-50 — every mutation triggers a re-inspect that refreshes meta/aliasCount** · *edge*
- **Steps:** `createEmpty` (aliasCount 0) → `generateKeyPair` (1, assert meta reflects the new alias) → `deleteEntry` (0) → `importTrustedCert` (1, entryType TRUSTED).
- **Expected:** Each mutating channel returns freshly re-inspected meta (aliasCount + `AliasSummary[]` updated) so the renderer table refreshes without a manual `inspect` call (§9.1:780).
- **Notes:** Ensures the UI table and engine state cannot drift.

#### Group E — Packaging / native / CI (KS-X-51 … KS-X-55)

**KS-X-51 — pure-TS JKS writer loads on every platform (no native binary)** · *edge*
- **Steps:** (1) Assert `jks-writer.ts` imports only `@noble/hashes` (+ node builtins), not a bundled keystore-go binary via `execFile` in the default path; (2) confirm no per-platform `extraResources` entry / no `verify-natives` dependency was added for the tool; (3) run the engine JKS-write unit test on the CI matrix (mac-arm64 / mac-x64 / win-x64 / linux).
- **Expected:** JKS write works identically on all targets with zero native/arch-specific artifacts. The tool adds **no** new native binary to sign/notarize.
- **Notes:** Contrast the rejected Option A — this test asserts we did NOT take on that packaging surface.

**KS-X-52 — `@peculiar/x509` ESM trap does not crash the packaged app at launch** · *edge*
- **Preconditions:** Production build (`npm run build`) + CI smoke gate.
- **Steps:** Build the app; run `npm run test:e2e:smoke` (launches the production main bundle); assert the BrowserWindow opens (no `ERR_REQUIRE_ESM`).
- **Expected:** If `@peculiar/x509` lacks a CJS require entry it is added to `externalizeDepsPlugin({exclude:['@peculiar/x509', …]})` so Rollup bundles it (ESM→CJS) and the packaged app launches. A regression here reproduces the v1.4.19 class.
- **Notes:** **Must be verified with the BUILT app**, not bare node — bare Node ≥22 masks `require(ESM)`. The same trap applies to any ESM-only transitive of jose/@noble/@peculiar.

**KS-X-53 — CI smoke gate does not regress with the keystore tool present** · *edge*
- **Steps:** Confirm the smoke step remains a **hard gate** (no `continue-on-error`) on mac/win/linux after the tool is added; assert the keystore engine module is reachable from the main bundle without pulling a Node-22-only builtin (e.g. `node:sqlite`) into the graph.
- **Expected:** `npm run test:e2e:smoke` still passes on all three platforms; the keystore additions do not drag an ESM-only or Node-22-builtin dependency into main that would crash launch. Smoke stays the launch-crash detector.

**KS-X-54 — `@noble/hashes` is a direct dependency (not transitive-only)** · *edge*
- **Steps:** Read `package.json` dependencies; assert `@noble/hashes` is listed directly.
- **Expected:** It appears under `dependencies` (promoted from transitive). A prune/dedupe that removes a transitive-only copy cannot break the JKS writer's SHA-1.
- **Notes:** Cheap static assertion; prevents a supply-graph regression.

**KS-X-55 — absence of the optional keystore-go binary is handled gracefully** · *edge*
- **Steps:** Ensure no keystore-go binary is bundled (the default); perform a JKS `saveAs`/`convert`.
- **Expected:** The pure-TS jks-writer path is used with **no** attempt to `execFile` a missing binary and no crash/ENOENT. If the binary were ever added as an Option-A fallback, its absence must degrade to the pure-TS path silently.
- **Notes:** Confirms Option A is "fallback only" and its absence is a no-op, not a failure.

#### Group F — i18n coverage (KS-X-56 … KS-X-59)

**KS-X-56 — every dialog/label has EN and TR keys** · *edge*
- **Steps:** Enumerate all `tools.keystore.*` label/button/dialog keys used by `KeystoreTool` + sub-dialogs (Open/Create, Add Entry, Generate Key Pair, Generate Secret Key, Import, Convert, Export, Rename, Set Entry Pw, Change Store Pw, Detail, Delete, unsaved-changes guard); assert each exists in BOTH the `en` and `tr` blocks of `src/renderer/lib/i18n.ts`.
- **Expected:** No untranslated key: for every label used in the renderer, both `en[key]` and `tr[key]` are present and non-empty. `tools.keystore.title` (the catalog label) exists in both.
- **Notes:** Follow the `mock-hint-i18n.test.ts` parity pattern.

**KS-X-57 — every §8 error message has EN and TR keys** · *edge*
- **Steps:** List the full §8 error catalogue (~30 messages, lines 722-744); assert each has a `tools.keystore.error.*` key in both blocks; assert placeholder-bearing messages (`Unsupported keystore type: {type}`, `Alias not found: {alias}`, …) keep their interpolation token in both languages.
- **Expected:** Every catalogue message is translatable in EN and TR with **matching interpolation placeholders**; the engine's thrown message maps to a key the UI can localize (or is shown verbatim where the design keeps English).
- **Notes:** Assert placeholder names are identical across en/tr so interpolation never breaks in one language.

**KS-X-58 — EN/TR key parity (symmetric difference is empty)** · *edge*
- **Steps:** Collect all `tools.keystore.*` keys in `en`; collect them in `tr`; assert `setDiff(en,tr)` and `setDiff(tr,en)` are both empty.
- **Expected:** The two language blocks have exactly the same `tools.keystore.*` key set — no key present in one and missing in the other.
- **Notes:** Structural test independent of the specific strings; the canonical i18n regression guard (there is no other automated parity check).

**KS-X-59 — dropdown option lists localized in both languages** · *edge*
- **Steps:** For each dropdown in §9.6 (type, exportFormat, keyAlgorithm, ecCurve, signatureAlg, keyUsage, aesKeySize, importFormat), assert its option **labels** resolve in en and tr; assert stable option **VALUES** stay canonical (`PKIPATH`, `P-256`, `SHA256withECDSA`, …).
- **Expected:** Every dropdown renders localized labels in EN and TR; the underlying values sent to the engine remain the canonical allow-list tokens so localization never changes wire values (which would trip the engine allow-lists / KS-X-31/34).
- **Notes:** Guards against translating an enum VALUE (which would break the engine) instead of its display label.

#### Group G — Phase-5 bridge (KS-X-60)

**KS-X-60 — Send and Run resolve the same alias-backed PEM (mTLS parity); WSSE gets PEM not sessionId** · *security*
- **Preconditions:** A `certificates` row with `source='keystore'`, `keystore_id` + `keystore_alias` set (Phase-5 schema).
- **Steps:** (1) Configure an mTLS request whose client cert is an alias-backed keystore entry; (2) resolve via `request.handler#loadCertificatesFor` (Send path) and via `runner.handler` (Run path); (3) resolve the same alias for a WSSE `SignConfig`.
- **Expected:** Both Send and Run call the single shared `resolveKeystoreAlias` and get **identical** `{certPem, keyPem, chainPem}` (closing the Send≡Run mTLS gap). TLS gets `Buffer.from(pem)`; WSSE `SignConfig` receives **PEM strings**, never a sessionId or raw keystore bytes. The private-key PEM is produced in main and handed to the TLS/WSSE engine in-process — it never transits the renderer.
- **Notes:** Ties the tool to its consumers; asserts the canonical-PEM resolver is the one source and that `tests/main/handlers/helpers.ts` SCHEMA_SQL mirrors the three new `certificates` columns so handler INSERTs don't silently fail.

---

## 9. Open Questions

1. **`@peculiar/x509` CJS entry.** Does it expose a CJS `require` entry, or must it (and possibly its whole `@peculiar/*` / `pvtsutils` subtree) be added to `externalizeDepsPlugin({exclude})` to avoid `ERR_REQUIRE_ESM` at launch? **Verify against the built app before committing to EC in Faz 2.** Also confirm `x509.cryptoProvider.set(webcrypto)` is wired at engine init.
2. **Multi-alias JKS → single PKCS12.** node-forge natively bundles one key + chain; multi-key needs a manual ASN.1 SafeContents merge (or one `.p12` per alias). Apinizer's `convert` preserves all entries — **how much manual ASN.1 assembly is acceptable versus per-alias files?** (Blocker R2 — decide in Faz 0.)
3. **Session TTL.** Should the `Map<sessionId,session>` in main have idle-eviction/TTL and a max-open cap, or rely solely on explicit `keystore:closeSession` + app quit? There is no GC signal from a closed renderer tab (risk R8).
4. **Phase-5 passphrase modeling.** A keystore has BOTH a store password and a per-alias key password; the `certificates` table has one `passphrase` column. Confirm *store-password-on-a-future-keystores-row* vs *both-on-the-cert-row* before implementing Model C (risk R11).
5. **JKS writer byte-compatibility for EC keys.** Is the pure-TS Option-C writer byte-compatible with keytool for EC keys (the key protector expects PKCS8)? **Gate Faz 0 on the real `keytool -list` interop test**; fall back to Option A only if unresolvable (risk R9).
6. **Extras placement.** Should the live-TLS cert view and JWK export ship inside Faz 4 (bundled) or as a small Faz 4.5, given they are beyond-Apinizer scope?
7. **secp256k1.** §4.8 lists it as an allowed keygen curve while the scope section defers it. Confirm which wins: accept it (requires `@noble/curves`) or reject it with `Unsupported EC curve: secp256k1`. Test cases KS-F2-10, KS-X-07 and KS-X-31 must be reconciled to the chosen answer.
8. **`resolveType('')` vs `@NotBlank` on type.** §6.1 defaults empty/null → JKS, but a `@NotBlank`-style boundary check on `createEmpty` would reject it. Confirm which the port implements (affects KS-F1-07).
9. **PKCS12 read cipher.** Confirm the PBES2/AES-256 read path (node-forge vs `node:crypto`) and add OpenSSL-3 `-export` (AES) plus `-legacy` fixtures to the KAT set, so modern real-world `.p12` files open (related to risk R6).
10. **Runner cert-attach behavior change.** Confirm the release-note wording and whether the Runner should attach file-based client certs unconditionally or behind an opt-in for one release (risk R5).
11. **CI JDK pinning.** Confirm adoption of `actions/setup-java` (Temurin) in the quality job plus committed byte-KAT vectors, making the keytool/openssl interop tests **mandatory (fail, not skip) under `CI`** (blocker R1).

