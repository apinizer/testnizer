import { BrowserWindow, ipcMain } from 'electron'

interface UpdateInfo {
  version: string
  releaseNotes?: string | Array<{ version: string; note: string }>
}

interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

type AutoUpdaterModule = {
  autoUpdater: {
    checkForUpdates(): Promise<unknown>
    downloadUpdate(): Promise<unknown>
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
    on(event: string, listener: (...args: unknown[]) => void): void
    autoDownload: boolean
    autoInstallOnAppQuit: boolean
  }
}

function sendToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

export async function initAutoUpdater(): Promise<void> {
  let autoUpdater: AutoUpdaterModule['autoUpdater']

  try {
    const mod = await import('electron-updater')
    // Handle both ESM default export and named export patterns
    const resolved =
      (mod as Record<string, unknown>).autoUpdater ??
      ((mod as Record<string, unknown>).default as Record<string, unknown>)?.autoUpdater ??
      (mod as Record<string, unknown>).default
    autoUpdater = resolved as AutoUpdaterModule['autoUpdater']

    if (!autoUpdater || typeof autoUpdater.on !== 'function') {
      console.warn('Auto-updater: module loaded but autoUpdater object not found')
      registerStubHandlers()
      return
    }
  } catch (err) {
    console.warn('Auto-updater not available:', (err as Error).message)
    registerStubHandlers()
    return
  }

  // Do not auto-download; let the user decide
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // ─── Forward events to renderer ─────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    sendToAllWindows('updater:event', { type: 'checking' })
  })

  autoUpdater.on('update-available', (info: unknown) => {
    const updateInfo = info as UpdateInfo
    sendToAllWindows('updater:event', {
      type: 'available',
      version: updateInfo.version,
      releaseNotes: updateInfo.releaseNotes,
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendToAllWindows('updater:event', { type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress: unknown) => {
    const prog = progress as DownloadProgress
    sendToAllWindows('updater:event', {
      type: 'downloading',
      percent: prog.percent,
      bytesPerSecond: prog.bytesPerSecond,
      transferred: prog.transferred,
      total: prog.total,
    })
  })

  autoUpdater.on('update-downloaded', () => {
    sendToAllWindows('updater:event', { type: 'downloaded' })
  })

  autoUpdater.on('error', (err: unknown) => {
    sendToAllWindows('updater:event', {
      type: 'error',
      error: (err as Error).message,
    })
  })

  // ─── IPC handlers ───────────────────────────────────────────

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('updater:install', async () => {
    try {
      // isSilent=false: show the NSIS wizard so the user sees install
      //   progress + any error dialog (a silent failure used to leave the
      //   user with the app fully uninstalled, no UI, no clue why
      //   v1.4.4 → v1.4.5 hotfix).
      // isForceRunAfter=true: relaunch the app once install completes.
      autoUpdater.quitAndInstall(false, true)
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // NOTE: Automatic update polling is intentionally disabled.
  // This application runs fully offline by default; updates must be
  // triggered manually by the user through the Settings UI.
}

function registerStubHandlers(): void {
  ipcMain.handle('updater:check', async () => ({
    success: false,
    error: 'Auto-updater not configured',
  }))
  ipcMain.handle('updater:download', async () => ({
    success: false,
    error: 'Auto-updater not configured',
  }))
  ipcMain.handle('updater:install', async () => ({
    success: false,
    error: 'Auto-updater not configured',
  }))
}
