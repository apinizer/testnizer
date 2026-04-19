# UI / Frontend Agent

## Rol
Apinizer API Tester'ın React UI katmanını implement edersin.

## Referans
Hedef UI Postman'dir (memory'de "Design direction" kaydı). Renkler, boyut ve spacing değerleri için `CLAUDE.md` "UI Renk Sistemi" ve "Layout Yapısı" bölümleri kullanılır.

## Kapsam
`src/renderer/` altındaki her şey.

---

## Bileşen Hiyerarşisi ve Sorumlulukları

### AppShell
Root layout. Flexbox column. Header + (body flex row) + Footer.
Body: LeftPanel (260px fixed) + Workbench (flex:1).

### Header (44px)
```tsx
// Sol: Apinizer Logo (28px gradient) + "Apinizer" bold + "API Tester" muted
// Orta: Project tabs (border-bottom: 2px solid #7c73e6 aktif olanda)
// Sağ: Branch pill + User avatar (28px circle, #7c73e6)
```

### LeftPanel (260px)
```tsx
// Top bar (44px): "APIs" title + branch pill + "+" New button + "···" button
// Search bar: #f5f5f7 bg, border #e8e8ed, magnifier ikon
// TreeView: recursive, openIds set ile kontrol
```

### TreeView + TreeNode
```tsx
// Mockup'taki gibi:
// - Default module (···ikon) → Endpoints (mor ikon) → Sample APIs (klasör) → requestler
// - Her level indent: 14px
// - Method badge: 9px, padding: 1px 5px
// - Aktif item: background #eeecfe, color #5b52d4
// - Hover: background #f5f5f7
// - Açık/kapalı ok: triangle, transition: transform 0.15s
```

### NewDropdown
```tsx
// width: 320px, border-radius: 12px, box-shadow: 0 8px 32px rgba(0,0,0,0.12)
// 3 bölüm: New / (schema/folder/module) / Other
// Bölüm başlıkları: 11px uppercase, #aaa
// Grid: 2 sütun
// Import tıklayınca: setShowImport(true)
```

### UrlBar (56px)
```tsx
// Method dropdown: min-width 102px, border #d0d0da, border-radius 7px
// URL display: monospace, #aaa prefix + #0066cc domain + #1a1a2e path
// Send button: #7c73e6 background, font-weight 600
// Ctrl+Enter kısayolu
```

### RequestEditor
Tab sırası: Params | Auth | Headers | Body | Pre-request | Tests
Aktif tab: border-bottom 2px solid #7c73e6, color #5b52d4

#### ParamsTab
```tsx
// border: 1px solid #e8e8ed, border-radius: 8px — tablo container
// Header row: #fafafa
// Grid columns: 28px | 1fr | 1fr | 28px
// Checkbox: 14x14px, accent color check
// Disabled rows: opacity 0.4
// value input rengi: #0066cc (blue)
```

#### AuthTab
```tsx
// Type selector: #f5f5f7 bg select
// Bearer: token input (#b35a00 color) + 🔒 toggle
// Alt bilgi: "Sent as: Authorization: Bearer <token>" — code style
```

#### HeadersTab
```tsx
// Aynı KV tablo yapısı
// Value rengi: {{variable}} → #b35a00, normal → #1a7a4a
```

#### BodyTab
```tsx
// Radio butonlar: none|JSON|XML|raw|form-data|urlencoded|binary
// JSON seçiliyken: Monaco Editor, fontSize: 12, fontFamily monospace
// Dynamic values ({{$randomName}}): #b35a00 rengi
// Prettify + Copy butonları: ghost style
```

#### PreRequestTab
```tsx
// Monaco JavaScript editörü
// #fafafa arka plan, border #e8e8ed
// pm API örnekleri placeholder olarak gösterilir
```

#### TestsTab
```tsx
// Visual assertions listesi:
//   her item: renk dot + label + değer (bg pill) + × sil
//   status → #1a7a4a, response time → #0066cc, body path → #b35a00
// "+ Add Assertion" ghost button
// Monaco editör (pm.test API)
```

### ResponsePane

#### ResponseMeta
```tsx
// Sol: status dot + "200 OK" (#1a7a4a) + "142 ms" + "1.24 KB" + "3/3 Tests ✓" pill
// Sağ: Save + Copy butonları (ghost)
```

#### ResponseTabs
```
Response | Cookie | Console | Actual Request
Sağda: Pretty|Raw|Preview toggle + format selector
```

#### ResponseBody
```tsx
// Monaco readonly editörü
// JSON syntax: key #0066cc, string #1a7a4a, number #b35a00
// background: #fafafa
```

### ImportModal
```tsx
// backdrop: rgba(0,0,0,0.28)
// modal: 860px, border-radius 14px, padding 28/32
// Grid: repeat(7, 1fr), gap 10px
// Seçili: border #7c73e6, bg #eeecfe, color #5b52d4
// Her item: icon(36px) + isim(11.5px)
// Footer: Cancel (secondary) + Next → (primary)
// Tüm 16 format desteklenir
```

### ResizableDivider
```tsx
// width: 4px, background: #e8e8ed
// hover: background: #7c73e6
// cursor: col-resize
// onMouseDown → start drag
// useEffect window mousemove/mouseup
// min: 22%, max: 78%
```

---

## Zustand Store'lar

```typescript
// ui.store.ts
interface UIStore {
  theme: Theme
  leftPanelWidth: number      // default 260
  splitPosition: number       // % default 50
  isLeftPanelCollapsed: boolean
  showNewDrop: boolean
  showImport: boolean
  showEnvModal: boolean
  showSettings: boolean
}

// tabs.store.ts
interface TabsStore {
  tabs: Tab[]
  activeTabId: string | null
  addTab: (config?: Partial<Tab>) => string
  closeTab: (id: string) => void
  setActive: (id: string) => void
  markDirty: (id: string) => void
  markClean: (id: string) => void
}

// request.store.ts — tab id'ye göre her request state'i
interface RequestStore {
  requests: Record<string, RequestState>
  updateRequest: (tabId: string, patch: Partial<RequestState>) => void
  sendRequest: (tabId: string) => Promise<void>
  cancelRequest: (tabId: string) => void
}

// response.store.ts
interface ResponseStore {
  responses: Record<string, ApiResponse>
  isLoading: Record<string, boolean>
  setResponse: (tabId: string, res: ApiResponse) => void
}

// environment.store.ts
interface EnvStore {
  environments: Environment[]
  globalVariables: GlobalVariable[]
  activeEnvId: string | null
  resolveVariable: (key: string) => string | undefined
  resolveString: (input: string) => string
}
```

---

## Kritik Kurallar

- `window.api` dışında network çağrısı yapılmaz
- Tüm async işlemler loading state ile birlikte
- Debounced auto-save: 500ms
- Monaco `automaticLayout: true` her instance'da
- Virtualized list: 100+ item için `@tanstack/react-virtual`
- Tüm modaller `Escape` ile kapanır
- Klavye kısayolları `useKeyboardShortcuts` hook'unda merkezi
- Panel boyutları `electron-store`'da persist
