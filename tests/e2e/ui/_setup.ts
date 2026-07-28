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
import { execFileSync } from 'node:child_process'
import { bootstrapWorkbench, closeAllTabs } from '../helpers/ui/bootstrap'
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
  // MST-216 PROVES the CSP works by deliberately attempting a cross-origin
  // fetch. Chromium logs the refusal as console.error, so the test's own
  // success tripped this guard — the one case where the error IS the expected
  // result. Narrow on purpose: only the refusal message, nothing else.
  /Refused to connect to .* because it violates (the following )?(the document's )?Content Security Policy/i,
  // Monaco uses a `Canceled` exception as CONTROL FLOW when a pending delayer
  // is disposed — which happens whenever an editor unmounts with work in
  // flight (switching tabs, closing a tool). It surfaces as an unhandled
  // pageerror from monaco's own disposal path, so there is no call site of
  // ours to fix. Anchored on the monaco frame so a real app-level "Canceled"
  // would still trip the guard.
  /pageerror: Canceled[\s\S]*monaco-editor/i,
]

/**
 * Worker-scoped Electron fixture for UI E2E.
 * Bootstraps once per worker: EULA → guest login → test project.
 */
export const uiTest = test.extend<{ errorGuard: void; treeFilterReset: void }, UiFixtures>({
  app: [
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) {
        throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
      }
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-ui-e2e-'))
      const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
      await use(app)

      // Teardown timing. Three rounds of "fix the expensive-looking thing and
      // wait 2.5h for CI" narrowed this without ever measuring it; these marks
      // say which step actually spends the budget. If they all report fast and
      // the worker still times out, the remaining time is Playwright's own
      // teardown, which is a different problem than ours.
      const teardownStart = Date.now()
      const mark = (step: string): void => {
        // eslint-disable-next-line no-console
        console.log(`[teardown +${Date.now() - teardownStart}ms] ${step}`)
      }
      mark('begin')

      // Bound the shutdown. A graceful close asks the app to close every open
      // tab and flush the SQLite WAL; after ~700 tests on a slow runner that
      // took longer than the fixture budget, and Playwright failed the ENTIRE
      // run — "Fixture 'app' timeout exceeded", 733 tests passed, zero failed.
      // A teardown hang is not a product defect and must not read as one. The
      // worker is going away regardless, so give the polite path a window and
      // then take the process down.
      // Order matters, and the timing marks proved it. Asking politely first
      // and abandoning the promise was the bug: on CI `app.close()` NEVER
      // settled — the 20s cap was hit every single time — and the abandoned
      // promise was still pending when Playwright's own worker teardown waited
      // on the same close, burning the remaining ~220s of a 240s budget. A run
      // where all 736 tests passed died there.
      //
      // So kill first. `close()` then resolves immediately because the process
      // is already gone. Nothing is lost: this is a temp profile we throw away,
      // and the app's real graceful-shutdown path has its own coverage in
      // shell-quit.spec.ts rather than riding on fixture teardown.
      // Kill the TREE, not just the parent. Measured on CI: SIGKILL on the main
      // process alone still left `close()` hanging for the full 10s cap, because
      // Electron's renderer/GPU/zygote children survive and keep the inherited
      // stdio pipes open — so the parent's 'close' event never fires, and both
      // our await and Playwright's own teardown sit on it. That is the ~230s the
      // timing marks could not account for.
      const pid = app.process().pid
      if (pid) {
        try {
          execFileSync('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore' })
        } catch {
          /* no children, or pkill unavailable */
        }
      }
      try {
        app.process().kill('SIGKILL')
      } catch {
        /* already gone */
      }
      // Killing the processes is not the same as releasing their HANDLES, and
      // the handle report proved it: after the tree died the worker still held
      // a ProcessWrap and seven PipeWraps — the Electron child and its stdio.
      // Node counts those as live resources and refuses to exit, so Playwright
      // waits, so the worker teardown times out on a shard where all 242 tests
      // passed. Destroy the pipes and unref the child.
      const child = app.process()
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.stdin?.destroy()
      try {
        child.unref()
      } catch {
        /* not unref-able */
      }
      mark('process tree killed, stdio destroyed, child unref-ed')

      // Deliberately NOT awaiting app.close(): the process is gone, so there is
      // nothing left to close politely, and awaiting it is exactly what used to
      // stall. Playwright reaps its own side.
      void app.close().catch(() => {})

      // Deleting the directory is the other half of the same problem: ~700 tests
      // fill it with Chromium caches, and removing that tree on CI's disk costs
      // minutes of WORKER teardown — which Playwright budgets against the same
      // timeout and which then fails a run where every test passed. The runner
      // is thrown away wholesale, so skip it there and keep the cleanup where a
      // machine actually persists between runs.
      if (!process.env.CI && fs.existsSync(userDataDir)) {
        fs.rmSync(userDataDir, { recursive: true, force: true })
        mark('userData removed')
      } else {
        mark('userData delete skipped (CI)')
      }
      mark('fixture teardown done — anything beyond this is Playwright internal')

      // If the worker still refuses to exit past this point, something in the
      // PROCESS is holding a handle open — a listening server, a live socket, a
      // timer. Name it instead of guessing; that is what turned the last
      // teardown mystery into a one-line fix.
      const proc = process as unknown as {
        getActiveResourcesInfo?: () => string[]
        _getActiveHandles?: () => unknown[]
      }
      const resources = proc.getActiveResourcesInfo?.() ?? []
      const handles = (proc._getActiveHandles?.() ?? []).map(
        (h) => (h as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown',
      )
      mark(`active resources: ${resources.join(',') || '(none)'}`)
      mark(`active handles: ${handles.join(',') || '(none)'}`)
    },
    { scope: 'worker', timeout: 180_000 },
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
   * Clear the APIs tree filter BEFORE every test (auto).
   *
   * These specs share ONE Electron instance, so a search query typed by an
   * earlier test is still filtering the tree when the next one starts — and a
   * node that exists in the database is then simply absent from the DOM. The
   * failure reads "element(s) not found" about something the test just created,
   * which sends you hunting a persistence bug that isn't there.
   *
   * Deliberately in the SETUP phase, not teardown: a test should not have to
   * clean up after the previous one, and running here keeps this out of the way
   * of `errorGuard`'s post-test assertion.
   */
  treeFilterReset: [
    async ({ window }, use) => {
      const search = window.getByTestId('tree-search')
      if (await search.isVisible().catch(() => false)) {
        await search.fill('').catch(() => {})
      }

      // Cap the tab count too. The Workbench keeps EVERY open tab MOUNTED and
      // only toggles visibility, so each one holds its editors (Monaco included)
      // alive. Nothing closes tabs between specs, so across ~736 tests the
      // shared instance climbs past 35 — which a 32 GB dev machine absorbs and a
      // 7 GB CI runner does not: the app there died with "Target page, context
      // or browser has been closed" in five specs, and opening 10 tabs took 61s
      // instead of the asserted 10s. This stayed invisible until the node:sqlite
      // collection crash was fixed and the full suite ran on CI for the first
      // time. Reset above a threshold rather than every test, so specs that
      // deliberately open many tabs still exercise that path.
      const open = await window
        .getByTestId('endpoint-tab')
        .count()
        .catch(() => 0)
      if (open > 12) await closeAllTabs(window).catch(() => {})

      await use()
    },
    { auto: true },
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
        const text = `pageerror: ${err.message}\n${err.stack ?? '(no stack)'}`
        // The allowlist applies to uncaught errors too — a library that throws
        // as control flow surfaces HERE, not on the console channel.
        if (KNOWN_BENIGN_CONSOLE_ERRORS.some((re) => re.test(text))) return
        errors.push(text)
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
