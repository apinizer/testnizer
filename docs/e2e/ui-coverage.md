# Testnizer UI E2E — Tam Kapsam Matrisi

Güncelleme: 2026-06-05 | **~330 UI E2E testi** (27 legacy spec + **40 tur1 spec** + journey flows) + **47 kullanıcı yolculuğu (journey) flow'u** (15 tier spec, `tests/e2e/ui/flows/`)

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

`ext/tur1/yapilacak-testler.txt` içindeki **292 MST** hedefinin büyük kısmı için spec iskeleti eklendi. Yardımcılar: `db-flow.ts`, `export-flow.ts`, genişletilmiş `assert-ipc.ts` / `import-flow.ts`.

| Grup | Örnek spec | MST aralığı | Durum |
|---|---|---|---|
| Auth / EULA | `01-auth-eula` | 001–008 | ✅ çekirdek |
| Env parity | `01-env-parity` | 051, 062 | ✅ (paralel flaky) |
| Workspace / proje | `03-workspace-project` | 010–012 | ✅ |
| Tree / save | `04-tree-tab-save` | 017–023 | ✅ (021 flaky) |
| HTTP / auth | `05-*`, `http-*` | 030–044 | ✅ çoğu |
| Env UI | `08-env-vars` | 059–065 | ✅ |
| Response toolbar | `08-response-toolbar` | 038–039 | ✅ |
| Import / export | `import-*`, `export-*`, `tier9` | 069–097 | ✅ çoğu |
| SOAP | `15-soap-wsdl` | 106 | ✅ (paralel flaky) |
| Mock / runner | `09-mock-deep`, `10-runner-scheduler`, `16-scheduled-tasks` | 160–179 | ✅ çekirdek |
| DB persistence | `db-*.spec.ts` (12 dosya) | 251–277 | ✅ IPC ağırlıklı |
| Shell / SEC | `shell-security`, `shell-window-open`, `tier14` | 215–219, 283–291 | ✅ çekirdek |
| Certificates | `14-certificates-mtls`, `db-certificates` | 047, 196, 260–270 | ✅ |

**Henüz eksik / Sprint 2–5:** `shell-dialogs`, `shell-relaunch`, `13-ai-tools-cross`, `soap-wsse-*`, `http-cookies-jar`, `tier13-git-save`, paketleme (`shell-packaging`), AI chat secrets, import formatları (Apidog/JMeter/RAML…), runner HTML rapor derinliği.

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
