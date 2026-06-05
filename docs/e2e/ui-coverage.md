# Testnizer UI E2E — Tam Kapsam Matrisi

Güncelleme: 2026-06-05 | **238 UI E2E testi** (27 spec dosyası)

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
| Request Auth 7 tip | ✅ | `14` |
| Request Body/Settings | ✅ | `14` |
| Request Scripts/Tests | ✅ | `15` |
| Response pane toolbar | ✅ | `16` |
| Response tabs | ✅ | `10` |
| Tree CRUD | 🟡 | `17` (folder add, import) |
| 11 protokol editörü | ✅ | `07`, `18`, `25` |
| 20 Tools işlevsel | ✅ | `06`, `19` |
| Mock servers | 🟡 | `20` |
| Runner / suite | 🟡 | `21`, `12` |
| Modals derin | ✅ | `04`, `22` |
| Project detail 15 tab | ✅ | `11` |
| Header / branch / tabs | ✅ | `23` |
| Cross-cutting | ✅ | `24` |

**Durum:** ✅ Tam · 🟡 Kısmi (CRUD/run akışının bir kısmı)

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
