# Testnizer UI E2E — Tam Kapsam Matrisi

Güncelleme: 2026-06-07 | **663 UI E2E testi (154 spec)** — 238 legacy (27 spec) + **362 tur1** (111 spec) + **63 journey flow** (16 tier spec, `tests/e2e/ui/flows/`). Suite `--workers=4` paralel koşuma stabilize edildi (worker başına izole Electron + SQLite, mock port bantları, pano mutex'i, `ensureCanonicalProject` guard'ı). MST kapsamı: **255/292** (`ext/tur1/yapilacak-testler.txt`); kalan 37'nin 36'sı bilinçli ertelenen P2, 1'i vitest (MST-282).

## Altyapı

| Bileşen | Dosya | Durum |
|---|---|---|
| Yerel HTTP echo (httpbin uyumlu) | `tests/e2e/servers/http-echo.ts` | ✅ |
| WebSocket echo | `tests/e2e/servers/ws-echo.ts` | ✅ |
| SSE stream | `tests/e2e/servers/sse-server.ts` | ✅ |
| Socket.IO echo | `tests/e2e/servers/socketio-server.ts` | ✅ |
| GraphQL | `tests/e2e/servers/graphql-server.ts` | ✅ |
| gRPC unary | `tests/e2e/servers/grpc-server.ts` | ✅ |
| MCP stub | `tests/e2e/servers/mcp-server.ts` | ✅ |
| Fake LLM (OpenAI uyumlu) | `tests/e2e/servers/fake-llm.ts` | ✅ |
| Playwright globalSetup/Teardown | `tests/e2e/global-setup.ts` | ✅ |
| Headless Electron | `E2E_HEADLESS=1` (varsayılan) | ✅ |

## Spec dosyaları

| Dosya | Kapsam |
|---|---|
| `00-bootstrap` | EULA, workbench, proje |
| `01-navigation` | Sidebar, footer, hub |
| `02-keyboard-shortcuts` | Tüm global kısayollar |
| `03-request-editor` | Request sekmeleri |
| `04-modals` | 8 modal aç/kapa |
| `05-command-palette` | 20 aksiyon + arama |
| `06-tools` | 20 araç listesi + palette |
| `07-protocols` | New dropdown protokoller |
| `08-panels` | Tests/Mocks/History/APIs |
| `09-http-send` | GET → 200 (yerel stub) |
| `10-response-tabs` | Body/Cookies/Headers/Results |
| `11-project-detail-tabs` | 15 sekme |
| `12-collection-runner` | Runner modal |
| `13-request-params-headers` | KV CRUD, bulk, disable |
| `14-request-auth-body` | Auth 7 tip, body, settings |
| `15-request-scripts-tests` | Scripts, assertions |
| `16-response-deep` | Response toolbar |
| `17-tree-crud` | Tree arama, folder, import |
| `18-protocols-deep` | WS/SSE/Socket.IO/GQL/gRPC/MCP |
| `19-tools-deep` | 20 araç + JWT/Hash/UUID/HTTP status |
| `20-mock-deep` | Mock create, editor tabs |
| `21-runner-deep` | Suite, runner, scheduled |
| `22-modals-deep` | Env, settings, import, save |
| `23-header-nav` | Home, branch, tabs, env selector |
| `24-crosscutting` | Tema, i18n, persistence, palette |
| `25-ai-chat` | Fake LLM send/receive |
| `inventory` | Envanter sweep |

## Ekran / işlev durumu

| Alan | Derin test | Spec |
|---|---|---|
| EULA / Login / Project bootstrap | ✅ | `00`, `bootstrap.ts` |
| Sidebar 6 sayfa | ✅ | `01`, `08`, `inventory` |
| Footer 3 kontrol | ✅ | `01`, `04` |
| URL bar Send/Save | ✅ | `03`, `09`, `inventory` |
| Request Params/Headers KV | ✅ | `13` |
| Request Auth 7 tip | ✅ | `14`, flows `tier10` (uçtan uca 200/401) |
| Request Body/Settings | ✅ | `14` |
| Request Scripts/Tests | ✅ | `15` |
| Response pane toolbar | ✅ | `16`, flows `tier12` (filtre/kopyala) |
| Hata & kurtarma (refused/500/404/iptal/cookie) | ✅ | flows `tier8` |
| Response tabs | ✅ | `10` |
| Tree CRUD | 🟡 | `17` (folder add, import) |
| 11 protokol editörü | ✅ | `07`, `18`, `25` |
| 20 Tools işlevsel | ✅ | `06`, `19` |
| Mock servers | 🟡 | `20` |
| Runner / suite | ✅ | `21`, `12`, flows `tier4` (değişken zinciri) + `tier11` (iterasyon) |
| Modals derin | ✅ | `04`, `22` |
| Project detail 15 tab | ✅ | `11` |
| Header / branch / tabs | ✅ | `23` |
| Cross-cutting | ✅ | `24` |

**Durum:** ✅ Tam · 🟡 Kısmi (CRUD/run akışının bir kısmı)

## Kullanıcı yolculuğu (journey) flow'ları

Uçtan uca, çok adımlı gerçek kullanıcı senaryoları. Her flow `tests/e2e/ui/flows/tierN-*.spec.ts` altında, yerel `http-echo` (ve protokol sunucuları) üzerinde gerçek IPC + main process yolunu sürer. Toplam **47 flow (F1–F47)**.

| Tier | Dosya | Flow | Kapsam |
|---|---|---|---|
| 1 | `tier1-core` | F1–F4 | Çekirdek istek gönder/kaydet/tab yaşam döngüsü |
| 2 | `tier2-body-auth` | F5–F7 | Body tipleri + temel auth UI |
| 3 | `tier3-env` | F8–F10 | Environment değişken çözümleme (`{{var}}`) |
| 4 | `tier4-runner-suite` | F11–F13 | Suite çalıştırma + runner değişken zinciri (`pm.environment.set` → sonraki istek) + JSONPath/equals-JSON assertion |
| 5 | `tier5-tree-import` | F14–F16 | Tree CRUD + koleksiyon import |
| 6 | `tier6-protocols` | F17–F23 | WS/SSE/Socket.IO/GraphQL/gRPC/MCP gerçek bağlantı |
| 7 | `tier7-rest` | F24–F29 | REST derinliği: status, header/JSONPath assertion, redirect, compression |
| 8 | `tier8-error-recovery` | F30–F34 | Connection refused, 500→200 kurtarma, 404, in-flight iptal, cookie kalıcılığı |
| 9 | `tier9-tab-save` | F35–F38 | Dirty göstergesi, tab kapat/yeniden aç, preview→pinned, klasöre Save As |
| 10 | `tier10-auth` | F39–F42 | Uçtan uca auth: Bearer, Basic, API key (header + query) — 200/401 doğrulama |
| 11 | `tier11-runner-env-schedule` | F43–F45 | Runner iterasyon (>1), environment CRUD, scheduled task render/sil |
| 12 | `tier12-branch-response` | F46–F47 | Response Pretty/Raw geçişi + filtre, body kopyala → sistem panosu |
| 8+ | `tier8-mock-runtime` | MST-160 | Mock start/stop yaşam döngüsü |
| 9+ | `tier9-import-export` | MST-069, MST-071 | OpenAPI + Postman import sihirbazı |
| 12+ | `tier12-protocol-advanced` | MST-114–146 | WS/SSE/GQL/gRPC/Socket.IO/MCP ileri protokol |
| 14 | `tier14-security-persist` | MST-283–289 | Cert whitelist, tree cycle, import path, URL strip |

## Tur1 backlog (`tests/e2e/ui/tur1/`)

`ext/tur1/yapilacak-testler.txt` içindeki **292 MST** hedefinden **255'i kapsandı** (111 spec). Yardımcılar: `db-flow.ts`, `export-flow.ts`, `clipboard.ts` (pano mutex), `branch-flow.ts`, `mock-flow.ts` (port bantları), `http-extra.ts`, `runner-extra.ts`, `protocol-extra.ts`, `workbench-extra.ts`, `db-extra.ts`, genişletilmiş `assert-ipc.ts` / `import-flow.ts` / `env.ts` (`envVarRowByKey` value-scan).

| Grup | Spec'ler | MST aralığı | Durum |
|---|---|---|---|
| Auth / EULA | `01-auth-eula`, `auth-advanced` | 001–008 | ✅ |
| Workspace / proje | `03-workspace-project`, `workspace-advanced` | 010–016 | ✅ |
| Tree / save | `04-tree-tab-save`, `tree-advanced` | 017–029 | ✅ |
| HTTP derin | `http-{query-encoding,tls-trust,assertion-parity,ntlm,binary,binary-upload,compression-ui,proxy,ux-errors,cookies-jar}` | 030–050 | ✅ |
| Env | `01-env-parity`, `08-env-vars`, `env-advanced` | 051–065 | ✅ |
| Import / export | `import-{formats-2,wsdl-ui,proto,soapui,external-smoke,cancel,formats-roundtrip,swagger2,errors,har}`, `export-{variables,env-postman,test-suite}` | 066–102 | ✅ (engine'siz 6 format hariç) |
| SOAP / WSSE | `15-soap-wsdl`, `soap-{wsse-username,wsse-sign,wsse-encrypt,versions,custom-headers}` | 106–113 | ✅ (113 hariç) |
| Protokoller ileri | `ws/sse/graphql/grpc/socketio/mcp-advanced`, `protocol-tab-isolation` | 114–146 | ✅ (MST-124 skip — app bug) |
| Runner / suite / scheduler | `10-runner-scheduler`, `13-runner-parity`, `runner-{iterations,suite-crud}`, `18-runner-report`, `scheduled-tasks-deep` | 147–159, 171–179 | ✅ |
| Mock | `09-mock-deep`, `mock-{conditional,proxy}` | 160–170 | ✅ çekirdek |
| Settings / UX | `12-settings-updater`, `settings-advanced`, `ux-misc` | 180–214 | ✅ çekirdek |
| Shell | `shell-{isolation,relaunch,quit,dialogs,secure-storage,updater,security,window-open,ipc-errors}` | 215–232, 246, 290–291 | ✅ |
| DB persistence | `db-*.spec.ts` (19 dosya: `mock-state`, `project-active`, `relaunch`, `concurrency`, `corruption`, `wal-recovery`, `migration`…) | 251–281 | ✅ (MST-279 corrupt-bytes skip — app bug) |
| Güvenlik | `tier14-security-persist`, `shell-security`, `ai-chat-secrets` | 283–291 | ✅ |
| AI Chat | `25-ai-chat`, `ai-chat-deep`, `ai-chat-secrets` | — | ✅ |

**Kalan 37 MST** (36 P2 + 1 vitest): engine desteği olmayan import formatları (MST-076/077/078/080/081/084 — Apidog, JMeter, ApiDoc, WADL, Google Discovery, Hoppscotch), git-import edge akışları (103–105), gRPC/SOAP ekstraları (112, 113), runner/mock kalanları (158, 166, 167, 170), shell ekstraları (233–245, 247–250), import perf (091, 092, 102), docs sayfası (213), `tests/main/schema-sync.test.ts` (282 — yazıldı, vitest).

### Bilinen app-gap'ler (test yazımı sırasında bulunan, kapatılmamış)

| Bulgu | Etkisi | Test |
|---|---|---|
| SSE `Last-Event-ID` set edilince connect DOMException ile düşer (`sse.engine.ts` custom fetch header'ı eventsource@3 ile çakışıyor) | Header'lı reconnect çalışmıyor | `sse-advanced` MST-124 (skip) |
| Bozuk (garbage-byte) DB ile açılışta `initDatabase()` throw → pencere hiç açılmıyor, kurtarma yok | Başlangıç crash'i | `db-corruption` MST-279 (skip) |
| WS kayıtlı isteğin URL'i tab yeniden açılınca default'a dönüyor (DB'de doğru; store re-hydrate ezíyor) | UI restore eksik | `ws-advanced` MST-120 (DB assert'e indirildi) |
| Updater'ın UI bildirim yüzeyi yok (`updater-*` testid yok; UpdateModal yalnızca manuel) | MST-230/231 IPC-only doğrulanıyor | `shell-updater` |

> Not: Git branch izolasyonu (varsayılan branch `branch_id=NULL` paylaşımlı, varsayılan-olmayan branch içeriği izole) save-modal yolunda paylaşımlı içerik ürettiğinden UI flow'u yerine `tests/main/branch-isolation.test.ts` unit testinde kapsanır.

## Çalıştırma

```bash
npm run test:e2e:ui              # headless + yerel sunucular
npm run test:e2e:ui:visible      # pencere göster
```

`pretest:e2e:ui` otomatik: `ensure-native-abi electron` + `build`.

Tam liste: [`tests-list.txt`](./tests-list.txt)

## Ölü kod notu (Faz 12)

Aşağıdaki dosyalar mount edilmiyor — kullanıcı kararı bekleniyor:
- `ResponseMeta.tsx` — import yok
- `ToolsDropdown.tsx` — import yok
- `PreRequestTab.tsx` — ScriptsTab altında birleşik
