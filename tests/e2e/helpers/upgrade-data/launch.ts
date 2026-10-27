/**
 * Issue #291 — launch either THIS build or an older one on a given userData.
 *
 * An older build is a directory holding its own `out/main/index.js` and its
 * own `node_modules/electron` (so it runs on ITS Electron, e.g. 33), pointed at
 * by `TESTNIZER_OLD_BUILD_DIR`.
 *
 * Both sides get the same keychain switch so safeStorage is deterministic and
 * never touches the developer's real keychain:
 *   - macOS: `--use-mock-keychain` (Chromium's fixed test key). The REAL
 *     keychain path is a manual RC check (docs/e2e/electron-upgrade-data.md).
 *   - Linux: `--password-store=basic` (Chromium's built-in v10 key), the
 *     backend a desktop without a keyring falls back to anyway.
 *   - Windows: DPAPI, no switch needed and no prompt.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanLaunchEnv, firstAppWindow } from '../electron-env'

export interface BuildUnderTest {
  label: string
  /** package.json version of that build. */
  version: string
  mainPath: string
  /** Electron binary; omitted = the one in this checkout's node_modules. */
  executablePath?: string
}

export const CURRENT_BUILD: BuildUnderTest = {
  label: 'current',
  version: (
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8')) as {
      version: string
    }
  ).version,
  mainPath: path.resolve(__dirname, '../../../../out/main/index.js'),
}

/** The older build named by TESTNIZER_OLD_BUILD_DIR, or null when unset. */
export function oldBuildFromEnv(): BuildUnderTest | null {
  const dir = process.env.TESTNIZER_OLD_BUILD_DIR
  if (!dir) return null
  const mainPath = path.join(dir, 'out', 'main', 'index.js')
  const pathTxt = path.join(dir, 'node_modules', 'electron', 'path.txt')
  if (!fs.existsSync(mainPath) || !fs.existsSync(pathTxt)) {
    throw new Error(
      `TESTNIZER_OLD_BUILD_DIR=${dir} needs out/main/index.js and node_modules/electron`,
    )
  }
  const exe = path.join(
    dir,
    'node_modules',
    'electron',
    'dist',
    fs.readFileSync(pathTxt, 'utf8').trim(),
  )
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    version: string
  }
  return {
    label: process.env.TESTNIZER_OLD_BUILD_LABEL ?? 'old',
    version,
    mainPath,
    executablePath: exe,
  }
}

export function keychainArgs(): string[] {
  if (process.platform === 'darwin') return ['--use-mock-keychain']
  if (process.platform === 'linux') return ['--password-store=basic']
  return []
}

export async function launchBuild(
  build: BuildUnderTest,
  userDataDir: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    ...(build.executablePath ? { executablePath: build.executablePath } : {}),
    args: [build.mainPath, `--user-data-dir=${userDataDir}`, ...keychainArgs()],
    env: cleanLaunchEnv(),
  })
  const page = await firstAppWindow(app)
  await page.waitForFunction(() => !!(window as unknown as { api?: unknown }).api, undefined, {
    timeout: 30_000,
  })
  return { app, page }
}

/** Every localStorage key/value the renderer can see right now. */
export async function readLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k !== null) out[k] = window.localStorage.getItem(k) ?? ''
    }
    return out
  })
}

/** Call `window.api.<path>(...args)` and return the IPC envelope. */
export async function ipc<T = unknown>(
  page: Page,
  apiPath: string,
  ...args: unknown[]
): Promise<{ success: boolean; data?: T; error?: string }> {
  return page.evaluate(
    async ([p, a]) => {
      let cur: unknown = (window as unknown as { api: unknown }).api
      for (const part of (p as string).split('.')) cur = (cur as Record<string, unknown>)[part]
      return (
        cur as (...x: unknown[]) => Promise<{ success: boolean; data?: unknown; error?: string }>
      )(...(a as unknown[]))
    },
    [apiPath, args] as const,
  ) as Promise<{ success: boolean; data?: T; error?: string }>
}

/** Close politely so Chromium flushes localStorage and SQLite checkpoints. */
export async function closeGracefully(app: ElectronApplication): Promise<void> {
  await Promise.race([
    app.close(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('app.close() timed out')), 30_000),
    ),
  ])
}
