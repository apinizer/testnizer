# Testnizer — Claude Code Master Instructions

## Ürün Özeti

**Testnizer** — Apidog'un görsel arayüzünü ve kullanıcı deneyimini referans alan, sıfırdan inşa edilmiş, **tamamen bağımsız** cross-platform masaüstü API test uygulaması.

- Dağıtım: Ücretsiz standalone Electron app
- Platform: Windows, macOS, Linux
- Bağımlılık: Sıfır — harici sunucuya ihtiyaç yok
- Hedef: Kurumsal (bankacılık, kamu, sigorta) + genel developer kitlesi

---

## Komutlar

```bash
npm install              # Bağımlılıklar + electron-builder install-app-deps + patch-electron-name.sh (postinstall)
npm run dev              # electron-vite dev — renderer http://localhost:5173, Electron Testnizer.app olarak başlar
npm run build            # Main + preload + renderer üretim derlemesi (out/)
npm run typecheck        # main + renderer için tsc --noEmit
npm run icons            # build/ ve resources/ ikonlarını yeniden üretir (sharp + png2icons)
npm test                 # vitest unit testler (pretest ABI'yi otomatik node'a flip eder)
npm run test:e2e         # playwright E2E (önce build gerekli; test:all zinciri kullan)
npm run test:all         # unit → build → e2e tek seferde
npm run lint             # eslint src/ (lint:fix otomatik düzeltir)
npm run format           # prettier src/ (format:check sadece doğrular)
```

Paketleme (dmg/exe/deb/AppImage/zip) için **`.claude/commands/package.md`**'deki sırayı izle — native module (`better-sqlite3`) çapraz mimari rebuild'ini bozmamak için kritik.

---

## Kesin Tech Stack

| Katman | Teknoloji |
|---|---|
| Desktop shell | Electron ^33 (NODE_MODULE_VERSION 130) |
| Build tool | electron-vite ^2 |
| Frontend | React 19 + TypeScript 5 |
| Styling | Tailwind CSS ^4 (`@tailwindcss/vite`) + shadcn/ui (Radix UI) |
| Code editor | Monaco Editor (`@monaco-editor/react`) |
| State | Zustand ^5 |
| Local DB | better-sqlite3 ^11 |
| Config/secrets | electron-store ^10 |
| HTTP/REST | axios ^1.7 + tough-cookie |
| SOAP/WSDL | soap ^1.9 + wsse |
| WebSocket | ws ^8 |
| GraphQL | graphql ^16 + graphql-ws |
| gRPC | @grpc/grpc-js + @grpc/proto-loader |
| SSE | eventsource ^3 |
| Socket.IO | socket.io-client ^4 |
| MCP | @modelcontextprotocol/sdk ^1 |
| OpenAPI parse | @readme/openapi-parser + js-yaml + fast-xml-parser |
| Git entegrasyonu | simple-git |
| Packaging | electron-builder ^25 |
| Auto-update | electron-updater ^6 |

---

## Mimari — Kesin Kurallar

### Process Ayrımı
```
Main Process (Node.js)     →  TÜM network, DB, dosya işlemleri
Renderer Process (React)   →  YALNIZCA UI, hiçbir zaman network çağrısı yapmaz
Preload (contextBridge)    →  window.api köprüsü — tek iletişim kanalı
```

### IPC Pattern (her handler bu formatı kullanır)
```typescript
// Main: ipcMain.handle('channel:action', async (event, ...args) => {
//   try { return { success: true, data: result } }
//   catch (e) { return { success: false, error: e.message } }
// })
// Renderer: const result = await window.api.channel.action(args)
```

### Güvenlik
- `contextIsolation: true` — her zaman
- `nodeIntegration: false` — her zaman
- `webSecurity: false` — sadece dev modunda
- `index.html` CSP: `connect-src 'self'` — renderer'dan dış ağ trafiği **yasak**, tüm network main process IPC üzerinden geçer
- `setWindowOpenHandler`: yalnızca `http(s)` URL'leri `shell.openExternal` ile açılır, diğer şemalar reddedilir

### Branding ve Kimlik
- `app.name = 'Testnizer'`, `appUserModelId = com.testnizer.app`
- macOS `userData`: `~/Library/Application Support/Testnizer` (eski kurulumlarda `Apinizer` adında olabilir — manuel migrasyon gerekir)
- Dev modunda `node_modules/electron/dist/Electron.app`, `postinstall` ile `Testnizer.app` olarak yeniden adlandırılır (`scripts/patch-electron-name.sh`)

### macOS Packaging Gotchas
- `afterPack: scripts/ad-hoc-sign.js` — yerel build'lerde ad-hoc imzalama
- `afterSign: scripts/notarize.js` — `package.json`'da `notarize: false` (kapalı); açmak için Apple Developer credentials env var'ları gerekir
- `hardenedRuntime: true`, `entitlements: build/entitlements.mac.plist`
- `afterAllArtifactBuild: scripts/collect-packages.js` — `dist/`'ten `release/`'a normalleştirilmiş artifact toplar

---

## UI Renk Sistemi

### Açık Tema (default — mockup'tan alınmış)
```
bg:           #f5f5f7   (app zemin)
white:        #ffffff   (panel, workbench)
border:       #e8e8ed   (ince kenar)
border2:      #d0d0da   (güçlü kenar)
text:         #1a1a2e   (ana metin)
muted:        #888888   (ikincil metin)
hint:         #bbbbbb   (soluk/placeholder)
accent:       #7c73e6   (Testnizer mor — buton, aktif, vurgu)
accentLight:  #eeecfe   (aktif tab/item arka plan)
accentText:   #5b52d4   (aksanın metin tonu)
surface:      #fafafa   (kart içi zemin)
green:        #1a7a4a   (success/2xx)
greenBg:      #e8f9f1
blue:         #0066cc   (JSON key rengi)
orange:       #b35a00   (variable/string rengi)
```

### Method Badge Renkleri (mockup'tan alınmış)
```
GET:     bg=#e8f4ff color=#0066cc border=#b3d4f5
POST:    bg=#e8f9f1 color=#1a7a4a border=#b3e5cc
PUT:     bg=#fff4e0 color=#b35a00 border=#f5d4a0
PATCH:   bg=#f0faf5 color=#0a7a5a border=#a0e0c8
DELETE:  bg=#fff0f0 color=#cc2200 border=#f5b3b3
```

---

## Layout Yapısı (mockup'tan alınmış)

```
┌─────────────────────────────────────────────────────────────────┐
│ HEADER (44px): Logo | Project tabs | Branch pill | User avatar  │
├──────────────────┬──────────────────────────────────────────────┤
│                  │ URL BAR (56px): Method | URL | Send | Save   │
│  LEFT PANEL      ├────────────────────┬────────────────────────┤
│  (260px)         │  REQUEST PANE      │  RESPONSE PANE         │
│                  │  (50% default)     │  (50% default)         │
│  ┌─ Panel top    │                    │                         │
│  │  APIs title   │  Tabs: Params      │  Meta: 200 OK 142ms    │
│  │  + branch     │  Auth Headers      │  Tabs: Response Cookie │
│  │  + New btn    │  Body Pre Tests    │  Console Actual        │
│  └─ Search bar   │                    │                         │
│                  │  Content area      │  Monaco (JSON syntax)  │
│  Tree:           │                    │                         │
│  Default module  │                    │                         │
│  ├ Endpoints     │◄── Resizable ──►  │                         │
│  │ ├ Sample APIs │    Divider         │                         │
│  │ └ Sorgula     │                    │                         │
│  ├ Schemas       │                    │                         │
│  └ Components    │                    │                         │
│  Calculator      │                    │                         │
│  Quick Requests  │                    │                         │
├──────────────────┴──────────────────────────────────────────────┤
│ FOOTER (28px): Status | Environment | Runner | Console | ?      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Proje Dosya Yapısı

```
testnizer/
├── src/
│   ├── main/                          # Node.js — network, DB, dosya, IPC
│   │   ├── index.ts                   # BrowserWindow, app.name, dock, IPC register
│   │   ├── updater.ts                 # electron-updater
│   │   ├── ipc/                       # Protokol/feature başına bir handler
│   │   │   ├── index.ts               # registerAllHandlers()
│   │   │   ├── request.handler.ts     # Generic HTTP request
│   │   │   └── {ai-chat, auth, branch, certificate, dialog, endpoint,
│   │   │        environment, eula, git, graphql, grpc, history,
│   │   │        import-export, mcp, mock, project, runner, save,
│   │   │        scheduler, settings, soap, socketio, sse, test-suite,
│   │   │        websocket, workspace, wsse}.handler.ts
│   │   ├── protocols/                 # Protokol motorları
│   │   │   ├── grpc-reflection.ts     # gRPC server reflection client
│   │   │   └── {ai-chat, graphql, grpc, http, mcp, soap, socketio, sse,
│   │   │        websocket, wsse}.engine.ts
│   │   └── db/                        # better-sqlite3 + migrations
│   │       ├── database.ts            # Init + schema + migrations
│   │       └── {workspace, project, branch, endpoint, environment,
│   │            history, certificate, mock, test-suite-folder,
│   │            test-suite-item}.repo.ts
│   ├── preload/
│   │   └── index.ts                   # contextBridge — window.api köprüsü
│   └── renderer/                      # React 19 — yalnızca UI
│       ├── main.tsx, App.tsx
│       ├── index.html                 # CSP: connect-src 'self'
│       ├── components/
│       │   ├── auth/                  # LoginScreen + password kurulum
│       │   ├── eula/                  # EulaConsentGate, LegalDocModal, LegalMarkdown
│       │   ├── layout/                # AppShell, Header, LeftPanel, UrlBar,
│       │   │                          # Workbench, Footer, ProjectHome, IconSidebar,
│       │   │                          # QuickTestShell, ToolsDropdown
│       │   ├── sidebar/               # TreeView, TreeNode, NewDropdown, TestsPanel,
│       │   │                          # ToolsPanel, BranchDropdown, HistoryListPanel
│       │   ├── request/               # RequestEditor + Params/Auth/Headers/Body/Pre/Tests
│       │   ├── response/              # ResponsePane + Body/Cookie/Console/ActualRequest
│       │   ├── protocols/             # SOAP/WS/GraphQL/gRPC/SSE/Socket.IO/MCP/AI Chat editörleri
│       │   ├── mock/                  # MockServerEditor, MockServersPanel
│       │   ├── tools/                 # Standalone utility'ler: JWT, JSONPath, XSLT, XPath,
│       │   │                          # Hash, HMAC, Diff, Encoders, Regex, Epoch, UUID,
│       │   │                          # Base/JsonXml/JsonSchema/YamlJson/JoltFormat, WsSecurity
│       │   ├── runner/                # Collection runner UI + ScheduledTasks + TestsHome
│       │   ├── modals/                # Import, Environment, Settings, RunnerConfig/Results vb.
│       │   └── shared/                # MethodBadge, StatusBadge, MonacoEditor, vb.
│       ├── stores/                    # Zustand — feature başına bir store
│       │   └── {ai-chat, auth, branch, console, environment, eula, graphql, grpc,
│       │        history, mcp, mock, request, response, runner, soap, socketio,
│       │        sse, tabs, ui, updater, websocket, workspace}.store.ts
│       ├── lib/
│       │   ├── variable-resolver.ts   # {{var}} substitution
│       │   ├── dynamic-values.ts      # {{$randomInt}} vb.
│       │   ├── test-runner.ts         # pm API + assertions
│       │   ├── code-generator.ts      # cURL/JS/Python snippet üretimi
│       │   ├── i18n.ts                # EN + TR çeviriler
│       │   ├── tools/                 # Tools panel'in saf TS implementasyonları (browser-safe)
│       │   ├── tools-bridge.ts, tools-catalog.ts
│       │   ├── key-value-bulk.ts, http-headers.ts, graphql-errors.ts
│       │   ├── persist-helpers.ts, open-endpoint-tab.ts, mock-snippets.ts
│       │   └── monaco-theme.ts, keyboard-shortcuts.ts, utils.ts
│       └── types/index.ts             # Tüm TypeScript tipleri (tek dosya, ~820 satır)
├── tests/
│   ├── main/                          # vitest — handler + engine + repo testleri
│   ├── renderer/                      # vitest + jsdom — component/store testleri
│   ├── e2e/                           # playwright — smoke + http + wsse senaryoları
│   ├── fixtures/                      # test verisi
│   └── setup-renderer.ts              # jsdom + testing-library config
├── docs/legal/                        # eula.md, privacy-policy.md (extraResources ile paketlenir)
├── scripts/
│   ├── patch-electron-name.sh         # Electron.app → Testnizer.app (postinstall)
│   ├── ensure-native-abi.js           # better-sqlite3 ABI flip (node ↔ electron)
│   ├── generate-icons.mjs             # Logo → multi-size PNG/ICO/ICNS
│   ├── generate-licenses.mjs          # 3rd-party lisans listesi
│   ├── socketio-echo-server.cjs       # dev:socketio-echo — yerel test sunucusu
│   ├── ad-hoc-sign.js                 # afterPack — yerel imzalama
│   ├── notarize.js                    # afterSign — Apple notarize (opt-in)
│   ├── collect-packages.js            # afterAllArtifactBuild — release/ topla
│   └── verify-natives.js              # better-sqlite3 native binding mimarisini kontrol
├── build/                             # icon.{icns,ico,png}, entitlements.mac.plist
├── resources/                         # Runtime kaynakları (icon, vb.)
└── .claude/
    ├── agents/        # ui-frontend, protocol-engine, database, electron-shell, import-export
    └── commands/      # bootstrap, implement-phase, implement-soap, add-protocol, package
```

---

## Major Feature Modülleri (handler ↔ store ↔ UI)

| Modül | Main handler | Renderer store | Notlar |
|---|---|---|---|
| Auth / Login | `auth.handler.ts` | `auth.store.ts` | Opsiyonel password ile yerel veri koruma |
| EULA / Privacy | `eula.handler.ts` | `eula.store.ts` | İlk açılışta `EulaConsentGate`; `docs/legal/` extraResources |
| Workspace + Project | `workspace.handler.ts`, `project.handler.ts` | `workspace.store.ts` | Workspace içinde n-proje |
| Branch + Git | `branch.handler.ts`, `git.handler.ts` | `branch.store.ts` | `simple-git`, proje başına branch |
| Endpoint + Environment | `endpoint.handler.ts`, `environment.handler.ts` | `environment.store.ts` | Env'ler **proje scope** (Postman'den farklı), initialValue + value |
| History | `history.handler.ts` | `history.store.ts` | Yerel SQLite |
| Certificate | `certificate.handler.ts` | — | mTLS / client cert |
| Dialog | `dialog.handler.ts` | — | Native open/save/message dialog köprüsü |
| Import/Export + Save | `import-export.handler.ts`, `save.handler.ts` | — | OpenAPI/Postman/Insomnia/cURL/HAR vb. |
| Settings | `settings.handler.ts` | `ui.store.ts` | electron-store |
| Collection Runner | `runner.handler.ts` | `runner.store.ts` | Çoklu endpoint sequential run + HTML rapor |
| Scheduler | `scheduler.handler.ts` | — | Zamanlanmış görevler |
| Test Suite | `test-suite.handler.ts` | — | Çoklu koleksiyon test setleri (kendine ait folder + item repo'ları) |
| SSE | `sse.handler.ts` | `sse.store.ts` | `eventsource` ^3; tek yön server→client event akışı |
| WebSocket | `websocket.handler.ts` | `websocket.store.ts` | `ws` ^8; bidi mesaj timeline |
| Socket.IO | `socketio.handler.ts` | `socketio.store.ts` | `socket.io-client`; namespace, `auth.token`, emit/subscribe, bidi event timeline |
| MCP (Model Context Protocol) | `mcp.handler.ts` | `mcp.store.ts` | `@modelcontextprotocol/sdk` — Streamable HTTP / SSE / stdio; tools/list + callTool |
| AI Chat | `ai-chat.handler.ts`, `ai-chat.engine.ts` | `ai-chat.store.ts` | LLM provider'lar; tools-bridge ile Tools panel entegrasyonu |
| Mock Server | `mock.handler.ts`, `mock.repo.ts` | `mock.store.ts` | Yerel HTTP mock server (rule-based response) |
| WSSE | `wsse.handler.ts`, `wsse.engine.ts` | — | SOAP için WS-Security imzalama/şifreleme (xml-crypto, xml-encryption) |
| Tools panel | — (renderer-only) | — | Saf TS implementasyon (`lib/tools/`): JWT, JSONPath, XSLT, XPath, Hash, HMAC, Diff, Encoders, Regex, JSON↔XML/YAML, Jolt, JSON Schema, Base, Epoch, UUID, WsSecurity |
| Updater | (`src/main/updater.ts`) | `updater.store.ts` | electron-updater |

---

## Geliştirme Sırası

Her feature için bu sırayı izle:
1. `src/renderer/types/index.ts` — tipler
2. `src/main/db/` — repository
3. `src/main/protocols/` — engine
4. `src/main/ipc/` — handler (try/catch, `{success,data?,error?}`)
5. `src/preload/index.ts` — bridge
6. `src/renderer/stores/` — Zustand store
7. `src/renderer/components/` — React UI

## Testler

- **Unit/integration**: `vitest` ^3 — `tests/main/` (handler/engine/repo) ve `tests/renderer/` (component/store). `pretest` hook'u `ensure-native-abi.js` çağırarak better-sqlite3'ü **node ABI**'ye flip eder.
- **E2E**: `@playwright/test` ^1 — `tests/e2e/` (`smoke.spec.ts`, `http/`, `wsse/`). Önce `npm run build` gerekli; tam zincir `npm run test:all`.
- **Renderer testleri**: `tests/setup-renderer.ts` jsdom + `@testing-library/react` config'i sağlar.
- **Test fixture'ları**: `tests/fixtures/` (örn. OpenAPI/Postman JSON, WSDL).
- **Coverage**: `npm run test:coverage` — `@vitest/coverage-v8`.

---

## Kod Standartları

- TypeScript strict — `any` yasak
- IPC: her zaman `{success: boolean, data?: T, error?: string}` döner
- Renderer: `window.api` dışında network çağrısı yok
- Tailwind class'ları — inline style yok (Monaco/dinamik değerler hariç)
- Monaco: `automaticLayout: true` her zaman
- Component: max ~200 satır, gerekirse böl

---

## Gotchas

- **Native ABI yönetimi (`better-sqlite3`)**: Native module hem **arch-specific** hem **ABI-specific** derleme gerektirir; tek `.node` binary'si var ve `npm rebuild` ↔ `electron-builder install-app-deps` birbirini ezer. `scripts/ensure-native-abi.js` + npm pre-hook'ları bunu otomatize eder:
  - `pretest:unit` / `pretest` → ABI **node** (vitest sistem Node'da koşar — NODE_MODULE_VERSION = `process.versions.modules`)
  - `predev` / `prebuild:*` → ABI **electron** (Electron 33 = NODE_MODULE_VERSION 130)
  - `postinstall` → `install-app-deps` + `ensure-native-abi.js electron --mark-only`
  - Marker: `node_modules/better-sqlite3/build/Release/.testnizer-abi`; aynı target tekrar çağrıldığında <10 ms'de skip
  - Her electron rebuild'i `@electron/rebuild --force --only better-sqlite3` üzerinden geçer (stale `.forge-meta` bug'ı için)
  - **Manuel adım yok** — `npm test`, `npm run dev`, `npm run build:mac:arm64` ardarda çağrılabilir, ABI otomatik flip
  - Çapraz mimari paketleme (macOS host'ta Windows DLL gibi) için yine `.claude/commands/package.md` sırasını izle
- **Dev launcher rename**: İlk `npm install` sonrası `Electron.app` → `Testnizer.app` olarak yeniden adlandırılır. Dock/menüde "Testnizer" görünür. `npm run icons` `Testnizer.app/electron.icns`'i de günceller.
- **Renderer'dan dış ağ yok**: CSP `connect-src 'self'`. Yeni bir HTTP çağrısı eklenecekse main process'te engine + IPC handler oluşturulmalı.
- **Tailwind v4**: `tailwind.config.*` yok, `@tailwindcss/vite` plugin'i kullanılıyor. v3 dokümantasyonuna güvenme.
- **Dynamic import uyarısı**: `runner.handler.ts`, `scheduler.handler.ts` tarafından dinamik import edilirken `ipc/index.ts`'te statik de import ediliyor — Vite uyarı verir, davranışsal sorun yok.
