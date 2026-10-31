/**
 * Screen tour — a screenshot sweep of (nearly) every Testnizer screen, judged
 * afterwards against `.claude/skills/testnizer-ui-ux/references/screen-rubric.md`.
 *
 * NOT a regression test. It asserts nothing about the product: every screen is
 * captured inside its own try/catch, a broken selector writes
 * `<name>-FAILED.txt` (+ a `-FAILED.png` of whatever was on screen) and the
 * tour carries on. Console errors are collected into `_console-errors.txt`
 * instead of failing the test (the shared `errorGuard` tripwire is overridden).
 *
 * Run (never part of a normal suite — gated on TESTNIZER_SCREEN_TOUR):
 *
 *   node scripts/ensure-native-abi.js electron   # after any `npm test`
 *   npm run build
 *   TESTNIZER_SCREEN_TOUR=1 TESTNIZER_SHOTS_DIR=/abs/path/to/shots \
 *     npx playwright test --project=ui tests/e2e/ui/tour/screen-tour.spec.ts
 *
 * Output names: `<NNN>-<area>-<screen>-<state>.png`, state in
 * main | empty | error | filled | dark | tr | narrow. NNN is the SCREEN id, so
 * dark / tr / narrow variants share the number of their `main` shot and a
 * failed screen never renumbers the others. Extra files: `_notes.txt`
 * (setup steps that failed), `_console-errors.txt`, `_summary.txt`.
 *
 * Shared-instance rules (CLAUDE.md): everything is created in ONE scratch
 * project ("Acme Payments API") that is deleted at the end (mock servers are
 * stopped first so their ports are released), so the tour leaves the canonical
 * E2E project untouched. Empty-state shots are taken in that project BEFORE it
 * is seeded. Theme, language and window size are restored at the end (and in
 * `afterAll`). No certificates are added.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, type ConsoleMessage, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from '../_setup'
import {
  E2E_PROJECT_NAME,
  closeAllTabs,
  dismissOverlays,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls, localHttpBin } from '../../helpers/test-servers'
import { createFolder, createScheduledTask, getActiveProjectId } from '../../helpers/ui/assert-ipc'
import {
  createEnvVariableIpc,
  createEnvironmentIpc,
  createSavedRequestIpc,
  deleteProject,
  getDefaultWorkspaceId,
  updateSavedRequestIpc,
} from '../../helpers/ui/db-flow'
import { openImportModal, refreshWorkspaceTree } from '../../helpers/ui/import-flow'
import { persistedLocale } from '../../helpers/ui/locale'
import { goToProjectHome, createProject, openProject } from '../../helpers/ui/workspace-flow'
import { treeClearSearch, treeOpenNode } from '../../helpers/ui/tree'
import {
  clickSend,
  addParam,
  addHeader,
  fillUrl,
  setAuthBasic,
  waitForResponseStatus,
} from '../../helpers/ui/request-flow'
import { fillMonaco } from '../../helpers/ui/monaco'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { withClipboardText } from '../../helpers/ui/clipboard'
import { openConsolePanel } from '../../helpers/ui/console-flow'
import { setRightPanelOpen } from '../../helpers/ui/layout-extra'
import { disconnectIfConnected } from '../../helpers/ui/protocol-extra'
import { openTool } from '../../helpers/ui/tools-flow'
import {
  switchEnvironment,
  openEnvModal,
  selectEnvironmentInModal,
  openGlobalsPane,
  addVariable,
} from '../../helpers/ui/env'
import {
  addMockEndpoint,
  addMockResponse,
  createMockServer,
  randomMockPort,
  startMockServer,
} from '../../helpers/ui/mock-flow'
import {
  addSuiteItem,
  createTestSuite,
  runSuiteFromContextMenu,
  saveActiveSuiteItem,
} from '../../helpers/ui/suite-flow'
import {
  openCollectionRunner,
  openScheduledTasksView,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerConfigReady,
  waitRunnerTabComplete,
} from '../../helpers/ui/runner-flow'
import { PROJECT_DETAIL_TABS } from '../../helpers/ui/inventory'

// ─── Gate + output ───────────────────────────────────────────────────────────

const TOUR_ON = !!process.env.TESTNIZER_SCREEN_TOUR
const PROJECT = 'Acme Payments API'

type State = 'main' | 'empty' | 'error' | 'filled' | 'dark' | 'tr' | 'narrow'
type Variant = 'dark' | 'tr' | 'narrow'

interface ShotSpec {
  /** Screen id — shared by every variant of the same screen. */
  id: number
  area: string
  screen: string
  state?: State
}

/** Resolved lazily: nothing here may throw at import time (collection error). */
function shotsDir(): string {
  const dir = process.env.TESTNIZER_SHOTS_DIR
  if (!dir || !path.isAbsolute(dir)) {
    throw new Error('TESTNIZER_SHOTS_DIR must be set to an ABSOLUTE directory when the tour runs')
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const pad = (n: number): string => String(n).padStart(3, '0')
const baseName = (s: ShotSpec): string => `${pad(s.id)}-${s.area}-${s.screen}-${s.state ?? 'main'}`
const errText = (e: unknown): string =>
  e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)

function note(label: string, e: unknown): void {
  try {
    fs.appendFileSync(path.join(shotsDir(), '_notes.txt'), `## ${label}\n${errText(e)}\n\n`)
  } catch {
    /* the tour must never die on its own bookkeeping */
  }
}

interface Ctx {
  app: ElectronApplication
  w: Page
}

/** Everything the tour created / needs to restore. Reset-proof: only mutated in tests. */
const T = {
  projectName: null as string | null,
  projectId: null as string | null,
  http: '',
  origTheme: 'light' as 'light' | 'dark' | 'system',
  origContent: null as { width: number; height: number } | null,
  seeded: false,
  themeRead: false,
  payId: null as string | null,
  taskIds: [] as string[],
  shots: 0,
  failed: 0,
  cleaned: false,
}

// ─── Fixture override: console errors are evidence, not failures ─────────────

// Overriding WITHOUT an options tuple keeps the base fixture's `auto: true`
// (Playwright inherits the previous registration's options).
const tourTest = uiTest.extend<{ errorGuard: void }>({
  errorGuard: async ({ window }, use, testInfo) => {
    const events: string[] = []
    const onPageError = (e: Error): void => {
      events.push(`pageerror: ${e.message}`)
    }
    const onConsole = (m: ConsoleMessage): void => {
      if (m.type() === 'error') events.push(`console.error: ${m.text()}`)
    }
    window.on('pageerror', onPageError)
    window.on('console', onConsole)
    try {
      await use()
    } finally {
      window.off('pageerror', onPageError)
      window.off('console', onConsole)
      if (TOUR_ON && events.length > 0) {
        try {
          fs.appendFileSync(
            path.join(shotsDir(), '_console-errors.txt'),
            `## ${testInfo.title}\n${events.join('\n')}\n\n`,
          )
        } catch {
          /* ignore */
        }
      }
    }
  },
})

// ─── Capture core ────────────────────────────────────────────────────────────

/** Fonts loaded, no visible spinner, animations done. */
async function settle(w: Page): Promise<void> {
  await w.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {})
  await expect(
    w.locator(
      '[data-testid="response-loading"]:visible, .animate-spin:visible, [role="progressbar"]:visible',
    ),
  )
    .toHaveCount(0, { timeout: 4_000 })
    .catch(() => {})
  await w.waitForTimeout(350)
}

/** Close whatever a failed screen left behind so the next shot starts clean. */
async function recover(w: Page): Promise<void> {
  await dismissOverlays(w).catch(() => {})
}

/** One screenshot, own try/catch. `setup` brings the screen up; returns success. */
async function shot(w: Page, spec: ShotSpec, setup?: () => Promise<void>): Promise<boolean> {
  const name = baseName(spec)
  const dir = shotsDir()
  try {
    if (setup) await setup()
    await settle(w)
    await w.screenshot({
      path: path.join(dir, `${name}.png`),
      animations: 'disabled',
      caret: 'hide',
    })
    T.shots++
    return true
  } catch (e) {
    T.failed++
    try {
      fs.writeFileSync(path.join(dir, `${name}-FAILED.txt`), errText(e))
      await w.screenshot({
        path: path.join(dir, `${name}-FAILED.png`),
        animations: 'disabled',
        caret: 'hide',
      })
    } catch {
      /* best effort */
    }
    await recover(w)
    return false
  }
}

/** A non-screenshot step that may fail without ending the group. */
async function attempt(label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    note(label, e)
    return false
  }
}

// ─── Theme / locale / window size ────────────────────────────────────────────

async function readSetting(w: Page, key: string): Promise<unknown> {
  return w.evaluate(async (k) => {
    const api = (
      window as unknown as {
        api?: { settings?: { get: (k: string) => Promise<{ data?: unknown }> } }
      }
    ).api
    return (await api?.settings?.get(k))?.data
  }, key)
}

async function setTheme(w: Page, mode: 'light' | 'dark' | 'system'): Promise<void> {
  await dismissOverlays(w)
  await openCommandPalette(w)
  const re =
    mode === 'dark'
      ? /Switch theme: Dark|Tema: Koyu/
      : mode === 'light'
        ? /Switch theme: Light|Tema: Açık/
        : /Switch theme: System|Tema: Sistem/
  await w.getByRole('option', { name: re }).click()
  if (mode !== 'system') {
    await expect(w.locator('html')).toHaveAttribute('data-theme', mode, { timeout: 5_000 })
  }
  await w.waitForTimeout(250)
}

async function setLocale(w: Page, locale: 'en' | 'tr'): Promise<void> {
  const current = (await persistedLocale(w)) ?? 'en'
  if (current === locale) return
  await dismissOverlays(w)
  await openCommandPalette(w)
  await w
    .getByRole('option', {
      name:
        locale === 'tr'
          ? /Change language: Türkçe|Dil: Türkçe/
          : /Change language: English|Dil: English/,
    })
    .click()
  await expect.poll(() => persistedLocale(w), { timeout: 5_000 }).toBe(locale)
  await w.waitForTimeout(300)
}

async function contentSize(app: ElectronApplication): Promise<{ width: number; height: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    const [width, height] = BrowserWindow.getAllWindows()[0].getContentSize()
    return { width, height }
  })
}

async function setContentSize(
  app: ElectronApplication,
  size: { width: number; height: number },
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setContentSize(s.width, s.height)
  }, size)
  await new Promise((r) => setTimeout(r, 500))
}

/**
 * Re-capture the screen that is ON SCREEN right now in dark / Turkish / narrow.
 * `reopen` brings a modal / palette back after the (overlay-closing) switch;
 * tab screens need none. Each variant restores its setting in `finally`.
 */
async function variants(
  c: Ctx,
  spec: Omit<ShotSpec, 'state'>,
  which: Variant[],
  reopen?: () => Promise<void>,
): Promise<void> {
  for (const v of which) {
    try {
      if (v === 'dark') {
        await setTheme(c.w, 'dark')
        await shot(c.w, { ...spec, state: 'dark' }, reopen)
      } else if (v === 'tr') {
        await setLocale(c.w, 'tr')
        await shot(c.w, { ...spec, state: 'tr' }, reopen)
      } else {
        await dismissOverlays(c.w)
        await setContentSize(c.app, { width: 1280, height: 720 })
        await shot(c.w, { ...spec, state: 'narrow' }, reopen)
      }
    } catch (e) {
      note(`variant ${v} of ${baseName({ ...spec, state: 'main' })}`, e)
    } finally {
      await dismissOverlays(c.w).catch(() => {})
      if (v === 'dark') await setTheme(c.w, T.origTheme).catch((e) => note('restore theme', e))
      else if (v === 'tr') await setLocale(c.w, 'en').catch((e) => note('restore locale', e))
      else if (T.origContent) await setContentSize(c.app, T.origContent).catch(() => {})
    }
  }
}

// ─── Group wrapper: never rethrows, always tidies ────────────────────────────

/** Create the scratch project from Project Home and remember its id. */
async function createScratch(w: Page): Promise<void> {
  await goToProjectHome(w)
  await createProject(w, PROJECT)
  T.projectName = PROJECT
  T.projectId = await getActiveProjectId(w, PROJECT)
  T.seeded = false
}

/**
 * Make the tour's project the active one. `scratch=false` is only the very first
 * group (home + empty states) before the scratch project exists. If a worker
 * restarted mid-tour (a timed-out test does that) the project is gone together
 * with the old profile: recreate and reseed it so later groups still capture.
 */
async function ensureTourProject(w: Page, scratch = true): Promise<void> {
  const name = scratch ? PROJECT : (T.projectName ?? E2E_PROJECT_NAME)
  const tab = w.locator(`[data-testid="header-project-tab"][title="${name}"]`)
  if ((await tab.count()) > 0) {
    if ((await tab.first().getAttribute('data-active')) !== 'true') {
      await tab.first().click()
      await w.waitForTimeout(300)
    }
    return
  }
  if (scratch) {
    await goToProjectHome(w)
    const card = w.getByTestId('project-card').filter({ hasText: PROJECT })
    if ((await card.count()) === 0) {
      await createScratch(w)
      await seedScratch(w)
      return
    }
  }
  await openProject(w, name)
  if (scratch && !T.projectId) T.projectId = await getActiveProjectId(w, PROJECT)
}

async function prep(w: Page, scratch: boolean): Promise<void> {
  await dismissOverlays(w)
  await ensureTourProject(w, scratch).catch((e) => note('ensureTourProject', e))
  await disconnectIfConnected(w).catch(() => {})
  await closeAllTabs(w).catch(() => {})
  await treeClearSearch(w).catch(() => {})
  await navigateSidebar(w, 'apis').catch(() => {})
}

function group(
  title: string,
  fn: (c: Ctx) => Promise<void>,
  opts: { timeoutMs?: number; scratch?: boolean } = {},
): void {
  tourTest(title, async ({ app, window }) => {
    tourTest.setTimeout(opts.timeoutMs ?? 300_000)
    window.setDefaultTimeout(8_000)
    if (!T.http) T.http = localHttpBin()
    if (!T.origContent) T.origContent = await contentSize(app).catch(() => null)
    if (!T.themeRead) {
      const t = await readSetting(window, 'ui.theme').catch(() => undefined)
      T.origTheme = t === 'dark' || t === 'system' ? t : 'light'
      T.themeRead = true
    }
    try {
      await prep(window, opts.scratch !== false)
      await fn({ app, w: window })
    } catch (e) {
      note(`group "${title}"`, e)
    } finally {
      await dismissOverlays(window).catch(() => {})
      await disconnectIfConnected(window).catch(() => {})
      await closeAllTabs(window).catch(() => {})
      if (T.origContent) await setContentSize(app, T.origContent).catch(() => {})
    }
  })
}

// ─── Small UI helpers ────────────────────────────────────────────────────────

async function openSeeded(w: Page, name: string): Promise<void> {
  await navigateSidebar(w, 'apis')
  await treeOpenNode(w, name)
  await expect(w.getByTestId('url-input')).toBeVisible({ timeout: 10_000 })
  await treeClearSearch(w)
}

async function typeIntoVisibleEditor(w: Page, index: number, text: string): Promise<void> {
  const ed = w.locator('.monaco-editor:visible').nth(index)
  await ed.click()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await w.keyboard.press(`${mod}+KeyA`)
  await w.keyboard.insertText(text)
  await w.locator('body').click({ position: { x: 4, y: 4 } })
  await w.waitForTimeout(250)
}

/**
 * Type a one-line GraphQL document key by key: Monaco auto-closes `{ ( "` and
 * overtypes the closers it inserted, so the text lands exactly as written. A
 * bulk `insertText` of a multi-line document ended with a stray `}` (shot 200).
 */
async function typeGraphqlQuery(w: Page, query: string): Promise<void> {
  const editor = w.getByTestId('graphql-query-editor').locator('.monaco-editor').first()
  await editor.click()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await w.keyboard.press(`${mod}+KeyA`)
  await w.keyboard.press('Backspace')
  await w.keyboard.type(query, { delay: 8 })
  const closers = (query.match(/}/g) ?? []).length
  // Trim any auto-closed leftovers at the end of the document.
  for (let i = 0; i < 3; i++) {
    const text = (await editor.locator('.view-lines').first().innerText()).replace(/\u00a0/g, ' ')
    if ((text.match(/}/g) ?? []).length <= closers) break
    await w.keyboard.press(`${mod}+End`)
    await w.keyboard.press('Backspace')
  }
  await w.locator('body').click({ position: { x: 4, y: 4 } })
  await w.waitForTimeout(250)
}

/** Make the next native "open file" dialog return `file`; returns the restore function. */
async function stubOpenDialog(
  app: ElectronApplication,
  file: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__tourOrigOpen) d.__tourOrigOpen = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, file)
  return async () => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__tourOrigOpen) {
        d.showOpenDialog = d.__tourOrigOpen
        delete d.__tourOrigOpen
      }
    })
  }
}

async function ensureExpanded(w: Page, folder: string, child: string): Promise<void> {
  if ((await w.getByTestId('tree-node').filter({ hasText: child }).count()) > 0) return
  const node = w.getByTestId('tree-node').filter({ hasText: folder }).first()
  const chevron = node.getByTestId('tree-node-chevron')
  if ((await chevron.count()) > 0) await chevron.first().click()
  else await node.click()
  await w.waitForTimeout(200)
}

async function setCritical(w: Page, on: boolean): Promise<void> {
  await w.getByTestId('req-tab-settings').click()
  const sw = w.getByTestId('settings-critical')
  await expect(sw).toBeAttached({ timeout: 8_000 })
  if ((await sw.isChecked()) !== on) await sw.locator('xpath=ancestor::label[1]').click()
  await expect(sw).toBeChecked({ checked: on })
}

async function createMockViaDialog(
  w: Page,
  kind: 'mcp' | 'sse' | 'ai',
  preset: string,
  name: string,
): Promise<void> {
  await navigateSidebar(w, 'mocks')
  await w.getByTestId('mock-new').click()
  const dialog = w.getByTestId('mock-new-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByTestId(`mock-new-type-${kind}`).click()
  await dialog.getByTestId(`mock-new-preset-${preset}`).click()
  await dialog.getByTestId('mock-new-name').fill(name)
  await dialog.getByTestId('mock-new-port').fill(String(randomMockPort()))
  await dialog.getByTestId('mock-new-create').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** Stop + delete every mock server (HTTP/SSE/AI and MCP) of the project — frees the ports. */
async function purgeMocks(w: Page, projectId: string): Promise<void> {
  await w.evaluate(async (pid) => {
    type Srv = {
      list: (p: string) => Promise<{ data?: Array<{ id: string }> }>
      stop: (id: string) => Promise<unknown>
      delete: (id: string) => Promise<unknown>
    }
    const api = (window as unknown as { api: { mock: { server: Srv }; mockMcp: { server: Srv } } })
      .api
    for (const srv of [api.mock.server, api.mockMcp.server]) {
      const rows = (await srv.list(pid).catch(() => ({ data: [] }))).data ?? []
      for (const s of rows) {
        await srv.stop(s.id).catch(() => {})
        await srv.delete(s.id).catch(() => {})
      }
    }
  }, projectId)
}

async function clearProjectHistory(w: Page, projectId: string): Promise<void> {
  await w.evaluate(async (pid) => {
    const api = (
      window as unknown as { api: { history: { clear: (s: unknown) => Promise<unknown> } } }
    ).api
    await api.history.clear({ project_id: pid })
  }, projectId)
}

async function deleteScheduledTask(w: Page, id: string): Promise<void> {
  await w.evaluate(async (tid) => {
    const api = (
      window as unknown as { api: { scheduler: { delete: (id: string) => Promise<unknown> } } }
    ).api
    await api.scheduler.delete(tid)
  }, id)
}

const kv = (key: string, value: string, i: number) => ({ id: `kv${i}`, key, value, enabled: true })

/** Folders, requests, scripts and the Staging environment. No screenshots. */
async function seedScratch(w: Page): Promise<void> {
  const pid = T.projectId
  if (!pid) throw new Error('no scratch project — nothing to seed')
  const http = T.http
  const ws = await getDefaultWorkspaceId(w)

  const fAuth = await createFolder(w, pid, 'Auth')
  const fOrders = await createFolder(w, pid, 'Orders')
  const fUsers = await createFolder(w, pid, 'Users')
  const fCheckout = await createFolder(w, pid, 'Checkout flow')

  const jsonHdr = JSON.stringify([
    kv('Content-Type', 'application/json', 1),
    kv('X-Request-Id', 'tour-7f3a', 2),
    kv('X-Tenant', '{{tenantId}}', 3), // deliberately unresolved
  ])
  const bearer = JSON.stringify({ type: 'bearer', bearer: { token: '{{token}}' } })
  // RequestBody is `{ type, content }` (src/renderer/types). The old
  // `{ type:'raw', raw, format }` shape loaded as an EMPTY body (shot 103).
  const body = (content: string): string => JSON.stringify({ type: 'json', content })

  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fAuth,
    name: 'Login',
    method: 'POST',
    url: '{{baseUrl}}/auth/login',
    headers: JSON.stringify([kv('Content-Type', 'application/json', 1)]),
    body: body('{\n  "username": "demo",\n  "password": "{{password}}"\n}'),
  })
  const createOrder = await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fOrders,
    name: 'Create order',
    method: 'POST',
    url: `${http}/post`,
    headers: jsonHdr,
    body: body(
      '{\n  "customerId": "c-1042",\n  "currency": "EUR",\n  "items": [\n    { "sku": "SKU-1", "qty": 2 },\n    { "sku": "SKU-9", "qty": 1 }\n  ]\n}',
    ),
    auth: bearer,
  })
  await updateSavedRequestIpc(w, createOrder, {
    pre_script:
      "pm.environment.set('orderRef', 'ORD-' + Date.now());\nconsole.log('creating', pm.environment.get('orderRef'));",
    post_script: [
      "pm.test('status is 200', () => pm.response.to.have.status(200));",
      "pm.test('echoes the customer', () => pm.expect(pm.response.json().json.customerId).to.eql('c-1042'));",
      "pm.test('has an order id (fails on purpose)', () => pm.expect(pm.response.json().json.orderId).to.be.a('string'));",
    ].join('\n'),
    assertions: JSON.stringify([
      { id: 'a1', name: 'Status is 200', type: 'status_equals', enabled: true, expected: 200 },
      {
        id: 'a2',
        name: 'Fast response',
        type: 'response_time_under',
        enabled: true,
        expected: 1500,
      },
    ]),
  })
  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fOrders,
    name: 'List orders',
    url: `${http}/get?status=open&limit=20`,
    headers: JSON.stringify([kv('Accept', 'application/json', 1)]),
  })
  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fOrders,
    name: 'Get order',
    url: `${http}/get?id=1001`,
  })
  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fUsers,
    name: 'List users',
    url: '{{baseUrl}}/users',
  })

  // Runner flow: pass / fail (500) / pass. "Pay order" is flipped to Critical later.
  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fCheckout,
    name: 'Checkout - Create cart',
    url: `${http}/get?step=cart`,
  })
  const pay = await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fCheckout,
    name: 'Checkout - Pay order',
    method: 'POST',
    url: `${http}/status/500`,
  })
  await createSavedRequestIpc(w, {
    projectId: pid,
    folderId: fCheckout,
    name: 'Checkout - Send receipt',
    url: `${http}/get?step=receipt`,
  })
  T.payId = pay

  // Environment "Staging": plain + secret variables, made active.
  const env = await createEnvironmentIpc(w, ws, pid, 'Staging')
  await createEnvVariableIpc(w, env, 'baseUrl', http, http, false)
  await createEnvVariableIpc(w, env, 'apiVersion', 'v2', 'v2', false)
  await createEnvVariableIpc(
    w,
    env,
    'token',
    'tok_live_9d8c7b6a5f4e3d2c',
    'tok_live_9d8c7b6a5f4e3d2c',
    true,
  )
  await createEnvVariableIpc(
    w,
    env,
    'password',
    'correct-horse-battery',
    'correct-horse-battery',
    true,
  )

  await refreshWorkspaceTree(w)
  await attempt('activate Staging', () => switchEnvironment(w, 'Staging'))
  T.seeded = true
}

// ─── The tour ────────────────────────────────────────────────────────────────

tourTest.describe('Screen tour (TESTNIZER_SCREEN_TOUR=1)', () => {
  // Describe-level and fixture-free: with the flag off no Electron is launched.
  tourTest.skip(
    !TOUR_ON,
    'screenshot tour — set TESTNIZER_SCREEN_TOUR=1 and TESTNIZER_SHOTS_DIR=<abs dir> to run it',
  )

  // 0xx ─ Home + empty states (scratch project, nothing seeded yet) ───────────
  group(
    '00 home, new-project modal, scratch project, empty states',
    async (c) => {
      const { w } = c

      await shot(w, { id: 1, area: 'shell', screen: 'project-home' }, async () => {
        await goToProjectHome(w)
      })
      await shot(w, { id: 2, area: 'shell', screen: 'new-project-modal' }, async () => {
        await w.getByTestId('home-new-project').click()
        await expect(w.getByTestId('new-project-modal')).toBeVisible()
      })
      await dismissOverlays(w)

      // Scratch project — everything below lives (and dies) in it.
      const created = await attempt('create scratch project', () => createScratch(w))
      if (!created) return

      await shot(w, { id: 3, area: 'apis', screen: 'tree', state: 'empty' }, async () => {
        await navigateSidebar(w, 'apis')
      })
      await shot(w, { id: 4, area: 'mocks', screen: 'list', state: 'empty' }, async () => {
        await navigateSidebar(w, 'mocks')
      })
      await shot(w, { id: 5, area: 'history', screen: 'list', state: 'empty' }, async () => {
        await navigateSidebar(w, 'history')
      })
      await shot(w, { id: 6, area: 'tests', screen: 'overview', state: 'empty' }, async () => {
        await navigateSidebar(w, 'tests')
        await w
          .getByTestId('left-panel')
          .getByRole('button', { name: /^Overview$/i })
          .click()
      })
      await shot(w, { id: 7, area: 'tests', screen: 'all-runs', state: 'empty' }, async () => {
        await navigateSidebar(w, 'tests')
        await w
          .getByTestId('left-panel')
          .getByRole('button', { name: /^All Runs$/i })
          .click()
      })
      await shot(
        w,
        { id: 8, area: 'tests', screen: 'scheduled-tasks', state: 'empty' },
        async () => {
          await openScheduledTasksView(w)
        },
      )
    },
    { scratch: false },
  )

  // 0xx ─ Seed (no screenshot) ─────────────────────────────────────────────────
  group('01 seed project content', async (c) => {
    if (!T.seeded) await seedScratch(c.w)
  })

  // 1xx/0xx ─ Shell ────────────────────────────────────────────────────────────
  group('02 shell screens', async (c) => {
    const { w } = c
    const treeOpen = async (): Promise<void> => {
      await navigateSidebar(w, 'apis')
      await treeClearSearch(w)
      for (const [folder, child] of [
        ['Orders', 'Create order'],
        ['Auth', 'Login'],
        ['Users', 'List users'],
        ['Checkout flow', 'Checkout - Create cart'],
      ]) {
        await ensureExpanded(w, folder, child)
      }
    }
    if (await shot(w, { id: 10, area: 'apis', screen: 'tree' }, treeOpen)) {
      await variants(c, { id: 10, area: 'apis', screen: 'tree' }, ['dark', 'tr'], treeOpen)
    }

    await shot(w, { id: 35, area: 'apis', screen: 'tree-context-menu' }, async () => {
      await treeOpen()
      await w
        .getByTestId('tree-node')
        .filter({ hasText: 'Orders' })
        .first()
        .click({ button: 'right' })
      await w.waitForTimeout(300)
    })
    await dismissOverlays(w)

    await shot(w, { id: 34, area: 'shell', screen: 'new-dropdown-menu' }, async () => {
      await w.getByTestId('new-dropdown-btn').click()
      await expect(w.getByTestId('new-dropdown-menu')).toBeVisible()
    })
    await dismissOverlays(w)

    const openPalette = async (): Promise<void> => {
      await dismissOverlays(w)
      await openCommandPalette(w)
    }
    if (await shot(w, { id: 11, area: 'shell', screen: 'command-palette' }, openPalette)) {
      await dismissOverlays(w)
      await variants(
        c,
        { id: 11, area: 'shell', screen: 'command-palette' },
        ['dark', 'tr'],
        openPalette,
      )
    }
    await dismissOverlays(w)

    const openSettings = async (): Promise<void> => {
      await dismissOverlays(w)
      await pressModShortcut(w, ',')
      await expect(w.getByTestId('settings-modal')).toBeVisible()
    }
    if (await shot(w, { id: 12, area: 'shell', screen: 'settings-modal' }, openSettings)) {
      await dismissOverlays(w)
      await variants(
        c,
        { id: 12, area: 'shell', screen: 'settings-modal' },
        ['dark', 'tr', 'narrow'],
        openSettings,
      )
    }
    await dismissOverlays(w)

    const openProjectSettings = async (tab: string): Promise<void> => {
      await dismissOverlays(w)
      await w.getByTestId('nav-settings').click()
      await expect(w.getByTestId('project-detail-modal')).toBeVisible()
      await w.getByTestId(`project-detail-tab-${tab}`).click()
    }
    for (const [i, tab] of PROJECT_DETAIL_TABS.entries()) {
      const spec = { id: 13 + i, area: 'shell', screen: `project-settings-${tab}` }
      const ok = await shot(w, spec, () => openProjectSettings(tab))
      if (ok && i === 0) {
        await dismissOverlays(w)
        await variants(c, spec, ['dark', 'tr', 'narrow'], () => openProjectSettings(tab))
      }
      await dismissOverlays(w)
    }

    await shot(w, { id: 40, area: 'shell', screen: 'about-modal' }, async () => {
      await openCommandPalette(w)
      await w.getByRole('option', { name: /About Testnizer|Testnizer hakkında/ }).click()
      await expect(w.getByTestId('about-modal')).toBeVisible()
    })
    await dismissOverlays(w)
    await shot(w, { id: 41, area: 'shell', screen: 'shortcut-cheatsheet' }, async () => {
      await w.keyboard.press('Shift+Slash')
      await expect(w.getByTestId('shortcut-cheatsheet')).toBeVisible()
    })
    await dismissOverlays(w)
    await shot(w, { id: 42, area: 'shell', screen: 'enterprise-modal' }, async () => {
      await w.getByTestId('footer-enterprise').click()
      await expect(w.getByTestId('enterprise-modal')).toBeVisible()
    })
    await dismissOverlays(w)
    await shot(w, { id: 43, area: 'shell', screen: 'user-menu' }, async () => {
      await w
        .getByTitle(/^Session$|^Oturum$/)
        .first()
        .click()
      await w.waitForTimeout(300)
    })
    await dismissOverlays(w)
    await shot(w, { id: 44, area: 'shell', screen: 'branch-menu' }, async () => {
      await w.getByTestId('branch-pill').click()
      await w.waitForTimeout(300)
    })
    await dismissOverlays(w)
  })

  // 1xx ─ HTTP request editor + response pane ──────────────────────────────────
  group('03 http editor and response', async (c) => {
    const { w } = c
    await shot(w, { id: 100, area: 'http', screen: 'new-tab', state: 'empty' }, async () => {
      await openHttpRequestTab(w)
    })
    await closeAllTabs(w)

    await openSeeded(w, 'Create order')
    await attempt('add params', async () => {
      await addParam(w, 'expand', 'items')
      await addParam(w, 'dryRun', 'false')
    })
    const tabShot = async (id: number, key: string, screen: string): Promise<boolean> =>
      shot(w, { id, area: 'http', screen }, async () => {
        await w.getByTestId(`req-tab-${key}`).click()
        await w.waitForTimeout(250)
      })
    if (await tabShot(101, 'params', 'editor-params')) {
      await variants(
        c,
        { id: 101, area: 'http', screen: 'editor-params' },
        ['dark', 'tr', 'narrow'],
        async () => {
          await w.getByTestId('req-tab-params').click()
        },
      )
    }
    await tabShot(102, 'headers', 'editor-headers')
    await tabShot(103, 'body', 'editor-body')
    await tabShot(104, 'auth', 'editor-auth')
    await shot(w, { id: 105, area: 'http', screen: 'editor-scripts-pre' }, async () => {
      await w.getByTestId('req-tab-scripts').click()
      await w.getByTestId('scripts-pre').click()
      await w.waitForTimeout(400)
    })
    await shot(w, { id: 106, area: 'http', screen: 'editor-scripts-post' }, async () => {
      await w.getByTestId('scripts-post').click()
      await w.waitForTimeout(400)
    })
    await tabShot(107, 'tests', 'editor-tests')
    await shot(
      w,
      { id: 108, area: 'http', screen: 'editor-settings-critical', state: 'filled' },
      async () => {
        await setCritical(w, true)
      },
    )
    await setCritical(w, false).catch(() => {})

    // Send → response pane.
    const sent = await attempt('send Create order', async () => {
      await clickSend(w)
      await waitForResponseStatus(w, 30_000)
      await w.getByTestId('res-tab-body').click()
    })
    if (sent) {
      if (await shot(w, { id: 110, area: 'http', screen: 'response-body' })) {
        await variants(c, { id: 110, area: 'http', screen: 'response-body' }, [
          'dark',
          'tr',
          'narrow',
        ])
      }
      await shot(w, { id: 111, area: 'http', screen: 'response-headers' }, async () => {
        await w.getByTestId('res-tab-headers').click()
      })
      await shot(w, { id: 112, area: 'http', screen: 'response-test-results' }, async () => {
        await w.getByTestId('res-tab-testResults').click()
        await expect(w.getByTestId('test-results-panel')).toBeVisible()
      })
      await shot(w, { id: 113, area: 'http', screen: 'response-cookies' }, async () => {
        await w.getByTestId('res-tab-cookies').click()
      })
      await attempt('back to body', async () => {
        await w.getByTestId('res-tab-body').click()
      })

      // Right panel + Generate Code. The panel starts collapsed since issue
      // #257, so the tour opens it explicitly and puts it back afterwards
      // (the preference persists in the shared Electron instance).
      const rightPanelWasOpen = await w
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      await shot(w, { id: 120, area: 'http', screen: 'right-panel-variables' }, async () => {
        await setRightPanelOpen(w, true)
        await w
          .getByTestId('right-panel')
          .getByTitle(/^Variables$|^Değişkenler$/)
          .click()
        await w.waitForTimeout(300)
      })
      await shot(w, { id: 121, area: 'http', screen: 'generate-code-pane' }, async () => {
        await w
          .getByTestId('right-panel')
          .getByTitle(/^Code$|^Kod$/)
          .click()
        await expect(w.getByTestId('codegen-language-select')).toBeVisible()
      })
      await attempt('restore right panel', async () => {
        await setRightPanelOpen(w, rightPanelWasOpen)
      })
      await shot(w, { id: 122, area: 'http', screen: 'generate-code-modal' }, async () => {
        await w.getByTestId('response-code-btn').click()
        await expect(w.getByTestId('code-generator-modal')).toBeVisible()
        await w.waitForTimeout(500)
      })
      await attempt('close generate code', async () => {
        const close = w.getByTestId('code-generator-close')
        if (await close.isVisible().catch(() => false)) await close.click()
      })
    }

    // Console and History now have real entries.
    await shot(w, { id: 500, area: 'history', screen: 'list' }, async () => {
      await navigateSidebar(w, 'history')
      await expect(w.getByTestId('history-entry').first()).toBeVisible()
    })
    await variants(c, { id: 500, area: 'history', screen: 'list' }, ['dark', 'tr'], async () => {
      await navigateSidebar(w, 'history')
    })
    await shot(w, { id: 501, area: 'console', screen: 'panel' }, async () => {
      await navigateSidebar(w, 'apis')
      await openConsolePanel(w)
    })
    await attempt('close console', async () => {
      if (
        await w
          .getByTestId('console-panel')
          .isVisible()
          .catch(() => false)
      ) {
        await w.getByTestId('footer-console').click()
      }
    })
  })

  group('04 http: error state, save-as, cURL paste', async (c) => {
    const { w, app } = c
    await shot(
      w,
      { id: 114, area: 'http', screen: 'response-unreachable', state: 'error' },
      async () => {
        await openHttpRequestTab(w)
        await w.getByTestId('url-input').fill('http://127.0.0.1:9/unreachable')
        await clickSend(w)
        await expect(w.getByTestId('response-error')).toBeVisible({ timeout: 30_000 })
      },
    )
    await closeAllTabs(w)

    await shot(
      w,
      { id: 123, area: 'http', screen: 'curl-paste-result', state: 'filled' },
      async () => {
        await openHttpRequestTab(w)
        const curl = [
          `curl '${T.http}/post?src=paste' \\`,
          `  -X POST \\`,
          `  -H 'Content-Type: application/json' \\`,
          `  -H 'X-Trace: tour-1' \\`,
          `  -d '{"hello":"world"}'`,
        ].join('\n')
        await withClipboardText(app, curl, async () => {
          await w.getByTestId('url-input').click()
          await pressModShortcut(w, 'v')
        })
        await expect(w.getByTestId('curl-paste-toast')).toBeVisible({ timeout: 8_000 })
      },
    )
    await attempt('close curl toast', async () => {
      const close = w.getByTestId('curl-paste-close')
      if (await close.isVisible().catch(() => false)) await close.click()
    })

    await shot(w, { id: 124, area: 'http', screen: 'save-as-modal' }, async () => {
      await pressModShortcut(w, 's')
      await expect(w.getByTestId('endpoint-save-modal')).toBeVisible({ timeout: 8_000 })
    })
    await dismissOverlays(w)
    await attempt('discard unsaved prompt', async () => {
      await closeAllTabs(w)
    })
  })

  // 2xx ─ Other protocol editors ───────────────────────────────────────────────
  group('05 graphql', async (c) => {
    const { w } = c
    const { graphql } = getTestServerUrls()
    await openNewDropdownItem(w, /GraphQL/i)
    await w.getByTestId('graphql-url').fill(graphql)
    await typeGraphqlQuery(w, 'query Greeting { hello(name: "Testnizer") }')
    await shot(w, { id: 200, area: 'graphql', screen: 'editor', state: 'filled' })
    await shot(w, { id: 201, area: 'graphql', screen: 'response' }, async () => {
      await w.getByTestId('graphql-run').click()
      // The echo server answers `Hello Testnizer`; the query text only has
      // `"Testnizer"` — so this cannot match before the response arrives.
      await expect(w.getByText(/Hello\sTestnizer/).first()).toBeVisible({ timeout: 15_000 })
    })
    await shot(w, { id: 202, area: 'graphql', screen: 'schema-explorer' }, async () => {
      await w.getByTestId('graphql-introspect').click()
      // Introspection fills the Schema Explorer; the tab does not switch itself.
      const tab = w.getByRole('button', { name: /^Schema Explorer$/ })
      await expect(tab).toBeVisible({ timeout: 15_000 })
      await tab.click()
      await expect(w.getByText(/^Query$/).first()).toBeVisible({ timeout: 15_000 })
    })
  })

  group('06 soap', async (c) => {
    const { w } = c
    await openNewDropdownItem(w, /^SOAP$/i)
    await shot(w, { id: 210, area: 'soap', screen: 'wsdl-import', state: 'empty' })
    await shot(w, { id: 211, area: 'soap', screen: 'manual-body', state: 'filled' }, async () => {
      await w.getByRole('button', { name: /^Manual$/i }).click()
      await w.getByPlaceholder('https://example.com/services/Echo').fill(`${T.http}/post`)
      await typeIntoVisibleEditor(
        w,
        0,
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Header/>\n  <soap:Body>\n    <GetQuote xmlns="http://example.com/quotes">\n      <Symbol>ACME</Symbol>\n    </GetQuote>\n  </soap:Body>\n</soap:Envelope>',
      )
    })
    await shot(w, { id: 212, area: 'soap', screen: 'auth' }, async () => {
      await w.getByTestId('soap-detail-tab-auth').click()
    })
    await shot(w, { id: 213, area: 'soap', screen: 'headers' }, async () => {
      await w.getByTestId('soap-detail-tab-headers').click()
    })
    await shot(w, { id: 214, area: 'soap', screen: 'settings' }, async () => {
      await w.getByTestId('soap-detail-tab-settings').click()
    })
    await shot(w, { id: 215, area: 'soap', screen: 'ws-security', state: 'filled' }, async () => {
      await w.getByTestId('soap-detail-tab-auth').click()
      await w.getByTestId('auth-type-wsse').click()
      await expect(w.getByTestId('auth-wsse-section')).toBeVisible()
    })
    await shot(w, { id: 216, area: 'soap', screen: 'response' }, async () => {
      await w.getByTestId('soap-detail-tab-body').click()
      await w.getByTestId('soap-send').click()
      await expect(w.getByTestId('response-status')).toBeVisible({ timeout: 30_000 })
    })
  })

  group('07 websocket, socket.io, sse, mqtt', async (c) => {
    const { w } = c
    const urls = getTestServerUrls()

    // WebSocket — connected + echo.
    await openNewDropdownItem(w, /WebSocket/i)
    await w.getByTestId('ws-url').fill(urls.ws)
    await shot(w, { id: 220, area: 'websocket', screen: 'editor', state: 'filled' }, async () => {
      await w.getByTestId('ws-connect').click()
      await expect(w.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
      await fillMonaco(w, 'ws-composer', '{"type":"ping","seq":1}')
      await w.getByRole('button', { name: /Send Message/i }).click()
      await expect(w.getByText(/echo|welcome|ping/i).first()).toBeVisible({ timeout: 15_000 })
    })
    await disconnectIfConnected(w)
    await closeAllTabs(w)

    await shot(
      w,
      { id: 221, area: 'websocket', screen: 'connect-failed', state: 'error' },
      async () => {
        await openNewDropdownItem(w, /WebSocket/i)
        await w.getByTestId('ws-url').fill('ws://127.0.0.1:9')
        await w.getByTestId('ws-connect').click()
        await expect(w.getByTestId('ws-error')).toBeVisible({ timeout: 15_000 })
      },
    )
    await closeAllTabs(w)

    // Socket.IO.
    await shot(w, { id: 225, area: 'socketio', screen: 'editor', state: 'filled' }, async () => {
      await openNewDropdownItem(w, /Socket\.IO/i)
      await w.getByTestId('socketio-url').fill(urls.socketio)
      await w.getByTestId('socketio-listen-all-inline').click()
      await w.getByTestId('socketio-connect').click()
      await expect(w.getByTestId('socketio-emit')).toBeVisible({ timeout: 15_000 })
      await w.getByPlaceholder(/event/i).first().fill('ping')
      await w.getByTestId('socketio-emit').click()
      await expect(w.getByText(/pong|echo|welcome/i).first()).toBeVisible({ timeout: 15_000 })
    })
    await disconnectIfConnected(w)
    await closeAllTabs(w)

    // SSE.
    await shot(w, { id: 230, area: 'sse', screen: 'editor', state: 'filled' }, async () => {
      await openNewDropdownItem(w, /SSE/i)
      await w.getByTestId('sse-url').fill(urls.sse)
      await w.getByTestId('sse-connect').click()
      await expect(w.getByText(/tick/i).first()).toBeVisible({ timeout: 15_000 })
    })
    await disconnectIfConnected(w)
    await closeAllTabs(w)

    // MQTT (the broker is optional — see mqtt-server.ts).
    if (urls.mqtt) {
      await shot(w, { id: 235, area: 'mqtt', screen: 'editor', state: 'filled' }, async () => {
        await openNewDropdownItem(w, /MQTT/)
        await w.getByTestId('mqtt-url').fill(urls.mqtt ?? '')
        await w.getByTestId('mqtt-version').selectOption('4')
        await w.getByTestId('mqtt-tab-topics').click()
        await w.getByTestId('mqtt-topic-add').click()
        await w.getByTestId('mqtt-topic-name').last().fill('tour/orders/#')
        await w.getByTestId('mqtt-connect').click()
        await expect(w.getByTestId('mqtt-status')).toHaveAttribute('data-state', 'connected', {
          timeout: 15_000,
        })
        await w.getByTestId('mqtt-tab-message').click()
      })
      await disconnectIfConnected(w)
      await closeAllTabs(w)
    } else {
      note('mqtt', 'MQTT test broker is not running — screen skipped')
    }
  })

  group('08 grpc, mcp, ai chat', async (c) => {
    const { w } = c
    const { grpc, http, mcp } = getTestServerUrls()

    // gRPC — proto loaded from URL, one unary call.
    await openNewDropdownItem(w, /gRPC/i)
    await shot(w, { id: 240, area: 'grpc', screen: 'editor', state: 'empty' })
    await shot(w, { id: 241, area: 'grpc', screen: 'editor-loaded', state: 'filled' }, async () => {
      await w.getByTestId('grpc-address').fill(grpc)
      await w.getByRole('button', { name: /From URL/i }).click()
      await w.getByPlaceholder(/example\.com.*proto/i).fill(`${http}/fixtures/echo.proto`)
      await w.getByRole('button', { name: /Load from URL/i }).click()
      await expect(w.getByTestId('grpc-execute')).toBeEnabled({ timeout: 15_000 })
    })
    await shot(w, { id: 242, area: 'grpc', screen: 'response' }, async () => {
      await w.getByTestId('grpc-execute').click()
      await expect(w.getByTestId('grpc-response-status')).toContainText(/OK/i, { timeout: 20_000 })
    })
    await closeAllTabs(w)

    // MCP.
    await openNewDropdownItem(w, /MCP/i)
    await shot(w, { id: 250, area: 'mcp', screen: 'connect-form', state: 'empty' })
    await shot(w, { id: 251, area: 'mcp', screen: 'connected-tools' }, async () => {
      await w.getByTestId('mcp-url').fill(mcp)
      await w.getByTestId('mcp-connect').click()
      await expect(w.getByTestId('mcp-connect')).toHaveText('Disconnect', { timeout: 15_000 })
      await expect(w.getByTestId('mcp-tool-echo')).toBeVisible({ timeout: 15_000 })
    })
    await shot(w, { id: 252, area: 'mcp', screen: 'tool-result', state: 'filled' }, async () => {
      await w.getByTestId('mcp-tool-echo').click()
      await w.getByTestId('mcp-args-view-json').click()
      await w.getByTestId('mcp-tool-args').fill('{"text":"hello from the screen tour"}')
      await w.getByTestId('mcp-invoke').click()
      await expect(w.getByTestId('mcp-result')).toContainText('hello from the screen tour', {
        timeout: 10_000,
      })
    })
    // `mcp-security-tab` is the PANE; the right-pane tab that opens it is
    // `mcp-section-security`. The OAuth debugger lives in the Authorization
    // tab of the config strip (type "OAuth 2.0") — there is no `mcp-oauth-tab`
    // button. (Both used to click a non-existent testid and time out.)
    await shot(w, { id: 253, area: 'mcp', screen: 'security-scan' }, async () => {
      await w.getByTestId('mcp-section-security').click()
      await expect(w.getByTestId('mcp-security-tab')).toBeVisible()
      await expect(w.getByTestId('mcp-security-scan')).toBeVisible()
    })
    await shot(w, { id: 255, area: 'mcp', screen: 'security-scan-result' }, async () => {
      await w.getByTestId('mcp-security-scan').click()
      await expect(w.getByTestId('mcp-security-summary')).toBeVisible({ timeout: 60_000 })
    })
    await shot(w, { id: 254, area: 'mcp', screen: 'oauth-debugger' }, async () => {
      await w.getByTestId('mcp-section-explorer').click()
      await w.getByTestId('mcp-config-tab-auth').click()
      await w.getByTestId('mcp-auth-type').selectOption('oauth2')
      await expect(w.getByTestId('mcp-oauth-tab')).toBeVisible()
      await expect(w.getByTestId('mcp-oauth-start')).toBeVisible()
    })
    await disconnectIfConnected(w)
    await closeAllTabs(w)

    // AI Chat.
    await shot(w, { id: 260, area: 'ai-chat', screen: 'editor', state: 'empty' }, async () => {
      await openNewDropdownItem(w, /^AI/i)
      await expect(w.getByTestId('ai-chat-editor')).toBeVisible()
    })
  })

  // 3xx ─ Tests: suite, runner, scheduler ─────────────────────────────────────
  group('09 tests: suite, runs, scheduler', async (c) => {
    const { w } = c
    const pid = T.projectId
    const suite = 'Regression suite'
    await attempt('create suite + items', async () => {
      await createTestSuite(w, suite)
      await addSuiteItem(w, suite)
      await w.getByTestId('url-input').fill(`${T.http}/get?suite=health`)
      await saveActiveSuiteItem(w)
      await addSuiteItem(w, suite)
      await w.getByTestId('url-input').fill(`${T.http}/status/404`)
      await saveActiveSuiteItem(w)
      await closeAllTabs(w)
    })
    await shot(w, { id: 300, area: 'tests', screen: 'suite-sidebar' }, async () => {
      await navigateSidebar(w, 'tests')
      await w.getByText(suite, { exact: true }).first().click()
    })
    await shot(w, { id: 301, area: 'tests', screen: 'suite-run-config' }, async () => {
      await runSuiteFromContextMenu(w, suite)
      await waitRunnerConfigReady(w)
    })
    const resultSpec = { id: 302, area: 'runner', screen: 'suite-results' }
    const ran = await shot(w, resultSpec, async () => {
      await startRunnerTabRun(w)
      await waitRunnerTabComplete(w, 120_000)
    })
    if (ran) await variants(c, resultSpec, ['dark', 'tr', 'narrow'])
    await shot(w, { id: 303, area: 'tests', screen: 'all-runs' }, async () => {
      await closeAllTabs(w)
      await navigateSidebar(w, 'tests')
      await w
        .getByTestId('left-panel')
        .getByRole('button', { name: /^All Runs$/i })
        .click()
      await w.waitForTimeout(500)
    })
    await attempt('create scheduled task', async () => {
      if (!pid) throw new Error('no project')
      T.taskIds.push(await createScheduledTask(w, pid, 'Nightly checkout smoke'))
    })
    await shot(w, { id: 304, area: 'tests', screen: 'scheduled-tasks' }, async () => {
      await openScheduledTasksView(w)
      await expect(w.getByTestId('scheduled-task-row').first()).toBeVisible()
    })
  })

  group('10 collection runner: failure + critical stop', async (c) => {
    const { w } = c
    const runIt = async (): Promise<void> => {
      await openCollectionRunner(w)
      await selectOnlyRunnerEndpoints(w, 'Checkout - ')
      const stopOnError = w.getByTestId('workbench').getByLabel(/Stop run if an error occurs/i)
      await stopOnError.setChecked(false)
    }
    await shot(w, { id: 310, area: 'runner', screen: 'config', state: 'filled' }, runIt)
    const failSpec = { id: 311, area: 'runner', screen: 'results-with-failure' }
    await shot(w, failSpec, async () => {
      await startRunnerTabRun(w)
      await waitRunnerTabComplete(w, 120_000)
    })
    await closeAllTabs(w)

    // Flip "Pay order" to Critical (what the Settings-tab switch persists) and run again.
    const payId = T.payId
    await shot(w, { id: 312, area: 'runner', screen: 'results-critical-stop' }, async () => {
      if (!payId) throw new Error('Pay order id unknown — seed step failed')
      await updateSavedRequestIpc(w, payId, { metadata: JSON.stringify({ critical: true }) })
      await runIt()
      await startRunnerTabRun(w)
      await waitRunnerTabComplete(w, 120_000)
      await expect(w.getByTestId('runner-stop-critical')).toBeVisible()
    })
    await attempt('unflag critical', async () => {
      if (payId) await updateSavedRequestIpc(w, payId, { metadata: JSON.stringify({}) })
    })
  })

  // 4xx ─ Mocks ────────────────────────────────────────────────────────────────
  group('11 mocks', async (c) => {
    const { w } = c
    const pid = T.projectId

    // HTTP mock with two endpoints, running.
    const ordersPort = randomMockPort()
    const built = await attempt('build http mock', async () => {
      await createMockServer(w, 'Orders mock', ordersPort)
      await addMockEndpoint(w, { path: '/orders', method: 'GET' })
      await addMockResponse(w, { status: 200 })
      await addMockEndpoint(w, { path: '/orders', method: 'POST' })
      await addMockResponse(w, { status: 201 })
      await startMockServer(w)
    })
    if (built) {
      const spec = { id: 401, area: 'mocks', screen: 'http-editor-endpoints' }
      const reopenEditor = async (): Promise<void> => {
        await navigateSidebar(w, 'mocks')
        await w.getByText('Orders mock').first().click()
        await w.getByTestId('mock-tab-endpoints').click()
      }
      if (
        await shot(w, spec, async () => {
          await w.getByTestId('mock-tab-endpoints').click()
        })
      ) {
        await variants(c, spec, ['dark', 'tr', 'narrow'], reopenEditor)
      }
      await shot(w, { id: 402, area: 'mocks', screen: 'http-editor-settings' }, async () => {
        await w.getByTestId('mock-tab-settings').click()
      })
      await shot(w, { id: 404, area: 'mocks', screen: 'http-client-tab' }, async () => {
        await w.getByTestId('mock-tab-endpoints').click()
        await w.getByTestId('mock-endpoint-open-in-http').click()
        await expect(w.getByTestId('response-status')).toBeVisible({ timeout: 20_000 })
      })
      await shot(w, { id: 403, area: 'mocks', screen: 'http-editor-logs' }, async () => {
        await navigateSidebar(w, 'mocks')
        await w.getByText('Orders mock').first().click()
        await w.getByTestId('mock-tab-logs').click()
      })
    }

    // Mock MCP (Echo preset).
    if (await attempt('create mock mcp', () => createMockViaDialog(w, 'mcp', 'echo', 'Echo MCP'))) {
      await shot(w, { id: 410, area: 'mocks', screen: 'mcp-editor-general' }, async () => {
        await expect(w.getByTestId('mock-mcp-editor')).toBeVisible({ timeout: 10_000 })
      })
      await shot(w, { id: 411, area: 'mocks', screen: 'mcp-editor-tools' }, async () => {
        await w.getByTestId('mock-mcp-tab-tools').click()
      })
    }
    // SSE mock (Ticker preset).
    if (
      await attempt('create mock sse', () => createMockViaDialog(w, 'sse', 'ticker', 'Ticker SSE'))
    ) {
      await shot(w, { id: 420, area: 'mocks', screen: 'sse-editor' }, async () => {
        await expect(w.getByTestId('mock-open-in-sse')).toBeVisible({ timeout: 10_000 })
      })
    }
    // AI mock (Chat preset).
    if (await attempt('create mock ai', () => createMockViaDialog(w, 'ai', 'chat', 'Mock LLM'))) {
      await shot(w, { id: 430, area: 'mocks', screen: 'ai-editor' }, async () => {
        await expect(w.getByTestId('mock-open-in-ai-chat')).toBeVisible({ timeout: 10_000 })
      })
    }

    await shot(w, { id: 400, area: 'mocks', screen: 'list' }, async () => {
      await navigateSidebar(w, 'mocks')
    })
    await shot(w, { id: 440, area: 'mocks', screen: 'new-dialog' }, async () => {
      await navigateSidebar(w, 'mocks')
      await w.getByTestId('mock-new').click()
      await expect(w.getByTestId('mock-new-dialog')).toBeVisible()
    })
    await dismissOverlays(w)

    // Issue #257: a port that another mock of the project already uses is a
    // WARNING under the field (Create stays enabled); a non-port is an error.
    const portSpec = { area: 'mocks', screen: 'new-dialog-port-in-use' }
    await shot(w, { ...portSpec, id: 441 }, async () => {
      await navigateSidebar(w, 'mocks')
      await w.getByTestId('mock-new').click()
      await expect(w.getByTestId('mock-new-dialog')).toBeVisible()
      await w.getByTestId('mock-new-port').fill(String(ordersPort))
      await expect(w.getByTestId('mock-new-port-warning')).toBeVisible()
    })
    await shot(
      w,
      { id: 442, area: 'mocks', screen: 'new-dialog-port-invalid', state: 'error' },
      async () => {
        await w.getByTestId('mock-new-port').fill('99999')
        await expect(w.getByTestId('mock-new-port-error')).toBeVisible()
      },
    )
    await dismissOverlays(w)

    // Free the ports before leaving the group.
    if (pid) await attempt('purge mocks', () => purgeMocks(w, pid))
  })

  // 5xx ─ Environments, import / export, git ───────────────────────────────────
  group('12 environments, import, export', async (c) => {
    const { w } = c
    const pid = T.projectId
    const openEnv = async (): Promise<void> => {
      await dismissOverlays(w)
      await openEnvModal(w)
      await selectEnvironmentInModal(w, 'Staging')
    }
    const envSpec = { id: 510, area: 'env', screen: 'environment-modal' }
    if (await shot(w, envSpec, openEnv)) {
      await dismissOverlays(w)
      await variants(c, envSpec, ['dark', 'tr'], openEnv)
    }
    await shot(w, { id: 511, area: 'env', screen: 'globals-pane', state: 'filled' }, async () => {
      await openEnvModal(w)
      await openGlobalsPane(w)
      await addVariable(w, {
        key: 'apiSecret',
        initialValue: 'sk_live_4c2b1a',
        currentValue: 'sk_live_4c2b1a',
        secret: true,
      })
    })
    await dismissOverlays(w)

    await shot(w, { id: 520, area: 'import', screen: 'import-modal' }, async () => {
      await openImportModal(w)
    })
    await dismissOverlays(w)
    // "Click to select a file" calls `import:openFile`, a NATIVE dialog in main
    // (not an <input type=file>), so Playwright never sees a `filechooser` —
    // the first run hung on a spinner. Patch `dialog.showOpenDialog` in main.
    const fixture = path.resolve(__dirname, '../../../fixtures/import-export/oracle-postman.json')
    let restoreDialog: (() => Promise<void>) | null = null
    await shot(w, { id: 521, area: 'import', screen: 'import-result' }, async () => {
      restoreDialog = await stubOpenDialog(c.app, fixture)
      await w.getByRole('button', { name: /Import API Data|API Verisi İçe Aktar/i }).click()
      await w
        .getByRole('button', { name: /Postman/i })
        .first()
        .click()
      const modal = w.getByTestId('import-modal')
      await expect(modal).toBeVisible()
      await modal.getByRole('button', { name: /Click to select a/i }).click()
      await expect(modal.getByText(/Ready to import/i)).toBeVisible({ timeout: 15_000 })
      await modal.getByRole('button', { name: /^Import$/i }).click()
      await expect(w.getByTestId('import-result')).toBeVisible({ timeout: 30_000 })
    })
    const restore = restoreDialog as (() => Promise<void>) | null
    if (restore) await restore().catch((e) => note('restore dialog', e))
    await attempt('finish import wizard', async () => {
      const done = w.getByTestId('import-result-done')
      if (await done.isVisible().catch(() => false)) await done.click()
      await dismissOverlays(w)
    })

    await shot(w, { id: 530, area: 'export', screen: 'save-project-modal' }, async () => {
      await pressModShortcut(w, 's', { shift: true })
      await expect(w.getByTestId('save-modal')).toBeVisible()
    })
    await dismissOverlays(w)
    await shot(w, { id: 531, area: 'export', screen: 'project-export-modal' }, async () => {
      await goToProjectHome(w)
      const card = w.getByTestId('project-card').filter({ hasText: PROJECT }).first()
      await expect(card).toBeVisible()
      await card.hover()
      // The card's "…" button (revealed on hover) carries no testid; it is the
      // card's only button. The menu then lists Rename / Duplicate / Export / Delete.
      await card.locator('button').first().click()
      await card.getByTestId('home-card-export').click()
      await expect(w.getByTestId('project-export-confirm')).toBeVisible()
    })
    await dismissOverlays(w)
    if (pid) await attempt('back to project', () => ensureTourProject(w))
  })

  // 6xx ─ Tools + Security ─────────────────────────────────────────────────────
  group('13 tools and security', async (c) => {
    const { w } = c
    await shot(w, { id: 600, area: 'tools', screen: 'list' }, async () => {
      await navigateSidebar(w, 'tools')
    })

    const jwtSpec = { id: 601, area: 'tools', screen: 'jwt-debugger' }
    if (
      await shot(w, jwtSpec, async () => {
        await openTool(w, 'JWT Debugger')
        await typeIntoVisibleEditor(
          w,
          0,
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFjbWUgRGVtbyIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
        )
      })
    ) {
      await variants(c, jwtSpec, ['dark', 'tr'])
    }
    await shot(w, { id: 602, area: 'tools', screen: 'text-diff', state: 'filled' }, async () => {
      await openTool(w, 'Text Diff')
      await typeIntoVisibleEditor(w, 0, '{\n  "status": "open",\n  "limit": 20\n}')
      await typeIntoVisibleEditor(w, 1, '{\n  "status": "closed",\n  "limit": 50,\n  "page": 2\n}')
    })
    await shot(w, { id: 603, area: 'tools', screen: 'ws-security' }, async () => {
      await openTool(w, 'WS-Security')
    })

    // Issues #258/#261: the status-code reference in Turkish, searched with a
    // Turkish word (matches the Turkish name, not only the English phrase).
    try {
      await shot(
        w,
        { id: 604, area: 'tools', screen: 'http-status-codes', state: 'tr' },
        async () => {
          await openTool(w, 'HTTP Status Codes')
          await setLocale(w, 'tr')
          await w
            .getByTestId('workbench')
            .getByPlaceholder(/Kod, ad veya açıklama ara/)
            .fill('bulunamadı')
          await expect(w.getByTestId('http-status-row-404')).toBeVisible()
          await expect(w.getByTestId('http-status-local-name-404')).toBeVisible()
        },
      )
    } finally {
      await setLocale(w, 'en').catch((e) => note('restore locale (604)', e))
    }

    await shot(w, { id: 610, area: 'security', screen: 'list' }, async () => {
      await navigateSidebar(w, 'security')
    })
    await shot(w, { id: 611, area: 'security', screen: 'keystore-studio' }, async () => {
      await navigateSidebar(w, 'security')
      await w.getByText('Keystore Studio', { exact: false }).first().click()
      await expect(w.getByTestId('workbench')).toBeVisible()
    })
    await shot(w, { id: 612, area: 'security', screen: 'tls-inspector' }, async () => {
      await navigateSidebar(w, 'security')
      await w.getByText('TLS Inspector', { exact: false }).first().click()
      await expect(w.getByTestId('workbench')).toBeVisible()
    })
  })

  // 1xx ─ Issue acceptance shots: tab strip, narrow URL bar, secrets, settings ──
  group(
    '14 tab strip, narrow url bar, request secrets and settings (#251 #252 #256 #287)',
    async (c) => {
      const { w, app } = c
      const rightPanelWasOpen = await w
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      try {
        // #252: 14 tabs overflow the strip; "+" and the environment picker stay
        // pinned at the right edge and the newest (active) tab is in view.
        await shot(w, { id: 130, area: 'http', screen: 'tab-strip-overflow' }, async () => {
          for (let i = 0; i < 14; i++) {
            const before = await w.getByTestId('endpoint-tab').count()
            await w.getByTestId('tab-new').click()
            await expect(w.getByTestId('endpoint-tab')).toHaveCount(before + 1)
          }
          await expect(w.getByTestId('tab-new')).toBeVisible()
          await expect(w.getByTestId('env-selector')).toBeVisible()
          await expect(w.getByTestId('endpoint-tab').last()).toBeVisible()
        })

        // #251: narrow window + right panel opened by hand → compact URL bar,
        // Save moved into the overflow menu.
        await shot(
          w,
          { id: 131, area: 'http', screen: 'url-bar-narrow-right-panel', state: 'narrow' },
          async () => {
            await openSeeded(w, 'Create order')
            await setRightPanelOpen(w, true)
            await setContentSize(app, { width: 1024, height: 700 })
            await expect(w.getByTestId('url-more-btn')).toBeVisible({ timeout: 8_000 })
          },
        )
        await shot(
          w,
          { id: 132, area: 'http', screen: 'url-bar-overflow-menu', state: 'narrow' },
          async () => {
            await w.getByTestId('url-more-btn').click()
            await expect(w.getByTestId('url-more-menu')).toBeVisible()
          },
        )
        await dismissOverlays(w)
        if (T.origContent) await setContentSize(app, T.origContent).catch(() => {})
        await attempt('restore right panel (14)', () => setRightPanelOpen(w, rightPanelWasOpen))
        await closeAllTabs(w)

        // #256: literal Basic password + literal X-API-Key header must come out
        // as *** in Generate Code while "Include secret values" is off.
        await shot(
          w,
          { id: 125, area: 'http', screen: 'generate-code-secrets-masked', state: 'filled' },
          async () => {
            await openHttpRequestTab(w)
            await fillUrl(w, `${T.http}/post`)
            await addHeader(w, 'X-API-Key', 'sk_live_9f8e7d6c5b4a3210')
            await setAuthBasic(w, 'demo', 'p4ss-w0rd-literal-42')
            await setRightPanelOpen(w, true)
            await w
              .getByTestId('right-panel')
              .getByTitle(/^Code$|^Kod$/)
              .click()
            await expect(w.getByTestId('codegen-language-select')).toBeVisible()
            const include = w.getByTestId('codegen-include-secrets')
            if (await include.isChecked().catch(() => false)) await include.uncheck()
            await expect(w.getByTestId('right-panel')).toContainText('***', { timeout: 8_000 })
          },
        )
        await attempt('close right panel (14)', () => setRightPanelOpen(w, rightPanelWasOpen))

        // #287: SSL verification overridden to off on this request, then back
        // to "inherit" through the "Use inherited" link.
        const sslSwitch = w.getByTestId('settings-ssl-verify')
        const sslSource = w.getByTestId('settings-ssl-verify-source')
        await shot(
          w,
          { id: 126, area: 'http', screen: 'settings-ssl-override', state: 'filled' },
          async () => {
            await w.getByTestId('req-tab-settings').click()
            await expect(sslSwitch).toBeAttached()
            if (await sslSwitch.isChecked())
              await sslSwitch.locator('xpath=ancestor::label[1]').click()
            await expect(sslSwitch).not.toBeChecked()
            await expect(sslSource).toHaveAttribute('data-inherited', 'false')
            await expect(w.getByTestId('settings-ssl-verify-inherit')).toBeVisible()
          },
        )
        await shot(
          w,
          { id: 127, area: 'http', screen: 'settings-ssl-inherited', state: 'filled' },
          async () => {
            await w.getByTestId('settings-ssl-verify-inherit').click()
            await expect(sslSource).toHaveAttribute('data-inherited', 'true')
            await expect(w.getByTestId('settings-ssl-verify-inherit')).toHaveCount(0)
          },
        )
      } finally {
        if (T.origContent) await setContentSize(app, T.origContent).catch(() => {})
        await setRightPanelOpen(w, rightPanelWasOpen).catch(() => {})
      }
    },
  )

  // 2xx ─ Issue acceptance shots: realtime tabs, refused connections, Turkish ───
  group(
    '15 fresh realtime tabs, refused connections, Turkish realtime (#253 #257 #258 #261)',
    async (c) => {
      const { w } = c
      const urls = getTestServerUrls()

      // #257: a fresh tab starts empty, the URL field shows its placeholder.
      const fresh = async (
        id: number,
        area: string,
        label: RegExp,
        urlTestId: string,
      ): Promise<void> => {
        await shot(w, { id, area, screen: 'new-tab', state: 'empty' }, async () => {
          await openNewDropdownItem(w, label)
          await expect(w.getByTestId(urlTestId)).toBeVisible()
        })
        await closeAllTabs(w)
      }
      await fresh(222, 'websocket', /WebSocket/i, 'ws-url')
      await fresh(232, 'sse', /SSE/i, 'sse-url')
      await fresh(203, 'graphql', /GraphQL/i, 'graphql-url')

      // #253: connection refused must read as a real error with a hint.
      await shot(
        w,
        { id: 231, area: 'sse', screen: 'connect-refused', state: 'error' },
        async () => {
          await openNewDropdownItem(w, /SSE/i)
          await w.getByTestId('sse-url').fill('http://127.0.0.1:9/events')
          await w.getByTestId('sse-connect').click()
          await expect(w.getByTestId('sse-message')).toHaveAttribute('data-state', 'error', {
            timeout: 20_000,
          })
        },
      )
      await disconnectIfConnected(w)
      await closeAllTabs(w)
      await shot(
        w,
        { id: 236, area: 'mqtt', screen: 'connect-refused', state: 'error' },
        async () => {
          await openNewDropdownItem(w, /MQTT/)
          await w.getByTestId('mqtt-url').fill('mqtt://127.0.0.1:9')
          await w.getByTestId('mqtt-connect').click()
          await expect(w.getByTestId('mqtt-error')).toBeVisible({ timeout: 20_000 })
        },
      )
      await disconnectIfConnected(w)
      await closeAllTabs(w)

      // #258/#261: Turkish UI. Everything is opened in English first (the
      // helpers match English labels), then the language is switched on the
      // open tab — the tab keeps its connection and its message log.
      try {
        await attempt('ws tab for Turkish shot', async () => {
          await openNewDropdownItem(w, /WebSocket/i)
          await w.getByTestId('ws-url').fill(urls.ws)
          await w.getByTestId('ws-connect').click()
          await expect(w.getByTestId('ws-disconnect')).toBeVisible({ timeout: 15_000 })
          await fillMonaco(w, 'ws-composer', '{"type":"ping","seq":1}')
          await w.getByRole('button', { name: /Send Message/i }).click()
          await expect(w.getByTestId('ws-row-badge').first()).toBeVisible({ timeout: 15_000 })
        })
        await shot(
          w,
          { id: 223, area: 'websocket', screen: 'message-log-format', state: 'tr' },
          async () => {
            await setLocale(w, 'tr')
            await expect(w.getByTestId('ws-row-badge').first()).toHaveText(/JSON/)
          },
        )
        await setLocale(w, 'en')
        await disconnectIfConnected(w)
        await closeAllTabs(w)

        // The SSE Body-disabled hint is a native `title` (not capturable);
        // the visible Turkish SSE editor is what this shot proves.
        await attempt('sse tab for Turkish shot', async () => {
          await openNewDropdownItem(w, /SSE/i)
          await w.getByTestId('sse-url').fill(urls.sse)
          await w.getByTestId('sse-connect').click()
          await expect(w.getByTestId('sse-status')).toHaveAttribute('data-state', 'connected', {
            timeout: 15_000,
          })
        })
        await shot(w, { id: 233, area: 'sse', screen: 'editor', state: 'tr' }, async () => {
          await setLocale(w, 'tr')
          await expect(w.getByTestId('sse-status')).toBeVisible()
          await w.getByTestId('sse-status').hover()
        })
        await setLocale(w, 'en')
        await disconnectIfConnected(w)
        await closeAllTabs(w)

        // A request created while the UI is Turkish gets the Turkish default name.
        await shot(w, { id: 100, area: 'http', screen: 'new-tab', state: 'tr' }, async () => {
          await setLocale(w, 'tr')
          await w.getByTestId('tab-new').click()
          await expect(w.getByTestId('endpoint-tab').last()).toContainText('Yeni İstek')
        })
      } finally {
        await setLocale(w, 'en').catch((e) => note('restore locale (15)', e))
      }
    },
  )

  // 3xx ─ Issue acceptance shots: runner configuration ─────────────────────────
  group('16 runner config: fail script, schedule mode at a narrow size (#255 #267)', async (c) => {
    const { w, app } = c
    const suite = 'Regression suite'
    await shot(
      w,
      { id: 305, area: 'tests', screen: 'run-config-fail-script', state: 'filled' },
      async () => {
        await runSuiteFromContextMenu(w, suite)
        await waitRunnerConfigReady(w)
        const failScript = w.getByTestId('runner-fail-script')
        await failScript.scrollIntoViewIfNeeded()
        await failScript.fill("console.log('Regression suite failed: notify the on-call channel');")
        await expect(failScript).toHaveValue(/Regression suite failed/)
      },
    )
    await shot(
      w,
      { id: 306, area: 'runner', screen: 'config-schedule', state: 'narrow' },
      async () => {
        await w
          .getByTestId('workbench')
          .getByLabel(/Schedule runs/i)
          .check()
        await setContentSize(app, { width: 1024, height: 700 })
        const bar = w.getByTestId('runner-action-bar')
        await expect(bar).toBeVisible()
        await expect(bar).toBeInViewport()
      },
    )
  })

  // 99 ─ Cleanup ───────────────────────────────────────────────────────────────
  group('99 cleanup and summary', async (c) => {
    await finalCleanup(c)
  })
})

/** Delete everything the tour made and put theme / locale / size back. Idempotent. */
async function finalCleanup(c: Ctx): Promise<void> {
  const { w, app } = c
  await dismissOverlays(w).catch(() => {})
  await closeAllTabs(w).catch(() => {})
  if (T.origContent) await setContentSize(app, T.origContent).catch(() => {})
  await setLocale(w, 'en').catch((e) => note('cleanup: locale', e))
  if (
    (await w
      .locator('html')
      .getAttribute('data-theme')
      .catch(() => null)) !== T.origTheme
  ) {
    await setTheme(w, T.origTheme).catch((e) => note('cleanup: theme', e))
  }
  const pid = T.projectId
  if (pid) {
    await purgeMocks(w, pid).catch((e) => note('cleanup: mocks', e))
    for (const id of T.taskIds) await deleteScheduledTask(w, id).catch(() => {})
    await clearProjectHistory(w, pid).catch(() => {})
    await deleteProject(w, pid).catch((e) => note('cleanup: delete project', e))
    T.projectId = null
    T.projectName = null
  }
  await ensureTourProject(w).catch((e) => note('cleanup: canonical project', e))
  w.setDefaultTimeout(0)
  try {
    fs.writeFileSync(
      path.join(shotsDir(), '_summary.txt'),
      `screenshots: ${T.shots}\nfailed screens (see *-FAILED.txt): ${T.failed}\n`,
    )
  } catch {
    /* ignore */
  }
  T.cleaned = true
}
