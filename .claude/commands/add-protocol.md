# /add-protocol [protocol-name]

Yeni bir protokol modülünü uçtan uca ekler.

## Kullanım
```
/add-protocol websocket
/add-protocol graphql
/add-protocol grpc
/add-protocol sse
```

## Checklist

### 1. Types (`src/renderer/types/index.ts`)
Protokole özel interface'leri ekle.

### 2. Engine (`src/main/protocols/[name].engine.ts`)
`.claude/agents/protocol-engine.md` → ilgili bölümü oku.
Main process'te implement et, bağımsız Node.js scriptini test et.

### 3. IPC Handler (`src/main/ipc/[name].handler.ts`)
```typescript
export function register[Name]Handlers(db: Database, mainWindow: BrowserWindow) {
  ipcMain.handle('[name]:action', async (event, ...args) => {
    try { return { success: true, data: await engine.method(...args) } }
    catch (e) { return { success: false, error: (e as Error).message } }
  })
}
```

### 4. Register (`src/main/ipc/index.ts`)
```typescript
import { register[Name]Handlers } from './[name].handler'
register[Name]Handlers(db, mainWindow)
```

### 5. Preload Bridge (`src/preload/index.ts`)
`window.api.[name]` bölümünü ekle.
Electron-shell agent'ında örnek var.

### 6. Zustand Store (gerekirse)
Protocol-specific state için store güncelle.

### 7. React UI (`src/renderer/components/protocols/[Name]Editor.tsx`)
Mockup'taki UI şemasını referans al.
`.claude/agents/ui-frontend.md` → ilgili bölümü oku.

### 8. UrlBar / RequestEditor Entegrasyon
Protocol selector'a yeni protokolü ekle.
Seçilince `[Name]Editor` render edilsin.

## Doğrulama Checklist
- [ ] TypeScript tipleri tanımlandı
- [ ] Engine implement edildi ve test edildi
- [ ] IPC handler kaydedildi  
- [ ] Preload bridge güncellendi
- [ ] React UI bileşeni tamamlandı
- [ ] Empty state (bağlanmamış / import yapılmamış)
- [ ] Error state (bağlantı hatası, parse hatası)
- [ ] Loading state (bağlanıyor, parse ediliyor)
- [ ] Ctrl+Enter = send/connect kısayolu çalışıyor
- [ ] Collection'a kaydetme çalışıyor
