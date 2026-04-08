import { app, shell, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDatabase, closeDatabase } from './db/database'
import { registerAllHandlers } from './ipc'
import { initAutoUpdater } from './updater'

function getIconPath(): string {
  if (is.dev) {
    return join(__dirname, '../../resources/icon.png')
  }
  return join(process.resourcesPath, 'resources/icon.png')
}

function createWindow(): void {
  const iconPath = getIconPath()

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Apinizer API Tester',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !is.dev
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Window control IPC handlers
  ipcMain.handle('window:toggleMaximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    return { success: true }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Set app name early so macOS dock/menu shows correct name
app.name = 'Apinizer API Tester'

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.apinizer.api-tester')

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
