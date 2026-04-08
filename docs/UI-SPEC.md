# UI Tasarım Spesifikasyonu
# Apinizer API Tester

**KESİN REFERANS:** `docs/mockups/ApinizerApiTesterLight.jsx`
Tüm boyutlar, renkler ve davranışlar bu dosyadan alınmıştır.

---

## 1. Renk Sistemi

### 1.1 Açık Tema (default)

```css
:root[data-theme="light"] {
  --bg:           #f5f5f7;
  --white:        #ffffff;
  --border:       #e8e8ed;
  --border2:      #d0d0da;
  --text:         #1a1a2e;
  --muted:        #888888;
  --hint:         #bbbbbb;
  --accent:       #7c73e6;
  --accent-light: #eeecfe;
  --accent-text:  #5b52d4;
  --surface:      #fafafa;
  --green:        #1a7a4a;
  --green-bg:     #e8f9f1;
  --green-border: #b3e5cc;
  --blue:         #0066cc;  /* JSON key */
  --orange:       #b35a00;  /* variable/string */
  --red:          #cc2200;
}
```

### 1.2 Koyu Tema

```css
:root[data-theme="dark"] {
  --bg:           #13131f;
  --white:        #1e1e2e;
  --border:       rgba(255,255,255,0.07);
  --border2:      rgba(255,255,255,0.12);
  --text:         #e2e2f0;
  --muted:        #8888aa;
  --hint:         #555570;
  --accent:       #7c73e6;
  --accent-light: rgba(124,115,230,0.15);
  --accent-text:  #a09af8;
  --surface:      #20203a;
  --green:        #49cc90;
  --green-bg:     rgba(73,204,144,0.12);
  --blue:         #61affe;
  --orange:       #fca130;
}
```

### 1.3 Method Badge Renkleri

```typescript
const METHOD_COLORS = {
  GET:     { bg: '#e8f4ff', color: '#0066cc', border: '#b3d4f5' },
  POST:    { bg: '#e8f9f1', color: '#1a7a4a', border: '#b3e5cc' },
  PUT:     { bg: '#fff4e0', color: '#b35a00', border: '#f5d4a0' },
  PATCH:   { bg: '#f0faf5', color: '#0a7a5a', border: '#a0e0c8' },
  DELETE:  { bg: '#fff0f0', color: '#cc2200', border: '#f5b3b3' },
  HEAD:    { bg: '#f5f0ff', color: '#6600cc', border: '#d4b3f5' },
  OPTIONS: { bg: '#f0f5ff', color: '#0044aa', border: '#b3c4f5' },
}
```

---

## 2. Layout Boyutları

```
Header height:          44px
Left panel width:       260px (min: 180px, max: 400px, resizable)
Left panel top bar:     44px
URL bar height:         56px
Response/Request split: 50%/50% default (draggable divider, min 22%, max 78%)
Footer height:          28px
Divider width:          4px
```

---

## 3. Tipografi

```css
/* UI chrome */
font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
font-size: 13px;
line-height: 1.5;

/* Kod editörleri + monospace alanlar */
font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', monospace;
font-size: 12px;
line-height: 1.85;
```

---

## 4. Bileşen Spesifikasyonları

### 4.1 Apinizer Logo (Header Sol)
```
width: 28px, height: 28px
border-radius: 7px
background: linear-gradient(135deg, #7c73e6, #5040c8)
İkon: API bağlantı sembolü (beyaz)
Yanında: "Apinizer" bold 13.5px + "API Tester" 10px muted
```

### 4.2 Branch Pill
```
background: #f5f5f7
border: 1px solid #d0d0da
border-radius: 20px
padding: 4px 10px
font-size: 12px
İçerik: branch ikon + "main" + chevron
```

### 4.3 MethodBadge Component
```tsx
// Normal boyut
<span style={{
  background: c.bg, color: c.color, border: `1px solid ${c.border}`,
  borderRadius: 4, padding: "2px 8px",
  fontSize: 11, fontWeight: 700, fontFamily: "monospace",
  letterSpacing: "0.02em"
}}>GET</span>

// Küçük (tree item'larda)
// fontSize: 9px, padding: "1px 5px"
```

### 4.4 StatusBadge Component
```tsx
// 200 OK
color: #1a7a4a
dot: 8px daire, #1a7a4a arka plan
font-weight: 700, font-size: 13px

// Renk kuralı:
// 2xx → #1a7a4a (yeşil)
// 3xx → #0066cc (mavi)
// 4xx → #b35a00 (turuncu)
// 5xx → #cc2200 (kırmızı)
```

### 4.5 Test Badge
```tsx
// "3/3 Tests ✓"
background: #e8f9f1
color: #1a7a4a
border: 1px solid #b3e5cc
border-radius: 10px
padding: 2px 9px
font-size: 11px, font-weight: 500
```

### 4.6 KeyValueTable Component
```tsx
// Mockup'taki tablo yapısı:
// Grid: 28px | 1fr | 1fr | 28px
// Header row: #fafafa arka plan
// Her satır: checkbox + key input + value input + sil
// Checkbox: 14x14px, border-radius: 3px, accent color
// Disabled row: opacity: 0.4
// Border: 1px solid #e8e8ed, border-radius: 8px (container)
```

### 4.7 MonacoEditor Wrapper
```typescript
const MONACO_OPTIONS = {
  minimap: { enabled: false },
  lineNumbers: 'on',
  folding: true,
  wordWrap: 'on',
  fontSize: 12,
  fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
  fontLigatures: true,
  padding: { top: 12, bottom: 12 },
  scrollBeyondLastLine: false,
  automaticLayout: true,      // ZORUNLU — resizable paneller için
  renderLineHighlight: 'line',
  smoothScrolling: true,
}

// Açık tema: 'vs'
// Koyu tema: 'vs-dark' (özel 'apidog-dark' tercihen)
// Response viewer: readOnly: true, lineNumbers: 'off'
```

### 4.8 New Dropdown
```
width: 320px
border-radius: 12px
border: 1px solid #e8e8ed
padding: 12px
box-shadow: 0 8px 32px rgba(0,0,0,0.12)
animation: slideDown 0.15s ease

Section titles: 11px uppercase, #aaa, letter-spacing: 0.06em
Item: icon(28x28) + label, hover: #f5f5f7 background
Grid: 2 sütun
Separator: border-top: 1px solid #f0f0f5
```

### 4.9 Import Modal
```
backdrop: rgba(0,0,0,0.28)
modal: 860px wide, border-radius: 14px, padding: 28px 32px
box-shadow: 0 20px 60px rgba(0,0,0,0.15)

Grid: repeat(7, 1fr), gap: 10px
Her format item:
  border: 1.5px solid #e8e8ed
  border-radius: 10px
  padding: 14px 8px 12px
  font-size: 11.5px, text-align: center
  Seçili: border-color: #7c73e6, background: #eeecfe, color: #5b52d4

Format icon: 36x36px, border-radius: 8px
```

### 4.10 Buton Stilleri
```tsx
// Primary (Send, Import, Next)
background: #7c73e6, border: none, border-radius: 7px
color: white, font-weight: 600, font-size: 13px
padding: 7px 18px
hover: background: #6560d4

// Secondary (Save, Cancel)
background: #ffffff, border: 1.5px solid #d0d0da
border-radius: 7px, color: #555, font-size: 13px
padding: 6px 12px
hover: background: #f5f5f7

// Ghost (ikon butonlar, "···")
background: transparent, border: 1px solid #e0e0ea
border-radius: 6px, color: #777, font-size: 12px
padding: 4px 8px
```

---

## 5. Animasyonlar

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes slideDown {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* Dropdown, modal: fadeIn 0.15-0.2s ease */
/* Klasör ok: transition: transform 0.15s */
/* Panel genişlik: transition: width 0.2s ease */
/* Buton hover: transition: all 0.15s */
```

**Yasak:** bounce, elastik, 300ms+ animasyonlar.

---

## 6. Klavye Kısayolları

| Eylem | Windows/Linux | macOS |
|---|---|---|
| Send request | Ctrl+Enter | Cmd+Enter |
| Save request | Ctrl+S | Cmd+S |
| New tab | Ctrl+T | Cmd+T |
| Close tab | Ctrl+W | Cmd+W |
| Focus URL | Ctrl+L | Cmd+L |
| New item | Ctrl+N | Cmd+N |
| Import | Ctrl+O | Cmd+O |
| Import cURL | Ctrl+I | Cmd+I |
| Toggle sidebar | Ctrl+B | Cmd+B |
| Settings | Ctrl+, | Cmd+, |
| Format body | Ctrl+Shift+F | Cmd+Shift+F |

---

## 7. Responsive Davranış

- Minimum pencere: 900×600px
- Satır height: 32-36px
- Input height: 32px
- Buton height: 30-34px
- Tree item padding: 4px 10px (hover: #f5f5f7)
- Virtualized list: 100+ item için `@tanstack/react-virtual`

---

## 8. Scrollbar Stili

```css
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
/* Koyu temada: rgba(255,255,255,0.12) */
```
