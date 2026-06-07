import {
  app,
  shell,
  dialog,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase, type InitDatabaseResult } from './db/database'
import { registerAllHandlers } from './ipc'
import { initAutoUpdater } from './updater'
import { initLogging } from './diagnostics'
import { maybeInitTelemetry } from './telemetry'
import { disconnectAll as wsDisconnectAll } from './protocols/websocket.engine'
import { mcpDisconnectAll } from './protocols/mcp.engine'
import pkg from '../../package.json'

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../resources/icon.png')
  }
  return join(process.resourcesPath, 'resources/icon.png')
}

function createWindow(): BrowserWindow {
  const iconPath = getIconPath()
  const headless = process.env.E2E_HEADLESS === '1'

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    skipTaskbar: headless,
    title: 'Testnizer',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !is.dev,
    },
  })

  mainWindow.on('ready-to-show', () => {
    if (!headless) {
      mainWindow.show()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Only allow http(s) URLs to be opened in the system browser.
    // Reject file://, javascript:, and any other schemes to prevent the
    // renderer from triggering OS handlers with untrusted content.
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Malformed URL — ignore.
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// Window control IPC handler — registered once, resolves target window dynamically.
// Placing this inside createWindow() caused duplicate-handler errors when
// reopening the window from the dock (macOS).
ipcMain.handle('window:toggleMaximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { success: false, error: 'No window' }
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
  return { success: true }
})

// App metadata + safe external URL opener (used by About modal etc.)
// Prefer package.json (bundled at build time) over app.getVersion() so the
// About modal never falls back to Electron's own "1.0.0" string when the
// runtime app version lookup misbehaves under dev/launcher rename.
ipcMain.handle('app:version', () => {
  try {
    const runtimeVersion = (() => {
      try {
        return app.getVersion()
      } catch {
        return ''
      }
    })()
    const version = pkg.version || runtimeVersion || 'unknown'
    return { success: true, data: { version, name: app.name } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
})

ipcMain.handle('app:openExternal', async (_event, url: unknown) => {
  try {
    if (typeof url !== 'string') return { success: false, error: 'invalid url' }
    const parsed = new URL(url)
    // Only allow http/https for browsing and mailto: for the enterprise
    // contact link in the About modal. Anything else (file:, javascript:,
    // shell:) is rejected — the renderer must never trigger arbitrary OS
    // handlers.
    const allowed =
      parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
    if (!allowed) {
      return { success: false, error: 'unsupported protocol' }
    }
    await shell.openExternal(url)
    return { success: true, data: null }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
})

// Set app name early so macOS dock/menu shows correct name + userData path resolves.
app.name = 'Testnizer'
initLogging()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.testnizer.app')

  // Headless E2E: keep the app off-screen and out of the dock so Playwright
  // can drive the UI without stealing focus from the developer's desktop.
  if (process.env.E2E_HEADLESS === '1' && process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  } else if (process.platform === 'darwin' && app.dock) {
    // Set macOS dock icon
    try {
      const dockIcon = nativeImage.createFromPath(getIconPath())
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    } catch {
      // Icon not found — use default
    }
  }

  // Override the macOS / Linux application menu so the standard "About
  // Testnizer" item opens our in-app AboutModal instead of Electron's
  // default About panel — the native panel renders Electron's atom logo
  // (iconPath on setAboutPanelOptions is ignored on macOS) and the
  // Electron framework version, neither of which we want users to see.
  // Custom menu also lets the rest of the chrome stay default (services,
  // hide, quit, edit/window/help) without rebuilding every role manually.
  function broadcastOpenAbout(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('menu:openAbout')
    }
  }
  function broadcastMenuEvent(channel: string): void {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (target && !target.isDestroyed()) target.webContents.send(channel)
  }
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'Testnizer',
            submenu: [
              { label: 'About Testnizer', click: broadcastOpenAbout },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        // No `accelerator:` fields below: when Electron registers an
        // accelerator on a menu item it ALSO swallows the key chord and
        // fires the click handler — but the renderer's window keydown
        // listener (`useKeyboardShortcuts`) still runs in parallel, so
        // Ctrl+T opened two tabs and Ctrl+W closed two. We keep the
        // menu items as clickable shortcuts (and surface the chord as a
        // visible hint via `\t…`), and let the renderer keyboard
        // listener own the actual key handling. Apidog/Postman/Insomnia
        // all do this for the same reason. The chord label must match
        // the platform — renderer's keyboard handler uses
        // `e.metaKey` on macOS, so Mac users see "Cmd+T", not "Ctrl+T".
        {
          label: isMac ? 'New Tab\tCmd+T' : 'New Tab\tCtrl+T',
          click: () => broadcastMenuEvent('menu:newTab'),
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            void createWindow()
          },
        },
        { type: 'separator' },
        {
          label: isMac ? 'Import…\tCmd+O' : 'Import…\tCtrl+O',
          click: () => broadcastMenuEvent('menu:openImport'),
        },
        {
          label: 'Export…',
          click: () => broadcastMenuEvent('menu:openExport'),
        },
        { type: 'separator' },
        {
          label: isMac ? 'Save\tCmd+S' : 'Save\tCtrl+S',
          click: () => broadcastMenuEvent('menu:save'),
        },
        {
          label: isMac ? 'Settings…\tCmd+,' : 'Settings…\tCtrl+,',
          click: () => broadcastMenuEvent('menu:openSettings'),
        },
        { type: 'separator' },
        {
          label: isMac ? 'Close Tab\tCmd+W' : 'Close Tab\tCtrl+W',
          click: () => broadcastMenuEvent('menu:closeTab'),
        },
        ...(isMac
          ? ([] satisfies MenuItemConstructorOptions[])
          : [{ role: 'quit' as const, label: 'Exit' }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...(isMac
          ? []
          : ([
              { label: 'About Testnizer', click: broadcastOpenAbout },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  // Initialize database. A corrupt on-disk DB file is recovered transparently
  // (the corrupt file is backed up with a `.corrupt-<ts>` suffix and a fresh
  // DB is created). If even that fails, we must NOT die silently with no
  // window — show an error box and quit gracefully. Recovery is reported to
  // the user via a dialog AFTER the window appears (see below).
  let dbInit: InitDatabaseResult
  try {
    dbInit = initDatabase()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // Under headless E2E a native modal has no one to dismiss it and would
    // flood the desktop with one blocking box per worker launch — log + quit
    // instead. The error still fails the run loudly via the missing window.
    if (process.env.E2E_HEADLESS === '1') {
      console.error(`[db] could not open or recover the database: ${detail}`)
    } else {
      dialog.showErrorBox(
        'Testnizer — Database error',
        `Testnizer could not open or recover its local database and has to close.\n\n${detail}\n\n` +
          `Your data folder is:\n${app.getPath('userData')}`,
      )
    }
    app.quit()
    return
  }

  // Register all IPC handlers
  registerAllHandlers()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize auto-updater
  initAutoUpdater().catch((err) => {
    console.error('Failed to initialize auto-updater:', (err as Error).message)
  })

  // Telemetry: only fires if the user previously opted in via Settings.
  // We read the persisted flag synchronously through electron-store to avoid
  // a race where crashes early in startup miss the SDK init.
  ;(async () => {
    try {
      const { default: Store } = await import('electron-store')
      type SettingsStore = { get: (k: string, def: unknown) => unknown }
      const store = new Store({ name: 'settings' }) as unknown as SettingsStore
      const enabled = store.get('telemetryEnabled', false) as boolean
      await maybeInitTelemetry(!!enabled)
    } catch {
      // Settings file missing or corrupt — telemetry stays off.
    }
  })()

  const mainWindow = createWindow()

  // If the DB was corrupt and we recovered, tell the user — but only AFTER the
  // window exists, never before (a pre-window modal would look like a crash).
  // We wait for ready-to-show so the dialog is parented to a visible window.
  // Skipped under headless E2E: a modal sheet there would hang the automated
  // run with no one to dismiss it; the E2E asserts recovery via the backup
  // file + working IPC bridge instead.
  if (dbInit.recovered && process.env.E2E_HEADLESS !== '1') {
    mainWindow.once('ready-to-show', () => {
      const win = mainWindow.isDestroyed() ? undefined : mainWindow
      const backupNote = dbInit.backupPath
        ? `\n\nA backup of the corrupt file was saved to:\n${dbInit.backupPath}`
        : ''
      const options = {
        type: 'warning' as const,
        title: 'Testnizer — Database recovered',
        message: 'Your local database was corrupted and could not be opened.',
        detail:
          'Testnizer backed up the corrupt file and started with a fresh database, ' +
          `so the app is now usable. Some previously saved data may be missing.${backupNote}`,
        buttons: ['OK'],
      }
      if (win) {
        void dialog.showMessageBox(win, options)
      } else {
        void dialog.showMessageBox(options)
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Tear down long-lived connections before the DB so any final writes
  // (e.g. WS disconnect side-effects) still have a working repo.
  try {
    wsDisconnectAll()
  } catch {
    /* ignore — best-effort cleanup */
  }
  try {
    mcpDisconnectAll()
  } catch {
    /* ignore */
  }
  closeDatabase()
})
