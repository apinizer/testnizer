/**
 * Fixture for the documentation screenshot capture (NOT a test suite).
 *
 * One Electron instance per worker, on a throwaway --user-data-dir, never the
 * real profile. It boots the app in English / light theme at a 1440×900
 * content size (device scale 2), creates the fictional "Acme Orders" project,
 * seeds it from `seed-data.ts` and starts an HTTP mock server the requests are
 * sent to. Each capture test then drives one screen and writes a PNG.
 */
import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { cleanLaunchEnv, assertElectronNativeAbi, firstAppWindow } from '../helpers/electron-env'
import {
  acceptEula,
  loginAsGuest,
  createAndOpenProject,
  waitForApiBridge,
} from '../helpers/ui/bootstrap'
import { stubScriptTrustDialog, allowEveryProjectScripts } from '../helpers/ui/script-trust'
import { acmeCollection, acmeMcpServer, stagingVariables } from './seed-data'
import { DEMO_PORTS, startDemoServers, type DemoServers } from './demo-servers'

export const PROJECT_NAME = 'Acme Orders'
export const OUT_DIR = path.resolve(__dirname, '../../../website/public/docs/screenshots')
export const WIDTH = 1440
export const HEIGHT = 900

interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface Seed {
  projectId: string
  workspaceId: string
  envId: string
  mockServerId: string
  mockPort: number
  mcpServerId: string
  mcpUrl: string
}

export interface DocsFixtures {
  demo: DemoServers
  app: ElectronApplication
  window: Page
  seed: Seed
}

/** `window.api` call that throws on `{ success: false }`. */
export async function ipc<T>(page: Page, fn: string, ...args: unknown[]): Promise<T> {
  const res = (await page.evaluate(
    async ({ fn: f, args: a }) => {
      let target: unknown = (window as unknown as { api: unknown }).api
      let owner: unknown = null
      for (const part of f.split('.')) {
        owner = target
        target = (target as Record<string, unknown>)[part]
      }
      return (target as (...x: unknown[]) => Promise<unknown>).apply(owner, a)
    },
    { fn, args },
  )) as IpcResult<T>
  if (!res || res.success === false) throw new Error(`${fn}: ${res?.error ?? 'failed'}`)
  return res.data as T
}

async function seedProject(page: Page): Promise<Seed> {
  const workspaces = await ipc<Array<{ id: string }>>(page, 'workspace.list')
  const workspaceId = workspaces[0].id
  const projects = await ipc<Array<{ id: string; name: string }>>(page, 'project.list', workspaceId)
  const slug = PROJECT_NAME.replace(/\s+/g, '-').toLowerCase()
  const project = projects.find((p) => p.name === slug || p.name === PROJECT_NAME)
  if (!project) throw new Error('seed: project not found')
  const projectId = project.id

  // HTTP mock server that answers every request in the collection.
  const mockPort = DEMO_PORTS.httpMock
  const server = await ipc<{ id: string }>(page, 'mock.server.create', {
    projectId,
    name: 'Acme Orders mock',
    port: mockPort,
  })
  // Started from its editor after the reload (startMocksFromUi), so the list
  // and header show the state the app itself put it in.
  await ipc(page, 'mock.importPostman', server.id, JSON.stringify(acmeCollection()))

  // Collection → APIs tree.
  const imported = await ipc<{ success?: boolean; error?: string }>(
    page,
    'importExport.importPostman',
    { projectId, content: JSON.stringify(acmeCollection()), folderId: null },
  )
  if (imported && imported.success === false) throw new Error(`import: ${imported.error}`)

  // Environment with a secret.
  const env = await ipc<{ id: string }>(page, 'environment.create', {
    workspace_id: workspaceId,
    project_id: projectId,
    name: 'Staging',
  })
  for (const v of stagingVariables(`http://127.0.0.1:${mockPort}`)) {
    await ipc(page, 'envVariable.create', {
      environment_id: env.id,
      key: v.key,
      value: v.value,
      initial_value: v.value,
      secret: v.secret ?? false,
    })
  }
  const local = await ipc<{ id: string }>(page, 'environment.create', {
    workspace_id: workspaceId,
    project_id: projectId,
    name: 'Local',
  })
  await ipc(page, 'envVariable.create', {
    environment_id: local.id,
    key: 'baseUrl',
    value: 'http://localhost:8080',
    initial_value: 'http://localhost:8080',
    secret: false,
  })
  // Project (collection) variables — the "Globals" list.
  for (const [key, value] of [
    ['apiVersion', 'v2'],
    ['supportEmail', 'support@example.com'],
    ['defaultLimit', '20'],
  ]) {
    await ipc(page, 'globalVariable.create', {
      workspace_id: workspaceId,
      project_id: projectId,
      key,
      value,
      initial_value: value,
    })
  }
  // Mock MCP server (tools / resources / prompts) — the MCP, scan and AI Chat frames use it.
  const mcp = await ipc<{ id: string }>(
    page,
    'mockMcp.server.create',
    acmeMcpServer(projectId, DEMO_PORTS.mcpMock),
  )
  await ipc(page, 'mockMcp.server.start', mcp.id)

  await allowEveryProjectScripts(page)
  return {
    projectId,
    workspaceId,
    envId: env.id,
    mockServerId: server.id,
    mockPort,
    mcpServerId: mcp.id,
    mcpUrl: `http://127.0.0.1:${DEMO_PORTS.mcpMock}/mcp`,
  }
}

/** Reload the window so every store re-reads the seeded rows, then pick Staging. */
async function activateSeed(page: Page, seed: Seed): Promise<void> {
  await ipc(page, 'environment.setActiveForProject', seed.projectId, seed.envId)
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await waitForApiBridge(page)
  const tab = page.locator(`[data-testid="header-project-tab"][title="${PROJECT_NAME}"]`)
  if ((await tab.count()) === 0) {
    await createAndOpenProject(page, PROJECT_NAME)
  } else {
    await tab.first().click()
  }
  await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('footer-env')).toContainText('Staging', { timeout: 10_000 })
}

export const docsTest = base.extend<object, DocsFixtures>({
  demo: [
    // Playwright needs the destructuring form to see that a fixture takes no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const servers = await startDemoServers()
      await use(servers)
      await servers.close().catch(() => {})
    },
    { scope: 'worker' },
  ],
  app: [
    // Playwright needs the destructuring form to see that a fixture takes no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const mainPath = path.resolve(__dirname, '../../../out/main/index.js')
      if (!fs.existsSync(mainPath)) throw new Error(`Run "npm run build" first (${mainPath})`)
      assertElectronNativeAbi()
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-docs-shots-'))
      const app = await electron.launch({
        args: [mainPath, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=2'],
        env: cleanLaunchEnv(),
      })
      await stubScriptTrustDialog(app, 'allow')
      await use(app)
      const pid = app.process().pid
      if (pid) {
        try {
          execFileSync('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore' })
        } catch {
          /* no children */
        }
      }
      try {
        app.process().kill('SIGKILL')
      } catch {
        /* gone */
      }
      void app.close().catch(() => {})
      fs.rmSync(userDataDir, { recursive: true, force: true })
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  window: [
    async ({ app }, use) => {
      const win = await firstAppWindow(app)
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const w = BrowserWindow.getAllWindows()[0]
          w.setMinimumSize(800, 600)
          w.setContentSize(size.w, size.h)
        },
        { w: WIDTH, h: HEIGHT },
      )
      await waitForApiBridge(win)
      await acceptEula(win)
      await loginAsGuest(win)
      await createAndOpenProject(win, PROJECT_NAME)
      await use(win)
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  seed: [
    async ({ window, demo }, use) => {
      void demo
      const seed = await seedProject(window)
      await activateSeed(window, seed)
      await createMockViaDialog(window, 'sse', 'notifications', 'Order events', DEMO_PORTS.sseMock)
      await createMockViaDialog(window, 'ai', 'tools', 'Support assistant LLM', DEMO_PORTS.aiMock)
      for (const name of ['Acme Orders mock', 'Order events', 'Support assistant LLM']) {
        await startMockFromUi(window, name)
      }
      await closeTabs(window)
      await window.getByTestId('nav-apis').click()
      await use(seed)
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

export { expect }

/**
 * Write one screenshot (full window, or clipped to a locator) after refusing
 * frames that show an error: an error toast, the render-error boundary, or a
 * failed-request panel. Info / success toasts are hidden, never kept in frame.
 */
export async function shot(page: Page, name: string, target?: Locator): Promise<string> {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${name}.png`)
  await page.mouse.move(WIDTH - 4, HEIGHT - 4).catch(() => {})
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {})
  await expect(
    page.locator('.animate-spin:visible, [data-testid="response-loading"]:visible'),
  ).toHaveCount(0, { timeout: 8_000 })
  await expect(page.getByText('Testnizer hit a render error')).toHaveCount(0)
  await expect(page.locator('[data-testid="response-error"]:visible')).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
  await page.addStyleTag({ content: '[data-sonner-toaster]{display:none !important}' })
  await page.waitForTimeout(500)
  if (target) await target.screenshot({ path: file, animations: 'disabled', caret: 'hide' })
  else await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' })
  await optimize(file)
  return file
}

/** Re-encode as a palette PNG when that is smaller; fail a frame above the size cap. */
async function optimize(file: string): Promise<void> {
  const sharp = (await import('sharp')).default
  const original = fs.readFileSync(file)
  const palette = await sharp(original).png({ palette: true, quality: 90, effort: 10 }).toBuffer()
  if (palette.length < original.length) fs.writeFileSync(file, palette)
  const kb = Math.round(fs.statSync(file).size / 1024)
  if (kb > 450) throw new Error(`${path.basename(file)} is ${kb} KB (cap 450 KB)`)
}

/** Close every workbench tab (the app's own Force Close All). */
export async function closeTabs(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  const tabs = page.getByTestId('endpoint-tab')
  if ((await tabs.count()) === 0) return
  await tabs.first().click({ button: 'right' })
  await page.getByRole('button', { name: /Force Close All Tabs/i }).click({ timeout: 3_000 })
  await expect(tabs).toHaveCount(0, { timeout: 5_000 })
}

/** Open a request from the APIs tree by its name. */
export async function openRequest(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-apis').click()
  const search = page.getByTestId('tree-search')
  await search.fill(name)
  await page.getByTestId('tree-node').filter({ hasText: name }).first().click()
  await expect(page.getByTestId('url-input')).toBeVisible({ timeout: 10_000 })
  await search.fill('')
}

/** Create an SSE / AI mock through the "New mock server" dialog on a fixed port. */
export async function createMockViaDialog(
  page: Page,
  kind: 'sse' | 'ai',
  preset: string,
  name: string,
  port: number,
): Promise<void> {
  await page.getByTestId('nav-mocks').click()
  await page.getByTestId('mock-new').click()
  await page.getByTestId('mock-new-option-http').click()
  const dialog = page.getByTestId('mock-new-dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.getByTestId(`mock-new-type-${kind}`).click()
  await dialog.getByTestId(`mock-new-preset-${preset}`).click()
  await dialog.getByTestId('mock-new-name').fill(name)
  await dialog.getByTestId('mock-new-port').fill(String(port))
  await dialog.getByTestId('mock-new-create').click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
}

/** Open a mock server's editor from the Mocks list. */
export async function openMock(page: Page, name: string): Promise<void> {
  await page.getByTestId('nav-mocks').click()
  await page.getByText(name, { exact: true }).first().click()
  await expect(page.getByTestId('workbench')).toBeVisible()
}

/** Start an HTTP-family mock with its editor's Start button. */
async function startMockFromUi(page: Page, name: string): Promise<void> {
  await openMock(page, name)
  const status = page.getByTestId('mock-status')
  await expect(status).toBeVisible({ timeout: 10_000 })
  if ((await status.getAttribute('data-status')) !== 'running') {
    await page.getByTestId('mock-start').click()
  }
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 10_000 })
}

/**
 * Move the request/response divider so the response pane gets `responseShare`
 * of the editor column (react-resizable-panels handle, dragged with the mouse).
 */
export async function setResponseShare(page: Page, responseShare: number): Promise<void> {
  const handle = page
    .locator('[data-panel-resize-handle-id][data-panel-group-direction="vertical"]:visible')
    .first()
  if ((await handle.count()) === 0) return
  const group = page.locator('[data-panel-group-direction="vertical"]:visible').first()
  const g = await group.boundingBox()
  const h = await handle.boundingBox()
  if (!g || !h) return
  const targetY = g.y + g.height * (1 - responseShare)
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2, targetY, { steps: 8 })
  await page.mouse.up()
}
