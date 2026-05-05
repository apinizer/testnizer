/**
 * Diagnostics + logging utilities.
 *
 * - electron-log writes rotated logs into `userData/logs/main.log`.
 * - `diagnostics:export` packages those logs + a small environment summary
 *   into a zip the user can attach to a support ticket.
 *
 * No telemetry is sent automatically — the user must explicitly trigger an
 * export and choose where to save it.
 */

import { app, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const log = require('electron-log/main') as {
  initialize: (opts?: { preload?: boolean; spyRendererConsole?: boolean }) => void
  transports: {
    file: { resolvePathFn?: (vars: { electronDefaultDir?: string }) => string; level: string }
    console: { level: string }
  }
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver') as (
  format: string,
  opts?: { zlib?: { level?: number } },
) => {
  pipe: (s: NodeJS.WritableStream) => unknown
  file: (path: string, opts: { name: string }) => unknown
  append: (data: string | Buffer, opts: { name: string }) => unknown
  finalize: () => Promise<void>
  on: (event: string, listener: (err: Error) => void) => void
  pointer: () => number
}

let initialized = false

export function initLogging(): void {
  if (initialized) return
  initialized = true

  log.initialize({ preload: true, spyRendererConsole: true })

  // Logs go to userData/logs/{main,renderer}.log so they are easy to find
  // across platforms via the same `diagnostics:reveal` handler.
  log.transports.file.resolvePathFn = ({ electronDefaultDir }) => {
    const dir = electronDefaultDir ?? path.join(app.getPath('userData'), 'logs')
    return path.join(dir, 'main.log')
  }
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'debug'

  log.info('[diagnostics] electron-log initialized')
}

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function envSummary(): string {
  const lines: string[] = []
  lines.push(`Testnizer ${app.getVersion()}`)
  lines.push(`Platform: ${process.platform} ${os.release()} (${process.arch})`)
  lines.push(`Electron: ${process.versions.electron ?? 'n/a'}`)
  lines.push(`Node: ${process.versions.node}`)
  lines.push(`Chromium: ${process.versions.chrome ?? 'n/a'}`)
  lines.push(`V8: ${process.versions.v8 ?? 'n/a'}`)
  lines.push(`Locale: ${app.getLocale()}`)
  lines.push(`UserData: ${app.getPath('userData')}`)
  lines.push(`Generated: ${new Date().toISOString()}`)
  return lines.join('\n')
}

async function buildArchive(targetPath: string): Promise<{ size: number }> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(targetPath)
    const arch = archiver('zip', { zlib: { level: 9 } })

    out.on('close', () => resolve({ size: arch.pointer() }))
    arch.on('error', (err) => reject(err))
    arch.pipe(out)

    // Include all rotated log files if present
    const dir = logsDir()
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        const abs = path.join(dir, entry)
        if (fs.statSync(abs).isFile()) {
          arch.file(abs, { name: `logs/${entry}` })
        }
      }
    }

    arch.append(envSummary(), { name: 'environment.txt' })
    arch.finalize().catch(reject)
  })
}

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle('diagnostics:export', async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Save Testnizer diagnostics bundle',
        defaultPath: `testnizer-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
        filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      })
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' }
      }
      const { size } = await buildArchive(result.filePath)
      return { success: true, data: { path: result.filePath, size } }
    } catch (e) {
      log.error('[diagnostics] export failed', (e as Error).message)
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('diagnostics:reveal', async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shell } = require('electron') as typeof import('electron')
      shell.openPath(logsDir())
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('diagnostics:thirdPartyLicenses', async () => {
    try {
      const candidates = [
        path.join(app.getAppPath(), '..', 'resources', 'third-party-licenses.json'),
        path.join(app.getAppPath(), 'resources', 'third-party-licenses.json'),
        path.join(__dirname, '..', '..', 'resources', 'third-party-licenses.json'),
      ]
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const json = JSON.parse(fs.readFileSync(candidate, 'utf8'))
          return { success: true, data: json }
        }
      }
      return { success: false, error: 'third-party-licenses.json not found in packaged resources' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
