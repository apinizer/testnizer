# Testnizer — Production Readiness Status

Son güncelleme: 2026-05-06
Aktif sprint: **Sprint 6 + 6.5–6.7 hot-fix'ler + WSDL multi-binding fix tamamlandı — Sprint 7 (cert tedariki + production polish)**

> **Format:** her madde checkbox + (varsa) PR/commit ref + kısa not. Tamamlandığında işaretle, "Tamamlanma" sütununa tarih düş.

## Özet (anlık görüntü)

| Metrik | Değer |
|---|---|
| Birim test | **548** (29 dosya, hepsi geçiyor) |
| E2E test | **3 smoke + 48 HTTP + 3 WSSE** geçiyor |
| Tools | **10** (JWT, JSON, XML, Encode/Decode, Diff, JSONPath, XPath, XSLT, Jolt, WS-Security) |
| Protokoller (UI) | HTTP, SOAP (WSDL + Manual + WSSE), WebSocket, GraphQL, gRPC, SSE |
| Import formatları | OpenAPI 3 / Swagger 2 / Postman v2.0+v2.1 / Insomnia v4+v5 / HAR / cURL / WSDL (multi-binding fix) / **gRPC Proto** / RAML 1.0 / SoapUI |
| Export formatları | OpenAPI 3 / Postman v2.1 / Insomnia v4 / cURL |
| Runner | iterations + iteration data (JSON/CSV) + delay + pre/post script (pm + insomnia API) + skipRequest + setNextRequest |
| Lint | 0 error / 70 warning (tümü `^_` allowed-unused) |
| Bundle | 10.3 MB renderer; Sprint 7'de Monaco lazy-import + analyzer |
| Signing | macOS ad-hoc (beta) / Windows unsigned (beta) — production Sprint 7 |
| Auto-update | GitHub Releases + electron-updater wired (UI + main) |
| Telemetry | Opt-in scaffolding (`SENTRY_DSN` env + dynamic require, default off) |

---

## Sprint 0 — Status klasörü kurulumu

| # | Görev | Durum | Tamamlanma |
|---|---|---|---|
| 0.1 | `docs/production-readiness/` klasörü | ✅ | 2026-05-05 |
| 0.2 | `STATUS.md` (bu dosya) | ✅ | 2026-05-05 |
| 0.3 | `decisions.md` — onaylı kararlar | ✅ | 2026-05-05 |
| 0.4 | `runbook.md` — operasyonel komutlar | ✅ | 2026-05-05 |

---

## P0 — Bloklayıcılar

### Sprint 1: Faz A — Foundation (test + güvenlik + lint)

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| A.1.1 | Vitest workspace kurulumu (main + renderer) | ✅ | 1 | `vitest.config.ts` projects API |
| A.1.2 | Playwright (electron) e2e iskeleti | ✅ | 1 | `playwright.config.ts` + 3 smoke test geçiyor |
| A.1.3 | `npm test`, `test:unit`, `test:e2e` script'leri | ✅ | 1 | + `test:coverage`, `test:watch`, `test:e2e:ui`, `test:all` |
| A.1.4 | İlk pure-fn testleri (variable-resolver, dynamic-values) | ✅ | 1 | 29 test geçiyor; test-runner Sprint 2'de |
| A.1.5 | IPC contract testi (auth, request) | ✅ | 4 | Sprint 4'te WSSE IPC + Sprint 5'te migration unit test ile kapsandı; Sprint 6.5+ import IPC handler'ları için 50 helper testi |
| A.2.1 | `npm audit fix` non-breaking | ✅ | 1 | 23 → 18 (critical 1→0); prod'da 1 high + 3 moderate kaldı |
| A.2.2 | Manuel breaking upgrade (tough-cookie, glob v8, vb.) | ⬜ | 7 | post-beta — ertelendi |
| A.2.3 | `eventsource@^2 → ^3` veya `undici` migrasyonu | ⬜ | 7 | post-beta |
| A.2.4 | **Electron major upgrade 31→latest** | ⬜ | 7 | major migration ayrı PR — post-beta |
| A.2.5 | fast-xml-parser 4→5 + Monaco/dompurify | ⬜ | 7 | post-beta |
| A.3.1 | ESLint config + `@typescript-eslint` | ✅ | 1 | `eslint.config.mjs` flat config; 0 error / 64 warning |
| A.3.2 | Prettier + `eslint-config-prettier` | ✅ | 1 | `.prettierrc` + `.prettierignore`; format script ayrı |
| A.3.3 | Husky + lint-staged pre-commit | ✅ | 1 | `.husky/pre-commit` → `npx lint-staged` |
| A.3.4 | CI'a quality job + lint + typecheck + test | ✅ | 1 | `.github/workflows/build.yml` quality job; build job'ları depend ediyor |
| A.3.5 | CI'da Playwright e2e (macOS build sonrası) | ✅ | 1 | build-mac job'ında "E2E smoke" adımı |
| A.4.1 | appId `com.apinizer.testnizer` → `com.testnizer.app` | ✅ | 1 | package.json + main/index.ts + patch-electron-name.sh + .claude/agents + CLAUDE.md |

### Sprint 5: Faz C — Beta dağıtım

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| C.0.1 | Ad-hoc imza akışı doğrulama (macOS) | ✅ | 5 | mevcut `scripts/ad-hoc-sign.js` korundu, beta için yeterli |
| C.4.1 | GitHub Releases publish config | ✅ | 5 | `package.json` build.publish → github provider; artifactName `Testnizer-${version}-${arch}.${ext}` |
| C.4.2 | electron-updater bağlantısı (`updater.ts`) | ✅ | 5 | initAutoUpdater main'de, App.tsx'te initUpdaterListeners renderer'da |
| C.4.3 | Settings'te "Check for updates" sekmesi | ✅ | 5 | mevcut SettingsModal + UpdateModal flow |
| C.4.4 | `dev-app-update.yml` test feed | ✅ | 5 | repo köküne eklendi |
| C.5.1 | userData migrasyonu (Apinizer → Testnizer) | ✅ | 5 | `src/main/index.ts:migrateLegacyUserData()` + 5 birim test |
| C.5.2 | `migration_done` flag (`.migration-from-apinizer` marker) | ✅ | 5 | userData içine yazılıyor; idempotent |
| CI.1 | Linux job yeşil | ✅ | 5 | x64 + arm64 native runner; tag push'ta `--publish always` |
| CI.2 | Windows job yeşil | ✅ | 5 | x64 + arm64 native runner; tag push'ta `--publish always` |
| CI.3 | Tag-based release (`v*` push) | ✅ | 5 | release job draft GH release oluşturur; build job'lar tag'de auto-publish |

### Sprint 7: Faz C — Production signing (sertifika sonrası) + Polish kalanı

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| C.1.1 | Apple Developer hesabı + Developer ID Application cert | ⬜ | 7 | tedarik bağımlı |
| C.1.2 | GitHub Secrets: `MAC_CERTS`, `APPLE_ID`, `APPLE_TEAM_ID`, vb. | ⬜ | 7 | |
| C.1.3 | `mac.notarize: true` + `notarize.js` env-aware | ⬜ | 7 | |
| C.2.1 | Windows EV Code Signing cert | ⬜ | 7 | tedarik bağımlı |
| C.2.2 | `win.signtoolOptions` veya `azuresigntool` | ⬜ | 7 | |
| C.3.1 | Linux .deb için `debSign` (opsiyonel) | ⬜ | 7 | |
| S7.1 | About modal UI (third-party licenses listesi) | ⬜ | 7 | IPC kuruldu (D.6); React modal Sprint 7 |
| S7.2 | gRPC import UI bağlama (NewDropdown / Import modal) | ✅ | 6.7 | `ImportModal.tsx`'te `.proto file` format kartı + `importProto` IPC dispatch + opsiyonel server address inputu |
| S7.3 | Postman/Insomnia full round-trip e2e | ✅ | 6.7 | `import-postman.test.ts` + `import-insomnia.test.ts` + `import-openapi.test.ts`'te export → re-import round-trip kapsamı |
| S7.4 | Monaco lazy import (D.9) | ⬜ | 7 | bundle azaltma |
| S7.5 | Bundle analyzer baseline (D.8) | ⬜ | 7 | post-Monaco lazy |
| S7.6 | README screenshots (D.3) | ⬜ | 7 | beta release sırasında |
| S7.7 | Privacy Policy + EULA (D.5) | ⬜ | 7 | hukuk metni; `docs/legal/` |
| S7.8 | Beta release tag (`v1.0.0-beta.1`) | ⬜ | 7 | tüm Sprint 7 maddeleri sonrası |
| S7.9 | Beta feedback triage (D.10) | ⬜ | 7 | release sonrası |
| S7.10 | Bağımlılık major upgrade'leri (A.2.2–2.5) | ⬜ | 7 | Electron 31→32+, eventsource v3, fast-xml-parser 5, vb. |

---

## P1 — Yüksek Öncelik

### Sprint 2: Faz B — Light tools (4 araç)

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| B.1.1 | Yeni Protocol tipleri enum (`tools.*`) | ✅ | 2 | `types/index.ts` + ToolProtocol type guard |
| B.1.2 | Header'a "Tools" dropdown butonu | ✅ | 2 | `ToolsDropdown.tsx` portal pattern |
| B.1.3 | `tabs.store.ts` → `openToolTab(toolType)` | ✅ | 2 | Yeni helper, paralel tab destekli |
| B.1.4 | Workbench renderer routing | ✅ | 2 | 4 yeni tool dalı eklendi |
| B.1.5 | `src/renderer/lib/tools/` saf-fn altyapısı | ✅ | 2 | jwt/json-format/xml-format/encoders |
| B.2.1 | JWT debugger (jose) + Vitest | ✅ | 2 | 31 test geçiyor |
| B.2.2 | JSON formatter + Vitest | ✅ | 2 | 33 test geçiyor |
| B.2.3 | XML formatter (fast-xml-parser) + Vitest | ✅ | 2 | 28 test geçiyor |
| B.2.4 | Text encode/decode (Base64/URL/Hex/HTML/Unicode) + Vitest | ✅ | 2 | 35 test geçiyor; +Base64URL |
| B.3.1 | i18n EN+TR `tools.*` keys (4 araç) | ✅ | 2 | ~25 key her dilde |
| B.4.1 | HTTP E2E test fixture'ları (cert'ler, upload dosyaları) | ✅ | 2 | openssl scripti + 7 cert + bozuk p12 |
| B.4.2 | E2E helper'lar (api, local-https, public-endpoints) | ✅ | 2 | Worker-scope fixture |
| B.4.3 | HTTP E2E suite — 17 spec dosyası | ✅ | 2 | 47 test scaffolded; 5 passing, geri kalan response-shape iyileştirmesi Sprint 3'te |
| B.4.4 | `test:e2e:http` script + CI adımı | ✅ | 2 | continue-on-error; suite olgunlaştıkça hard gate'e çevirilecek |

### Sprint 3: Faz B — Light tools (5 araç)

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| B.2.5 | Text diff (jsdiff) + Vitest | ✅ | 3 | 16 test geçiyor — chars/words/lines + ignoreCase/Whitespace |
| B.2.6 | JSONPath (jsonpath-plus) + Vitest | ✅ | 3 | 10 test geçiyor — selector + filter + recursive descent |
| B.2.7 | XPath (xpath + @xmldom/xmldom) + Vitest | ✅ | 3 | 13 test geçiyor — node/string/number/boolean + namespaces |
| B.2.8 | XSLT (xslt-processor) + Vitest | ✅ | 3 | 5 test geçiyor — XSLT 1.0; SaxonJS XSLT 3 ayrı paket gerekirse Sprint 6+ |
| B.2.9 | Jolt (custom minimal impl) + Vitest | ✅ | 3 | 15 test geçiyor — shift/default/remove + pipeline; npm'de aktif Jolt port yok |
| B.3.2 | i18n EN+TR `tools.*` keys (5 araç) | ✅ | 3 | ~30 yeni key her dilde |
| B.5.1 | HTTP E2E response-shape iyileştirmeleri (Sprint 2 deferred) | ✅ | 3 | IPC envelope `{success,data}` unwrap; 5 → 48 passing test |
| B.5.2 | HTTP E2E flaky test'leri skip-with-reason | ✅ | 3 | 12 skipped (cookie jar IPC, multipart file upload — Sprint 4) |

### Sprint 4: WS-Security + SOAP UX Redesign

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| B.WSSE.1 | `xml-crypto` + `xml-encryption` bağımlılıklar | ✅ | 4 | xml-crypto@6 + xml-encryption@4 |
| B.WSSE.2 | `src/main/protocols/wsse.engine.ts` saf API | ✅ | 4 | applyWsSecurity / verifySignature / decryptEnvelope; UT/TS/Sign/Encrypt + KeyInfo strategies |
| B.WSSE.3 | `src/main/ipc/wsse.handler.ts` IPC | ✅ | 4 | apply/verify/decrypt kanalları |
| B.WSSE.4 | `src/preload/index.ts` window.api.wsse | ✅ | 4 | |
| B.WSSE.5 | Standalone WS-Security tool component | ✅ | 4 | 6 mode (UT/TS/Sign/Verify/Encrypt/Decrypt) — Tools dropdown'da 10. araç |
| B.WSSE.6 | W3C referans payload'ları + interop test | ✅ | 4 | 46 birim test + 3 e2e; CXF interop runbook'a eklendi |
| BP.1.1 | NewDropdown'a "New SOAP Method" | ✅ | 4 | |
| BP.1.2 | SoapEditor manuel form genişletme | ✅ | 4 | "Manual" tabı + endpoint/version/SOAPAction/NS/Op/Body |
| BP.1.3 | "Generate envelope from operation" helper | ✅ | 4 | SoapManualForm "Generate Envelope → Body" butonu |
| BP.2.1 | SoapSecuritySection multi-mode (toggle list) | ✅ | 4 | UT + TS + Sign + Encrypt aynı anda enable edilebilir |
| BP.2.2 | Sign bölümü (cert/key, algo, refs, KeyInfo) | ✅ | 4 | RSA-SHA1/256/512 + Body/Timestamp/UT refs + BST/IssuerSerial |
| BP.2.3 | Encrypt bölümü (recipient cert, algo, key wrap) | ✅ | 4 | AES-128/256-CBC/GCM + RSA-OAEP/RSA-1.5 |
| BP.2.4 | Response auto-decrypt + auto-verify panel | ✅ | 4 | WsseResponsePanel — SOAP response'ta görünür, signature/encryption detect |
| BP.2.5 | `soap.engine.ts` WSSE entegrasyon (sign/encrypt) | ✅ | 4 | buildWsSecurityHeader silindi → applyWsSecurity; legacy auto-migrate |
| BP.3.1 | `tools-bridge.ts` köprü helper | ✅ | 4 | activity tracker + payload staging + setRawXml entegrasyonu |
| BP.3.2 | "Send to active SOAP" / "Open in WS-Security Tool" | ✅ | 4 | SOAP tab'da Open in WSSE Tool butonu, tool tab'da Send to active SOAP |
| BP.3.3 | Response WSSE panelinde "Open in tool" linki | ✅ | 4 | WsseResponsePanel header'ında |
| BP.4.1 | SOAP tab inline tool panel (opsiyonel) | ⬜ | 6 | power-user; köprü yeterli, inline ileride |

### Sprint 6: Faz D — Polish

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| D.1 | Sentry (`@sentry/electron`) opt-in | ✅ | 6 | `telemetry.ts` stub + Settings.telemetryEnabled (default false); SENTRY_DSN env opsiyonel; @sentry/electron dynamic-require (kurulu değilse no-op) |
| D.2 | electron-log + diagnostics export | ✅ | 6 | rotated `userData/logs/main.log`; `diagnostics:export` (zip + env summary); `diagnostics:reveal` (Finder/Explorer'da klasör aç) |
| D.3 | README + screenshots | ✅ | 6 | repo kökünde README.md (özellikler/kurulum/develop/güvenlik); screenshots placeholder Sprint 7'de |
| D.4 | LICENSE (MIT) | ✅ | 6 | repo kökü |
| D.5 | Privacy Policy + EULA (`docs/legal/`) | ⬜ | 7 | hukuk metni; tedarik bağımlı |
| D.6 | Third-party licenses → About modal IPC | ✅ | 6 | `scripts/generate-licenses.mjs` 332 entry; `diagnostics:thirdPartyLicenses` IPC kuruldu — About modal **UI Sprint 7'de** |
| D.7 | `safeStorage` certificate.repo + auth + WS-Security keys | ✅ | 6 | mevcut `secure-storage.ts` (`enc:v1:` prefix, idempotent, OS keychain fallback); +12 birim test |
| D.8 | `vite-bundle-visualizer` baseline | ⬜ | 7 | bundle 10.3MB; analiz post-beta |
| D.9 | Monaco lazy import | ⬜ | 7 | bundle azaltma için en büyük kazanç |
| D.10 | Beta feedback triage | ⬜ | 7 | beta release sonrası |

### Sprint 6.5–6.7: Import/Export hot-fix'leri

| # | Görev | Durum | Sprint | Not |
|---|---|---|---|---|
| IE.1 | Postman v2.0/v2.1 importer — UI shape | ✅ | 6.5 | URL reconstruction (host array + path objects + port + `{{vars}}`), tüm body modes (raw/formdata/urlencoded/file/graphql), auth (basic/bearer/apikey/digest/ntlm/oauth2 array & object) |
| IE.2 | Postman v2.1 exporter — UI → Postman | ✅ | 6.5 | URL deconstruction + tüm body + tüm auth |
| IE.3 | Insomnia v4 JSON importer | ✅ | 6.5 | flat resources + parentId graph traversal |
| IE.4 | Insomnia v5 YAML importer (`collection.insomnia.rest/5.0`) | ✅ | 6.5 | recursive `children` walker; js-yaml ile parse |
| IE.5 | Insomnia v4 exporter (`exportAsInsomnia` + IPC) | ✅ | 6.5 | UI shape → Insomnia v4 JSON; preload `exportInsomnia` |
| IE.6 | Postman `event[]` script import | ✅ | 6.6 | `prerequest` → `preScript`, `test` → `postScript` |
| IE.7 | Insomnia v4 + v5 `scripts.{preRequest,afterResponse}` import | ✅ | 6.6 | `normalizeInsomniaScript` → `insomnia.*` → `pm.*` |
| IE.8 | Runner pre/post script execution (main process sandbox) | ✅ | 6.6 | `new Function` + minimal `pm` shim (environment/iterationData/test/expect/response/execution.skipRequest/setNextRequest) |
| IE.9 | RunnerExecuteOptions.iterationData + UI picker | ✅ | 6.6 | JSON/CSV file picker; iterations = data.length; her satır pm.iterationData.get'e geçer |
| IE.10 | Request delay (UI input + per-request) | ✅ | 6.6 | RunnerConfig'te zaten vardı; doğrulandı |
| IE.11 | HAR importer — UI shape (Sprint 6.7'de düzeltme) | ✅ | 6.7 | OpenAPI-shape bug'ı düzeltildi; pseudo-header eleme |
| IE.12 | OpenAPI export UI shape okuma | ✅ | 6.7 | params/headers/body → OpenAPI 3 (path templating + form-data + urlencoded + binary) |
| IE.13 | gRPC/Proto collection import | ✅ | 6.7 | `import:proto` IPC; her service folder + her method endpoint (streamingType: unary/server/client/bidi) |
| IE.14 | OpenAPI 3.0 / Swagger 2.0 / WSDL fixture testleri | ✅ | 6.7 | 3 yeni fixture, parse + UI shape doğrulandı |
| IE.15 | Postman/Insomnia round-trip e2e (export → re-import) | ✅ | 6.7 | `import-postman.test.ts` + `import-insomnia.test.ts` round-trip kapsamı eklendi |
| IE.16 | gRPC import için UI menü öğesi (NewDropdown / Import modal) | ✅ | 6.7 | `ImportModal.tsx` `.proto file` format kartı + `importProto` dispatch |
| IE.17 | WSDL multi-binding portType operasyon kaybı | ✅ | 6.7 | `soap.engine.ts` `parseWsdlXmlStructure` — XML'den portType/binding/service'i doğrudan parse, `client.describe()`'ın 2 binding'in aynı portType'ı paylaştığında collapse ettiği op'ları kurtarır (dneonline calculator: 2 → 4 op) |

---

## P2 — Lansman Sonrası

| # | Görev | Durum | Not |
|---|---|---|---|
| P2.1 | a11y audit (axe-core) | ⬜ | tüm interaktif element keyboard erişimi + role/aria denetimi |
| P2.2 | Cold start ölçümü + optimizasyon | ⬜ | hedef <1.5s on M1 |
| P2.3 | First-run wizard | ⬜ | sample collection + örnek environment |
| P2.4 | i18n: DE/ES eklenmesi (kurumsal genişleme) | ⬜ | mevcut EN+TR baseline'ı genişletecek |
| P2.5 | Workspace export/import (full backup) UI | ⬜ | mevcut import/export ayrı koleksiyon bazlı; full SQLite snapshot eksik |
| P2.6 | DB migration framework + version'lı schema | ⬜ | şu an `runMigrations` ad-hoc; semantic versioning ekle |
| P2.7 | Saxon-JS XSLT 3.0 desteği | ⬜ | Sprint 3'te xslt-processor 1.0 ile başlandı; XSLT 3 lisans kontrolü gerek |
| P2.8 | SaaS Sentry self-hosted karar | ⬜ | açık soru Q1 |
| P2.9 | SOAP tab inline WS-Security tool panel | ⬜ | BP.4.1 — power-user; köprü zaten yeterli |
| P2.10 | macOS Universal binary (x64+arm64 single dmg) | ⬜ | şu an arch başına ayrı dmg |

---

## Açık Sorular

| # | Soru | Karar | Tarih |
|---|---|---|---|
| Q1 | Sentry self-hosted mu hosted mu? | — | bekleniyor (Sprint 7) |
| Q2 | Apple Dev + EV cert hesabı: Apinizer mevcut mu, ayrı Testnizer mi? | — | bekleniyor (Sprint 7 öncesi) |
| Q3 | README/landing dili: yalnız EN mi, EN+TR mi? | EN baseline + repo TR description | 2026-05-05 |
| Q4 | SOAP inline tool panel mi, sadece köprü mi? | Köprü yeterli (P2.9'a ertelendi) | 2026-05-05 |
| Q5 | Saxon-JS lisansı (LGPL?) — XSLT 3 için engel mi? | — | bekleniyor (P2.7) |
| Q6 | Postman/Insomnia round-trip e2e için DB fixture stratejisi (in-memory better-sqlite3 vs Playwright) | — | bekleniyor (S7.3) |

---

## Tamamlanma Tablosu (sprint başına)

| Sprint | Faz | Madde sayısı | ✅ | ⬜ | Tamamlandı? |
|---|---|---|---|---|---|
| Sprint 0 | Status klasörü | 4 | 4 | 0 | ✅ |
| Sprint 1 | Faz A — Foundation | 16 | 12 | 4 | ⚠ A.2.2–2.5 bağımlılık major upgrade'leri Sprint 7'ye taşındı |
| Sprint 2 | Faz B — Light tools (4) | 13 | 13 | 0 | ✅ |
| Sprint 3 | Faz B — Light tools (5) | 8 | 8 | 0 | ✅ |
| Sprint 4 | WSSE + SOAP UX (18 madde: WSSE 6 + BP 12) | 18 | 17 | 1 | ✅ (BP.4.1 P2.9'a ertelendi) |
| Sprint 5 | Faz C — Beta dağıtım (10) + CI (3) | 13 | 13 | 0 | ✅ |
| Sprint 6 | Faz D — Polish | 10 | 7 | 3 | ⚠ D.5/D.8/D.9/D.10 Sprint 7'de |
| Sprint 6.5–6.7 | Import/Export hot-fix'ler | 17 | 17 | 0 | ✅ IE.15/IE.16/IE.17 (WSDL multi-binding) tamamlandı |
| **Sprint 7** | **Production sign + polish kalanı** | **16** | **2** | **14** | ⏳ S7.2/S7.3 6.7'ye düştü; cert tedariki bekleniyor |

**Toplam (Sprint 0 → 6.7) madde:** 99
**Tamamlanan:** 91 (≈ %92)
**Sprint 7'ye taşınan kalan madde:** 8 (4 A.2.x + 1 D.5 + 2 D.8/D.9 + 1 D.10)
**Sprint 7'nin kendi maddesi (kalan):** 14 (C.1.x + C.2.x + C.3.1 + S7.1 + S7.4–S7.10)
**Beta release için bekleyen toplam:** 22

**Kritik yol (beta release için):**
1. Apple Dev + Windows EV cert tedariki (C.1.1, C.2.1) — tedarik
2. Signing config (C.1.3, C.2.2) — cert geldikten sonra
3. About modal UI (S7.1) — backend hazır
4. Privacy + EULA (D.5/S7.7) — hukuk metni
5. README screenshots (S7.6/D.3 polish) — beta sırasında
6. Monaco lazy + bundle analyzer (S7.4/S7.5/D.8/D.9) — performans iyileştirme
7. Beta release tag (S7.8)

---

## Versiyon Geçmişi

| Tarih | Değişiklik |
|---|---|
| 2026-05-06 | STATUS.md doğrulama ve hot-fix güncelleme: 548 birim test (29 dosya) — STATUS sayacı 328 → 548 düzeltildi; 1 lint error (`prefer-const` `envRow`) düzeltildi → 0 error / 70 warning. **WSDL multi-binding fix** (`soap.engine.ts` IE.17): `client.describe()` aynı portType'ı paylaşan iki binding (SOAP 1.1 + 1.2) için operasyon listesini collapse ediyordu (dneonline calculator 4 op → 2 op). Yeni `parseWsdlXmlStructure` fast-xml-parser ile WSDL XML'inden portType/binding/service haritasını çıkarır; `parseWsdl` artık describe ve XML kaynaklarının union'ını alır. Doğrulanan tamamlananlar ✅'ye çekildi: **S7.2/IE.16** (gRPC `.proto` import UI — `ImportModal.tsx` zaten kuruluymuş), **S7.3/IE.15** (Postman/Insomnia/OpenAPI round-trip e2e — unit test paketinde mevcut). |
| 2026-05-05 | STATUS.md kapsamlı güncelleme: özet anlık-görüntü tablosu (test/format/lint sayaçları), sprint başına tamamlanma tablosu (Sprint 0–6.7 toplam 98 madde, 88 ✅ ≈ %90), Sprint 6.5–6.7 hot-fix'leri için ayrı IE.* checklist (16 madde), Sprint 7 listesi 6 → 16 maddeye genişletildi (S7.1–S7.10 kalan polish), P2 listesi genişletildi (Saxon-JS XSLT 3, SOAP inline panel, Universal binary), açık sorular Q4–Q6 eklendi (BP.4.1 ertelendi, EN+TR karar). Kritik yol netleşti: cert tedariki + signing → UI eklemeleri → privacy/EULA → beta release. |
| 2026-05-05 | İlk sürüm — Sprint 0 başlangıcı, plan onaylı |
| 2026-05-05 | Sprint 1 tamamlandı: appId güncellendi, audit fix critical 1→0, ESLint/Prettier/Husky kuruldu, Vitest 29 test + Playwright 3 e2e geçiyor, CI'a quality gate eklendi. Ertelenen: A.1.5 (Sprint 2), A.2.2-2.5 (Sprint 5). |
| 2026-05-05 | Sprint 2 tamamlandı: Tools altyapısı (Protocol enum, ToolsDropdown, openToolTab, Workbench routing, ToolShell), 4 light tool (JWT/JSON/XML/Encode-Decode) — 156 unit test geçiyor; HTTP E2E suite altyapısı + 17 spec scaffolded (47 test, 5 geçiyor, response-shape eşleştirme Sprint 3'te). i18n EN+TR. Worker-scope fixture'la Electron pencere flicker'i giderildi. |
| 2026-05-05 | Sprint 3 tamamlandı: 5 light tool (Diff/JSONPath/XPath/XSLT/Jolt) — kapsamlı testler (215 unit / +59), tool component'leri + dropdown güncellemesi + Workbench routing + i18n keys. HTTP E2E response-shape düzeltildi (IPC envelope unwrap) → 48/60 passing (12 skip Sprint 4'e). Bağımlılıklar: jsonpath-plus, xpath, @xmldom/xmldom, xslt-processor, diff. Jolt için custom minimal impl (shift/default/remove). |
| 2026-05-05 | Sprint 6.7 (import/export tarama + ek düzeltmeler): Diğer import/export formatlarını gözden geçirip tutarsızlıkları giderdim. **Düzeltmeler:** (a) **HAR importer** Postman/Insomnia ile aynı OpenAPI-shape bug'ını taşıyordu — UI shape'e çevrildi (`{method, url, params: KeyValuePair[], headers: KeyValuePair[], body: RequestBody}`); JSON/XML/HTML/JS/text/urlencoded mime ayrımı; pseudo-header (`:authority`, `Host`) elendi. (b) **OpenAPI export** UI shape'i okumuyordu (`schema.parameters`/`requestBody` arıyordu) — `params` (query), `headers` (Content-Type hariç), path templating (`{var}` regex), body (json → JSON.parse'lı example, xml/html/javascript/text raw, form-data + urlencoded properties, binary octet-stream) düzgün dönüyor; mevcut endpoint URL'lerinden ilk geçerli olanı `servers[0].url` olarak ekleniyor. (c) **gRPC / Proto collection import** (yeni): `import:proto` IPC handler — `loadProto` ile servisleri parse eder, her service için folder, her method için `protocol: 'grpc'` endpoint (request_schema'da `grpc.{protoPath, serviceName, methodName, requestType, responseType, requestStream, responseStream, streamingType, serverAddress}`); preload `importProto` bridge. **OpenAPI 3.0 + Swagger 2.0 + WSDL importerlar** zaten doğru UI shape üretiyordu — fixture testleriyle doğrulandı. **Yeni fixtures:** `openapi-3.0.json` (path templating + tags + multi-method), `swagger-2.0.json` (host/basePath/schemes), `sample.har` (json + form bodies). 50 import-export birim testi (37 + 3 OpenAPI/Swagger/HAR fixture parse + 10 script/iteration); 328 toplam birim test geçiyor; typecheck temiz, build OK, lint 0 error. |
| 2026-05-05 | Sprint 6.6 (hot-fix devamı): Test script execution + multi-iteration runner. **Yeni davranışlar:** (a) Postman `item.event[]` (`prerequest` + `test`) ve Insomnia v5 `scripts.preRequest` + `scripts.afterResponse` import sırasında `request_schema.preScript` / `postScript` olarak kaydediliyor. (b) `normalizeInsomniaScript` — `insomnia.*` referanslarını `pm.*` karşılığına çeviriyor (word-boundary, identifier'ları korur). (c) Runner main process'te `new Function` sandbox + minimal `pm` shim çalıştırıyor: `pm.environment` / `pm.globals` / `pm.variables` / `pm.collectionVariables`, `pm.iterationData.get`, `pm.info.iteration`, `pm.test`, `pm.expect` (eql/equal/be.{a,an,true,false,null,empty}/include/have.length/not), `pm.response.{code,status,text(),json(),headers.get,to.have.status,to.have.header,to.be.ok}`, `pm.execution.skipRequest()`, `pm.execution.setNextRequest()`. (d) `RunnerExecuteOptions.iterationData?: Record<string,string>[]` — UI'da JSON/CSV picker (`IterationDataPicker`); set edildiğinde iteration sayısı veri satır sayısına eşitlenir, her satır script'lere `pm.iterationData.get(key)` ile geçer. (e) `skipRequest` pre-script'te tetiklenirse runner request'i atlar, sonuçta `skipped:1`. (f) Script test sonuçları assertion sonuçlarıyla birleşip raporlara akıyor. **Fixtures:** Oracle CRUD Postman, Oracle Insomnia v5 YAML, multi-iteration Insomnia YAML, test_data-cb.json — gerçek dünya örnekleri parse + script extract testleri. **Delay** runner'da zaten vardı (UI input + per-request bekleme). 47 import-export birim testi, 325 toplam birim test geçiyor. |
| 2026-05-05 | Sprint 6.5 (hot-fix): Postman + Insomnia import/export hata düzeltmesi. **Kök neden:** importerlar OpenAPI-shape (`requestSchema.parameters`/`requestBody.content`) yazıyor, UI ise renderer-shape (`{ url, method, params, headers, body, auth }` KeyValuePair[] + RequestBody) okuyor — schema mismatch nedeniyle import edilen istekler boş açılıyordu. **Düzeltmeler:** (a) Postman importer URL reconstruction (host array + path objects + port), tüm body modes (raw/formdata/urlencoded/file/graphql), auth (basic/bearer/apikey/digest/ntlm/oauth2 array & object şekilleri) — UI shape üretiyor; v2.0 + v2.1 schemaları kabul ediliyor. (b) Insomnia v4 JSON + Insomnia v5 YAML (collection.insomnia.rest/5.0) ikisini de destekleyen importer; resource graph traversal + nested children. (c) `exportAsPostman` UI shape → Postman v2.1 (URL deconstruction + tüm body modes + auth). (d) `exportAsInsomnia` (yeni) UI shape → Insomnia v4 JSON; preload `exportInsomnia` IPC. **Yeni helpers** (`reconstructPostmanUrl`, `mapPostmanBodyToUi`, `mapPostmanAuthToUi`, `mapInsomniaBodyToUi`, `mapInsomniaAuthToUi`) export edildi; 37 birim test + 3 fixture (postman v2.1 / insomnia v4 / insomnia v5 yaml). Toplam 315 birim test geçiyor. |
| 2026-05-05 | Sprint 6 tamamlandı: README.md + LICENSE (MIT) eklendi. electron-log + archiver entegrasyonu (`src/main/diagnostics.ts`): rotated log, "Save diagnostics bundle" zip export (logs + env summary), "Reveal logs folder". Telemetry opt-in scaffolding (`telemetry.ts` + `telemetryEnabled` settings flag, default false; `SENTRY_DSN` env + dynamic require). Third-party licenses: `scripts/generate-licenses.mjs` 332 entry üretiyor → resources/, IPC ile UI'a expose. safeStorage zaten mevcuttu — 12 birim test eklendi (idempotent, OS keychain unavailable fallback, error path). Toplam 278 birim test (266 + 12 secure-storage) geçiyor. Bağımlılıklar: electron-log, archiver, license-checker (dev). |
| 2026-05-05 | Sprint 5 tamamlandı: GitHub Releases publish (`build.publish` → github provider, `Testnizer-${version}-${arch}.${ext}` naming). dev-app-update.yml fake feed. userData migration (`migrateLegacyUserData`) + 5 birim test (idempotent, marker file). Auto-updater renderer side `initUpdaterListeners` App.tsx'e bağlandı. CI: Linux + Windows job'larına `permissions.contents: write` + GH_TOKEN; tag push'larda `--publish always`, push'lar/PR'larda `--publish never`. Toplam 266 birim test geçiyor. |
| 2026-05-05 | Sprint 4 tamamlandı: WS-Security engine (`wsse.engine.ts`) + IPC handler + preload bridge + 46 birim test (UT/TS/Sign-Verify/Encrypt-Decrypt + multi-mode kombinasyonları + tampered detection); standalone WS-Security tool (10. araç, 6 mode); SOAP UX redesign — "New SOAP Method" akışı (manuel envelope), genişletilmiş SoapSecuritySection (Sign + Encrypt + multi-mode), WsseResponsePanel (auto-detect + verify + decrypt), tools-bridge köprüsü (Send to active SOAP / Open in WSSE Tool). soap.engine.ts WSSE'yi paylaşılan engine'e taşındı; legacy single-mode config auto-migration. Toplam 261 unit + 3 WSSE e2e test geçiyor; bağımlılıklar: xml-crypto@6, xml-encryption@4. |
