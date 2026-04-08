# Electron Shell Agent

## Rol
Window yönetimi, preload bridge, auto-update, cross-platform packaging.

## Kapsam
`src/main/index.ts`, `src/preload/index.ts`, `electron-builder.config.ts`

---

## Window Konfigürasyonu

```typescript
function createWindow(db: Database.Database) {
  const windowState = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 800 })
  
  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',    // Açık tema — beyaz flash önler
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,     // ZORUNLU
      nodeIntegration: false,     // ZORUNLU
      sandbox: false,
    },
  })

  windowState.manage(mainWindow)

  // Dış linkleri system browser'da aç
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}
```

---

## Preload Bridge (`src/preload/index.ts`)

Tüm `window.api` metodları burada tanımlanır.

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {

  // ─── Request Execution ───────────────────────────────────
  request: {
    send:   (opts) => ipcRenderer.invoke('request:send', opts),
    cancel: (id)   => ipcRenderer.invoke('request:cancel', id),
  },

  // ─── WSDL / SOAP ─────────────────────────────────────────
  wsdl: {
    parse:    (urlOrPath)        => ipcRenderer.invoke('wsdl:parse', urlOrPath),
    generate: (op, params, ns, v)=> ipcRenderer.invoke('wsdl:generate', op, params, ns, v),
    execute:  (opts)             => ipcRenderer.invoke('soap:execute', opts),
  },

  // ─── WebSocket ────────────────────────────────────────────
  websocket: {
    connect:    (id, url, headers) => ipcRenderer.invoke('ws:connect', id, url, headers),
    send:       (id, msg)          => ipcRenderer.invoke('ws:send', id, msg),
    disconnect: (id)               => ipcRenderer.invoke('ws:disconnect', id),
    onOpen:     (cb) => { ipcRenderer.on('ws:open',    (_, id)      => cb(id));      return () => ipcRenderer.removeAllListeners('ws:open')    },
    onMessage:  (cb) => { ipcRenderer.on('ws:message', (_, id, msg) => cb(id, msg)); return () => ipcRenderer.removeAllListeners('ws:message') },
    onClose:    (cb) => { ipcRenderer.on('ws:close',   (_, id)      => cb(id));      return () => ipcRenderer.removeAllListeners('ws:close')   },
    onError:    (cb) => { ipcRenderer.on('ws:error',   (_, id, err) => cb(id, err)); return () => ipcRenderer.removeAllListeners('ws:error')   },
  },

  // ─── SSE ─────────────────────────────────────────────────
  sse: {
    connect:    (id, url, headers) => ipcRenderer.invoke('sse:connect', id, url, headers),
    disconnect: (id)               => ipcRenderer.invoke('sse:disconnect', id),
    onEvent:    (cb) => { ipcRenderer.on('sse:event', (_, id, evt) => cb(id, evt)); return () => ipcRenderer.removeAllListeners('sse:event') },
  },

  // ─── GraphQL ──────────────────────────────────────────────
  graphql: {
    introspect: (url, headers)          => ipcRenderer.invoke('gql:introspect', url, headers),
    query:      (url, q, vars, headers) => ipcRenderer.invoke('gql:query', url, q, vars, headers),
    subscribe:  (id, url, q, vars, h)   => ipcRenderer.invoke('gql:subscribe', id, url, q, vars, h),
    unsubscribe:(id)                    => ipcRenderer.invoke('gql:unsubscribe', id),
    onData:     (cb) => { ipcRenderer.on('gql:data', (_, id, data) => cb(id, data)); return () => ipcRenderer.removeAllListeners('gql:data') },
  },

  // ─── gRPC ─────────────────────────────────────────────────
  grpc: {
    loadProto: (filePath) => ipcRenderer.invoke('grpc:load-proto', filePath),
    call:      (opts)     => ipcRenderer.invoke('grpc:call', opts),
  },

  // ─── Workspaces ───────────────────────────────────────────
  workspaces: {
    list:   ()            => ipcRenderer.invoke('workspaces:list'),
    create: (data)        => ipcRenderer.invoke('workspaces:create', data),
    update: (id, patch)   => ipcRenderer.invoke('workspaces:update', id, patch),
    delete: (id)          => ipcRenderer.invoke('workspaces:delete', id),
  },

  // ─── Projects ─────────────────────────────────────────────
  projects: {
    list:   (workspaceId) => ipcRenderer.invoke('projects:list', workspaceId),
    create: (data)        => ipcRenderer.invoke('projects:create', data),
    update: (id, patch)   => ipcRenderer.invoke('projects:update', id, patch),
    delete: (id)          => ipcRenderer.invoke('projects:delete', id),
  },

  // ─── Endpoints ────────────────────────────────────────────
  endpoints: {
    list:   (projectId) => ipcRenderer.invoke('endpoints:list', projectId),
    get:    (id)        => ipcRenderer.invoke('endpoints:get', id),
    save:   (data)      => ipcRenderer.invoke('endpoints:save', data),
    delete: (id)        => ipcRenderer.invoke('endpoints:delete', id),
    move:   (id, folderId) => ipcRenderer.invoke('endpoints:move', id, folderId),
  },

  // ─── Saved Requests ───────────────────────────────────────
  savedRequests: {
    list:   (projectId) => ipcRenderer.invoke('saved-requests:list', projectId),
    get:    (id)        => ipcRenderer.invoke('saved-requests:get', id),
    save:   (data)      => ipcRenderer.invoke('saved-requests:save', data),
    delete: (id)        => ipcRenderer.invoke('saved-requests:delete', id),
  },

  // ─── Environments ─────────────────────────────────────────
  environments: {
    list:      (workspaceId) => ipcRenderer.invoke('environments:list', workspaceId),
    save:      (data)        => ipcRenderer.invoke('environments:save', data),
    setActive: (id)          => ipcRenderer.invoke('environments:set-active', id),
    delete:    (id)          => ipcRenderer.invoke('environments:delete', id),
  },

  // ─── History ──────────────────────────────────────────────
  history: {
    list:  (workspaceId, filters) => ipcRenderer.invoke('history:list', workspaceId, filters),
    clear: (workspaceId)          => ipcRenderer.invoke('history:clear', workspaceId),
  },

  // ─── Import / Export ──────────────────────────────────────
  importExport: {
    importFile:    (format, filePath, projectId) => ipcRenderer.invoke('import:file', format, filePath, projectId),
    importUrl:     (format, url, projectId)      => ipcRenderer.invoke('import:url', format, url, projectId),
    importCurl:    (curlStr)                     => ipcRenderer.invoke('import:curl', curlStr),
    exportProject: (projectId, format)           => ipcRenderer.invoke('export:project', projectId, format),
  },

  // ─── File Dialogs ─────────────────────────────────────────
  dialog: {
    openFile:  (filters) => ipcRenderer.invoke('dialog:open-file', filters),
    saveFile:  (name, content) => ipcRenderer.invoke('dialog:save-file', name, content),
    openDir:   ()        => ipcRenderer.invoke('dialog:open-dir'),
  },

  // ─── App ──────────────────────────────────────────────────
  app: {
    version:      ()         => ipcRenderer.invoke('app:version'),
    checkUpdate:  ()         => ipcRenderer.invoke('app:check-update'),
    getSettings:  ()         => ipcRenderer.invoke('app:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('app:save-settings', settings),
    onUpdateAvailable: (cb) => { ipcRenderer.on('update:available', (_, info) => cb(info)); return () => ipcRenderer.removeAllListeners('update:available') },
    onUpdateReady: (cb)     => { ipcRenderer.on('update:ready', (_, info) => cb(info));     return () => ipcRenderer.removeAllListeners('update:ready')     },
  },
})
```

---

## electron-builder Config

```typescript
// electron-builder.config.ts
import type { Configuration } from 'electron-builder'

const config: Configuration = {
  appId: 'com.apinizer.api-tester',
  productName: 'Apinizer API Tester',
  copyright: 'Copyright © 2025 Pruvasoft',
  directories: { output: 'dist-electron', buildResources: 'build' },
  files: ['dist/**'],
  
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    installerLanguages: ['tr_TR', 'en_US'],
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    icon: 'build/icon.icns',
    category: 'public.app-category.developer-tools',
  },
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'build/icons',
    category: 'Development',
  },
  publish: {
    provider: 'github',
    owner: 'apinizer',
    repo: 'api-tester',
  },
}

export default config
```

---

## Cross-Platform Notlar

- `path.join()` her zaman — hardcode `/` veya `\\` yasak
- `app.getPath('userData')` — her zaman (hardcode path yasak)
- `process.platform === 'darwin'` → macOS, `'win32'` → Windows
- macOS: `titleBarStyle: 'hiddenInset'` — native traffic lights
- Windows: NSIS installer — start menu + desktop shortcut
- Linux: AppImage (kurulum gerektirmez) + .deb
