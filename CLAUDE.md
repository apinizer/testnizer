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
```

Paketleme (dmg/exe/deb/AppImage/zip) için **`.claude/commands/package.md`**'deki sırayı izle — native module (`better-sqlite3`) çapraz mimari rebuild'ini bozmamak için kritik.

---

## Kesin Tech Stack

| Katman | Teknoloji |
|---|---|
| Desktop shell | Electron ^31 |
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
│   │   │   ├── http.engine.ts → protocols/  (referans)
│   │   │   └── {auth, workspace, project, branch, endpoint, environment,
│   │   │        history, certificate, git, import-export, save, settings,
│   │   │        soap, websocket, graphql, grpc, sse, socketio, mcp,
│   │   │        runner, scheduler, test-suite}.handler.ts
│   │   ├── protocols/                 # Protokol motorları
│   │   │   └── {http, soap, websocket, graphql, grpc, sse, socketio, mcp}.engine.ts
│   │   └── db/                        # better-sqlite3 + migrations
│   │       ├── database.ts            # Init + schema + migrations
│   │       └── {workspace, project, branch, endpoint, environment,
│   │            history, certificate}.repo.ts
│   ├── preload/
│   │   └── index.ts                   # contextBridge — window.api köprüsü
│   └── renderer/                      # React 19 — yalnızca UI
│       ├── main.tsx, App.tsx
│       ├── index.html                 # CSP: connect-src 'self'
│       ├── components/
│       │   ├── auth/                  # LoginScreen + password kurulum
│       │   ├── layout/                # AppShell, Header, LeftPanel, UrlBar,
│       │   │                          # Workbench, Footer, ProjectHome
│       │   ├── sidebar/               # TreeView, TreeNode, NewDropdown
│       │   ├── request/               # RequestEditor + Params/Auth/Headers/Body/Pre/Tests
│       │   ├── response/              # ResponsePane + Body/Cookie/Console/ActualRequest
│       │   ├── protocols/             # SOAP/WS/GraphQL/gRPC/SSE/Socket.IO/MCP editörleri
│       │   ├── runner/                # Collection runner UI
│       │   ├── modals/                # Import, Environment, Settings, vb.
│       │   └── shared/                # MethodBadge, StatusBadge, MonacoEditor, vb.
│       ├── stores/                    # Zustand — feature başına bir store
│       │   └── {auth, workspace, branch, tabs, request, response, environment,
│       │        history, console, ui, runner, updater,
│       │        soap, websocket, graphql, grpc, sse, socketio, mcp}.store.ts
│       ├── lib/
│       │   ├── variable-resolver.ts   # {{var}} substitution
│       │   ├── dynamic-values.ts      # {{$randomInt}} vb.
│       │   ├── test-runner.ts         # pm API + assertions
│       │   ├── code-generator.ts      # cURL/JS/Python snippet üretimi
│       │   ├── i18n.ts                # EN + TR çeviriler
│       │   ├── monaco-theme.ts, keyboard-shortcuts.ts, utils.ts
│       └── types/index.ts             # Tüm TypeScript tipleri (tek dosya)
├── scripts/
│   ├── patch-electron-name.sh         # Electron.app → Testnizer.app (postinstall)
│   ├── generate-icons.mjs             # Logo → multi-size PNG/ICO/ICNS
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
| Workspace + Project | `workspace.handler.ts`, `project.handler.ts` | `workspace.store.ts` | Workspace içinde n-proje |
| Branch + Git | `branch.handler.ts`, `git.handler.ts` | `branch.store.ts` | `simple-git`, proje başına branch |
| Endpoint + Environment | `endpoint.handler.ts`, `environment.handler.ts` | `environment.store.ts` | Env'ler **proje scope** (Postman'den farklı), initialValue + value |
| History | `history.handler.ts` | `history.store.ts` | Yerel SQLite |
| Certificate | `certificate.handler.ts` | — | mTLS / client cert |
| Import/Export + Save | `import-export.handler.ts`, `save.handler.ts` | — | OpenAPI/Postman/Insomnia/cURL/HAR vb. |
| Settings | `settings.handler.ts` | `ui.store.ts` | electron-store |
| Collection Runner | `runner.handler.ts` | `runner.store.ts` | Çoklu endpoint sequential run + HTML rapor |
| Scheduler | `scheduler.handler.ts` | — | Zamanlanmış görevler |
| Test Suite | `test-suite.handler.ts` | — | Çoklu koleksiyon test setleri |
| Socket.IO | `socketio.handler.ts` | `socketio.store.ts` | `socket.io-client`; namespace, `auth.token`, emit/subscribe, bidi event timeline |
| MCP (Model Context Protocol) | `mcp.handler.ts` | `mcp.store.ts` | `@modelcontextprotocol/sdk` — Streamable HTTP / SSE / stdio; tools/list + callTool |
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

## Kod Standartları

- TypeScript strict — `any` yasak
- IPC: her zaman `{success: boolean, data?: T, error?: string}` döner
- Renderer: `window.api` dışında network çağrısı yok
- Tailwind class'ları — inline style yok (Monaco/dinamik değerler hariç)
- Monaco: `automaticLayout: true` her zaman
- Component: max ~200 satır, gerekirse böl

---

## Gotchas

- **Native rebuild**: `better-sqlite3` arch-specific derleme gerektirir. Dev'de `electron-builder install-app-deps` postinstall'da çalışır. Çapraz mimari paketleme için **mutlaka** `.claude/commands/package.md` sırasını izle (yoksa macOS DMG'sinden Windows DLL çıkabilir).
- **Dev launcher rename**: İlk `npm install` sonrası `Electron.app` → `Testnizer.app` olarak yeniden adlandırılır. Dock/menüde "Testnizer" görünür. `npm run icons` `Testnizer.app/electron.icns`'i de günceller.
- **Renderer'dan dış ağ yok**: CSP `connect-src 'self'`. Yeni bir HTTP çağrısı eklenecekse main process'te engine + IPC handler oluşturulmalı.
- **Tailwind v4**: `tailwind.config.*` yok, `@tailwindcss/vite` plugin'i kullanılıyor. v3 dokümantasyonuna güvenme.
- **Dynamic import uyarısı**: `runner.handler.ts`, `scheduler.handler.ts` tarafından dinamik import edilirken `ipc/index.ts`'te statik de import ediliyor — Vite uyarı verir, davranışsal sorun yok.
