import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type ConsoleMessage,
} from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { bootstrapWorkbench } from '../helpers/ui/bootstrap'
import { electronLaunchOptions } from '../helpers/electron-env'

export interface UiFixtures {
  app: ElectronApplication
  window: Page
}

/**
 * Console-error allowlist for the per-test error tripwire below.
 *
 * INTENTIONALLY EMPTY. Every uncaught `pageerror` and every `console.error`
 * emitted while a ui test runs is treated as a screen-render regression and
 * turns the test RED — this is what upgrades the whole ~620-case ui sweep into
 * a "no screen threw" detector without rewriting a single spec.
 *
 * Only add an entry here if the suite legitimately emits a KNOWN-benign console
 * error that cannot be fixed at the source, and document WHY next to the regex.
 * Prefer fixing the source over allowlisting. Keep this list at zero.
 */
const KNOWN_BENIGN_CONSOLE_ERRORS: RegExp[] = [
  // (none)
]

/**
 * Worker-scoped Electron fixture for UI E2E.
 * Bootstraps once per worker: EULA → guest login → test project.
 */
export const uiTest = test.extend<{ errorGuard: void }, UiFixtures>({
  app: [
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) {
        throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
      }
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-ui-e2e-'))
      const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
      await use(app)
      await app.close()
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    },
    { scope: 'worker' },
  ],
  window: [
    async ({ app }, use) => {
      const win = await app.firstWindow()
      await win.waitForLoadState('domcontentloaded')
      await bootstrapWorkbench(win)
      await use(win)
    },
    { scope: 'worker' },
  ],
  /**
   * Per-test screen-throw tripwire (auto — runs for EVERY ui test).
   *
   * Attaches to the SAME worker-scoped `window` page the ui specs drive, so it
   * observes exactly what the test exercises. A render-throw caught by the React
   * ErrorBoundary surfaces as a `console.error('[ErrorBoundary] render crash', …)`
   * and any raw uncaught error surfaces as a `pageerror` — both land in the
   * collector. Listeners are attached for the test body only and removed in the
   * `finally`, so the shared page never accumulates handlers across tests.
   *
   * The assertion runs only when the test body itself passed (a body failure
   * re-throws out of `use()` before the `expect`), so this never masks the real
   * failure — it purely upgrades otherwise-green tests into throw detectors.
   */
  errorGuard: [
    async ({ window }, use, testInfo) => {
      const errors: string[] = []

      const onPageError = (err: Error): void => {
        errors.push(`pageerror: ${err.message}\n${err.stack ?? '(no stack)'}`)
      }
      const onConsole = (msg: ConsoleMessage): void => {
        if (msg.type() !== 'error') return
        const text = msg.text()
        if (KNOWN_BENIGN_CONSOLE_ERRORS.some((re) => re.test(text))) return
        errors.push(`console.error: ${text}`)
      }

      window.on('pageerror', onPageError)
      window.on('console', onConsole)
      try {
        await use()
      } finally {
        window.off('pageerror', onPageError)
        window.off('console', onConsole)
      }

      expect(
        errors,
        `A screen threw or logged an error during "${testInfo.title}":\n${errors.join('\n---\n')}`,
      ).toEqual([])
    },
    { auto: true },
  ],
})
