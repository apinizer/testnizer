# Apinizer API Tester — Claude Code Master Instructions

## Ürün Özeti

**Apinizer API Tester** — Apidog'un görsel arayüzünü ve kullanıcı deneyimini referans alan, sıfırdan inşa edilmiş, **tamamen bağımsız** cross-platform masaüstü API test uygulaması.

- Dağıtım: Ücretsiz standalone Electron app
- Platform: Windows, macOS, Linux
- Bağımlılık: Sıfır — Apinizer sunucusuna ihtiyaç yok
- Hedef: Kurumsal (bankacılık, kamu, sigorta) + genel developer kitlesi

---

## Referans UI Mockup'ları

`docs/mockups/` klasöründe iki JSX dosyası bulunur:

- **`ApinizerApiTesterLight.jsx`** — Açık tema, ekran görüntüsü alınan Apidog UI'ına birebir benzer. **Bu dosya UI'ın kesin referansıdır.** Her bileşenin görsel çıktısı bu mockup'a uygun olmalıdır.
- **`ApinizerApiTesterDark.jsx`** — Koyu tema versiyonu.

Claude Code UI bileşeni yazmadan önce mutlaka bu dosyaları okusun.

---

## Kesin Tech Stack

| Katman | Teknoloji |
|---|---|
| Desktop shell | Electron ^31 |
| Build tool | electron-vite ^2 |
| Frontend | React 19 + TypeScript 5 |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Code editor | Monaco Editor (`@monaco-editor/react`) |
| State | Zustand ^5 |
| Local DB | better-sqlite3 ^9 |
| Config/secrets | electron-store ^10 |
| HTTP/REST | axios ^1.7 |
| SOAP/WSDL | node-soap ^0.45 + wsse |
| WebSocket | ws ^8 |
| GraphQL | graphql ^16 + graphql-ws |
| gRPC | @grpc/grpc-js + @grpc/proto-loader |
| SSE | eventsource ^2 |
| OpenAPI parse | swagger-parser + js-yaml |
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
accent:       #7c73e6   (Apinizer mor — buton, aktif, vurgu)
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
apinizer-api-tester/
├── src/
│   ├── main/
│   │   ├── index.ts                    # Electron entry, window creation
│   │   ├── ipc/
│   │   │   ├── index.ts                # Tüm handler'ları register eder
│   │   │   ├── request.handler.ts      # HTTP/SOAP/WS/GQL/gRPC/SSE
│   │   │   ├── workspace.handler.ts
│   │   │   ├── project.handler.ts
│   │   │   ├── endpoint.handler.ts
│   │   │   ├── environment.handler.ts
│   │   │   ├── history.handler.ts
│   │   │   ├── import-export.handler.ts
│   │   │   └── settings.handler.ts
│   │   ├── protocols/
│   │   │   ├── http.engine.ts
│   │   │   ├── soap.engine.ts
│   │   │   ├── websocket.engine.ts
│   │   │   ├── graphql.engine.ts
│   │   │   ├── grpc.engine.ts
│   │   │   └── sse.engine.ts
│   │   ├── db/
│   │   │   ├── database.ts             # Init + migrations
│   │   │   ├── workspace.repo.ts
│   │   │   ├── project.repo.ts
│   │   │   ├── endpoint.repo.ts
│   │   │   ├── environment.repo.ts
│   │   │   └── history.repo.ts
│   │   └── updater.ts
│   ├── preload/
│   │   └── index.ts                    # contextBridge — window.api
│   └── renderer/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── layout/
│       │   │   ├── AppShell.tsx        # Root layout
│       │   │   ├── Header.tsx          # 44px — logo + tabs + branch + avatar
│       │   │   ├── LeftPanel.tsx       # 260px — tree + search
│       │   │   ├── UrlBar.tsx          # 56px — method + url + send
│       │   │   ├── Workbench.tsx       # Split request/response
│       │   │   └── Footer.tsx          # 28px
│       │   ├── sidebar/
│       │   │   ├── TreeView.tsx        # Recursive tree component
│       │   │   ├── TreeNode.tsx
│       │   │   └── NewDropdown.tsx     # "+" dropdown menu
│       │   ├── request/
│       │   │   ├── RequestEditor.tsx   # Tab container
│       │   │   ├── ParamsTab.tsx
│       │   │   ├── AuthTab.tsx
│       │   │   ├── HeadersTab.tsx
│       │   │   ├── BodyTab.tsx
│       │   │   ├── PreRequestTab.tsx
│       │   │   └── TestsTab.tsx
│       │   ├── response/
│       │   │   ├── ResponsePane.tsx
│       │   │   ├── ResponseMeta.tsx    # Status + time + size + test badge
│       │   │   ├── ResponseBody.tsx    # Monaco readonly
│       │   │   ├── CookieTab.tsx
│       │   │   ├── ConsoleTab.tsx
│       │   │   └── ActualRequestTab.tsx
│       │   ├── protocols/
│       │   │   ├── SoapEditor.tsx      # WSDL import + operation selector
│       │   │   ├── WebSocketEditor.tsx
│       │   │   ├── GraphQLEditor.tsx
│       │   │   ├── GrpcEditor.tsx
│       │   │   └── SseEditor.tsx
│       │   ├── modals/
│       │   │   ├── ImportModal.tsx     # 16-format import grid
│       │   │   ├── EnvironmentModal.tsx
│       │   │   └── SettingsModal.tsx
│       │   └── shared/
│       │       ├── MethodBadge.tsx
│       │       ├── StatusBadge.tsx
│       │       ├── KeyValueTable.tsx   # Params/headers table
│       │       ├── MonacoEditor.tsx    # Wrapper with theme
│       │       └── EmptyState.tsx
│       ├── stores/
│       │   ├── workspace.store.ts
│       │   ├── tabs.store.ts
│       │   ├── request.store.ts
│       │   ├── response.store.ts
│       │   ├── environment.store.ts
│       │   └── ui.store.ts
│       ├── lib/
│       │   ├── variable-resolver.ts    # {{var}} substitution
│       │   ├── dynamic-values.ts       # {{$randomInt}} etc.
│       │   ├── test-runner.ts          # pm API + assertions
│       │   └── code-generator.ts       # cURL/JS/Python snippets
│       └── types/
│           └── index.ts                # Tüm TypeScript tipleri
├── docs/
│   ├── SRS.md
│   ├── UI-SPEC.md
│   ├── APIDOG-ANALYSIS.md
│   ├── TYPES.md
│   ├── mockups/
│   │   ├── ApinizerApiTesterLight.jsx  # ← KESİN UI REFERANSI
│   │   └── ApinizerApiTesterDark.jsx
│   └── java-reference/
│       ├── README.md
│       └── ConverterWSDL.java
└── .claude/
    ├── agents/
    │   ├── ui-frontend.md
    │   ├── protocol-engine.md
    │   ├── database.md
    │   ├── electron-shell.md
    │   └── import-export.md
    └── commands/
        ├── bootstrap.md
        ├── implement-phase.md
        ├── implement-soap.md
        └── add-protocol.md
```

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
