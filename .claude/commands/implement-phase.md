# /implement-phase [1|2|3|4|5]

---

## Faz 1 — Core HTTP Client (MVP)

**UI önce okunacak:** `docs/mockups/ApinizerApiTesterLight.jsx`

Sırasıyla implement et:

### 1. Types (`src/renderer/types/index.ts`)
`docs/TYPES.md` dosyasındaki tüm interface'leri kopyala.

### 2. Database
- `src/main/db/database.ts` — init + migrations (11 tablo)
- `src/main/db/workspace.repo.ts`
- `src/main/db/project.repo.ts`
- `src/main/db/endpoint.repo.ts`
- `src/main/db/environment.repo.ts`
- `src/main/db/history.repo.ts`

### 3. HTTP Engine
- `src/main/protocols/http.engine.ts`
- axios + tüm auth tipleri + SSL toggle + proxy + timing

### 4. IPC Handlers
- `src/main/ipc/request.handler.ts`
- `src/main/ipc/workspace.handler.ts`
- `src/main/ipc/project.handler.ts`
- `src/main/ipc/endpoint.handler.ts`
- `src/main/ipc/environment.handler.ts`
- `src/main/ipc/history.handler.ts`
- `src/main/ipc/settings.handler.ts`
- `src/main/ipc/index.ts` — hepsini register eder

### 5. Preload Bridge
- `src/preload/index.ts` — electron-shell agent'ından kopyala

### 6. AppShell Layout
Mockup'taki gibi:
- `Header.tsx` (44px): logo + proje tabs + branch pill + avatar
- `LeftPanel.tsx` (260px): panel top bar + search + tree
- `TreeView.tsx` + `TreeNode.tsx`: recursive, openIds state
- `NewDropdown.tsx`: 3 bölüm, Import tıklayınca modal
- `UrlBar.tsx` (56px): method dropdown + URL + Send + Save
- `Workbench.tsx`: resizable split (50/50 default)
- `Footer.tsx` (28px): status + env + runner + console

### 7. Request Editor
- `RequestEditor.tsx`: Params|Auth|Headers|Body|Pre-request|Tests
- `ParamsTab.tsx`: KV table, path variables
- `AuthTab.tsx`: type selector + per-type fields
- `HeadersTab.tsx`: KV table
- `BodyTab.tsx`: radio + Monaco
- `PreRequestTab.tsx`: Monaco JavaScript
- `TestsTab.tsx`: visual assertions + Monaco

### 8. Response Pane
- `ResponsePane.tsx`
- `ResponseMeta.tsx`: status badge + time + size + test badge
- `ResponseBody.tsx`: Monaco readonly, Pretty/Raw/Preview
- `CookieTab.tsx`, `ConsoleTab.tsx`, `ActualRequestTab.tsx`

### 9. Shared Components
- `MethodBadge.tsx` (renk tablosu UI-SPEC.md §1.3)
- `StatusBadge.tsx`
- `KeyValueTable.tsx`
- `MonacoEditor.tsx` (wrapper)
- `EmptyState.tsx`

### 10. Modals
- `ImportModal.tsx`: 16 format, 7 kolonlu grid (SRS §3.15)
- `EnvironmentModal.tsx`

### 11. Environment
- `variable-resolver.ts`: `{{var}}` + `{{$dynamicValue}}` substitution
- `dynamic-values.ts`: tüm $xxx değerleri

### 12. OpenAPI Import
- `src/main/ipc/import-export.handler.ts`: importOpenApi

### 13. Settings
- `SettingsModal.tsx`: tema, font, proxy, SSL, timeout, dil

---

## Faz 2 — SOAP + WebSocket

### 1. SOAP Engine
- `src/main/protocols/soap.engine.ts`
- `docs/java-reference/ConverterWSDL.java` referans al
- `findAllSchemasRecursively()` port et
- SOAP 1.1/1.2 versiyon tespiti
- Envelope üretimi (form schema'dan)
- WS-Security (wsse paketi)

### 2. WSDL IPC Handler
- `wsdl:parse`, `wsdl:generate`, `soap:execute`

### 3. SoapEditor UI
- `src/renderer/components/protocols/SoapEditor.tsx`
- WSDL URL input + Import butonu (loading state)
- Service → Port → Operation dropdown zinciri
- Form modu ↔ Raw XML toggle
- WS-Security accordion (Radix)

### 4. WebSocket Engine + UI
- `src/main/protocols/websocket.engine.ts`
- `src/renderer/components/protocols/WebSocketEditor.tsx`
- Connect/Disconnect, message log (↑↓ renkli), composer

### 5. Postman Import/Export
- importPostman() + exportAsPostman()
- cURL import/export

---

## Faz 3 — Test & Automation

### 1. Test Assertions
- Visual builder: tüm assertion tipleri
- pm API implementasyonu (sandboxed: vm2 veya quickjs)
- Extract Variable (JSONPath, XPath, regex, header)
- `test-runner.ts`

### 2. Code Generation
- `code-generator.ts`: cURL, JS(fetch/axios), Python, Java, Go
- Response paneline "Generate Code" butonu

### 3. Collection Runner
- Sequential execution
- Progress UI
- Report export (JSON + HTML)

---

## Faz 4 — GraphQL + gRPC + SSE

### 1. GraphQL
- `src/main/protocols/graphql.engine.ts`
- `src/renderer/components/protocols/GraphQLEditor.tsx`
- Introspection → şema explorer, query editörü, subscription

### 2. gRPC
- `src/main/protocols/grpc.engine.ts`
- `src/renderer/components/protocols/GrpcEditor.tsx`
- Proto upload, unary call

### 3. SSE
- `src/main/protocols/sse.engine.ts`
- `src/renderer/components/protocols/SseEditor.tsx`
- Event stream viewer

### 4. Dynamic Values
- `dynamic-values.ts`: `{{$randomInt}}`, `{{$timestamp}}` vb.

---

## Faz 5 — Polish

- Auto-update (electron-updater)
- Code signing setup
- Türkçe dil (react-i18next)
- Test raporu HTML/JSON export
- HAR + Insomnia import
- Performance audit (startup, 1000+ endpoint tree)
- gRPC server reflection
- gRPC streaming
