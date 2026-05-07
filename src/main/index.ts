import { app, shell, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, cpSync, writeFileSync } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from './db/database'
import { registerAllHandlers } from './ipc'
import { initAutoUpdater } from './updater'
import { initLogging } from './diagnostics'
import { maybeInitTelemetry } from './telemetry'

/**
 * Migrate userData from the legacy "Apinizer" directory to the new "Testnizer"
 * one. Runs once before app.whenReady(); writes a marker file so subsequent
 * launches skip this work.
 *
 * Triggered when:
 *   - Old `Apinizer` userData exists (user upgraded from the rebrand)
 *   - New `Testnizer` userData does not exist (fresh install — first launch)
 *   - Migration marker not yet written
 *
 * The migration is non-destructive: the old folder is left in place so the
 * user can roll back manually.
 */
function migrateLegacyUserData(): void {
  // Set app.name first so app.getPath('userData') resolves to "Testnizer".
  app.name = 'Testnizer'

  const newDir = app.getPath('userData')
  const baseDir = join(newDir, '..')
  const oldDir = join(baseDir, 'Apinizer')
  const markerFile = join(newDir, '.migration-from-apinizer')

  if (!existsSync(oldDir)) return
  if (existsSync(markerFile)) return
  if (existsSync(newDir)) {
    // New userData already exists — only migrate if it's empty (e.g. tests
    // create the dir but don't populate it). Skip otherwise to avoid
    // overwriting user data.
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      const entries = fs.readdirSync(newDir).filter((e) => !e.startsWith('.'))
      if (entries.length > 0) return
    } catch {
      return
    }
  }

  try {
    cpSync(oldDir, newDir, { recursive: true, errorOnExist: false })
    writeFileSync(markerFile, new Date().toISOString())
    console.log(`[migration] Copied userData from ${oldDir} to ${newDir}`)
  } catch (err) {
    console.warn(`[migration] Failed: ${(err as Error).message}`)
  }
}

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../resources/icon.png')
  }
  return join(process.resourcesPath, 'resources/icon.png')
}

function createWindow(): BrowserWindow {
  const iconPath = getIconPath()

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
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
    mainWindow.show()
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
ipcMain.handle('app:version', () => {
  try {
    return { success: true, data: { version: app.getVersion(), name: app.name } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
})

ipcMain.handle('app:openExternal', async (_event, url: unknown) => {
  try {
    if (typeof url !== 'string') return { success: false, error: 'invalid url' }
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'unsupported protocol' }
    }
    await shell.openExternal(url)
    return { success: true, data: null }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
})

// Set app name early so macOS dock/menu shows correct name + migrate legacy data
migrateLegacyUserData()
initLogging()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.testnizer.app')

  // Set macOS dock icon
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(getIconPath())
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    } catch {
      // Icon not found — use default
    }
  }

  // Initialize database
  initDatabase()

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

  createWindow()

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
  closeDatabase()
})
