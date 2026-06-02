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

  autoUpdater.on('update-downloaded', (info: unknown) => {
    // `downloadedFile` lands on the info object on Windows/macOS; log it so
    // post-restart support can confirm the installer actually reached disk
    // before quitAndInstall runs (v1.4.4 users hit a state where the old
    // app was removed but the new installer never executed — likely the
    // file was missing or 0 bytes when quitAndInstall fired).
    const downloadedFile =
      info && typeof info === 'object'
        ? ((info as Record<string, unknown>).downloadedFile as string | undefined)
        : undefined
    if (downloadedFile) {
      console.log('[updater] Update downloaded to:', downloadedFile)
    } else {
      console.warn('[updater] update-downloaded fired without downloadedFile')
    }
    sendToAllWindows('updater:event', { type: 'downloaded' })
  })

  autoUpdater.on('error', (err: unknown) => {
    let message = (err as Error).message
    // macOS auto-update needs a signed (ideally notarized) app; an ad-hoc /
    // unsigned build can't self-update and electron-updater fails with a code-
    // signature error. Make that actionable instead of cryptic (issue #34) —
    // the modal already offers a manual-download link.
    if (
      process.platform === 'darwin' &&
      /code sign|signature|not.*valid.*process|could not get/i.test(message)
    ) {
      message =
        'Automatic update is not available for this macOS build (code signature requirement). Please download the latest version manually.'
    }
    sendToAllWindows('updater:event', { type: 'error', error: message })
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
      //
      // Awaited setImmediate: we want quitAndInstall to fire one tick
      // *after* the current event loop turn (so the IPC's own reply
      // serialisation completes first — preserves the v1.4.4 fix), but
      // we ALSO need a synchronous throw from quitAndInstall to come
      // back through this handler as `{ success: false }`. The fire-
      // and-forget `setImmediate(() => …)` we had before resolved the
      // handler with `{ success: true }` even when quitAndInstall
      // immediately threw, so the renderer modal showed "restarting…"
      // forever while the broadcast `error` event was effectively
      // invisible. Awaiting on a Promise that the setImmediate
      // callback resolves/rejects keeps both behaviours.
      await new Promise<void>((resolve, reject) => {
        setImmediate(() => {
          try {
            autoUpdater.quitAndInstall(false, true)
            resolve()
          } catch (err) {
            console.error('[updater] quitAndInstall failed:', (err as Error).message)
            // Broadcast for any other window that may still be alive
            // (a second BrowserWindow), then reject so the IPC reply
            // carries the failure to the modal that triggered it.
            sendToAllWindows('updater:event', {
              type: 'error',
              error: (err as Error).message,
            })
            reject(err)
          }
        })
      })
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
