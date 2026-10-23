/**
 * Issue #278 (+ the shared parser of issue #279) — paste a cURL command into
 * the HTTP URL bar. The text goes through the REAL clipboard (Electron's
 * `clipboard.writeText` + Mod+V), so a multi-line command keeps its newlines
 * exactly as a user's paste does (the `<input>` itself would strip them).
 *  1. a multi-line bash command fills method / URL / headers / body, the toast
 *     says so, and the filled request actually sends;
 *  2. a PowerShell `curl.exe` command (backtick continuation, `''`, 5.1 `\"`)
 *     fills the request too, its unknown option listed in the toast; Undo
 *     restores the previous request;
 *  3. a plain URL pastes as plain text — nothing is replaced, no toast.
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { clickRequestTab, fillUrl, sendAndReadStatus } from '../helpers/ui/request-flow'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { withClipboardText } from '../helpers/ui/clipboard'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()
const INHERIT_HELP = /inherits authorization from its folder/i
const NO_AUTH_HELP = /does not use any authorization/i

async function pasteIntoUrlBar(page: Page, app: ElectronApplication, text: string): Promise<void> {
  await withClipboardText(app, text, async () => {
    await page.getByTestId('url-input').click()
    await pressModShortcut(page, 'v')
  })
}

async function headerRows(page: Page): Promise<string[]> {
  await clickRequestTab(page, 'headers')
  const rows = page.locator('[data-testid^="kv-row-"]')
  const out: string[] = []
  for (let i = 0; i < (await rows.count()); i++) {
    const key = await rows.nth(i).getByTestId('kv-key').inputValue()
    if (!key) continue
    const value = await rows.nth(i).getByTestId('kv-value').locator('input').inputValue()
    out.push(`${key}: ${value}`)
  }
  return out
}

/** Body tab: the raw format and the editor text (waits for Monaco to mount — it loads lazily). */
async function expectRawBody(page: Page, format: string, contains: string): Promise<void> {
  await clickRequestTab(page, 'body')
  await expect(page.getByTestId('body-raw-format')).toHaveValue(format)
  const lines = page.getByTestId('body-raw-editor').locator('.monaco-editor .view-lines')
  await expect(lines).toBeVisible({ timeout: 15_000 })
  await expect.poll(async () => (await lines.innerText()).replace(/ /g, ' ')).toContain(contains)
}

uiTest.describe('Issue #278 — paste a cURL command into the URL bar', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  // The shared Electron instance outlives a test; do not leave a toast for the next one.
  uiTest.afterEach(async ({ window }) => {
    const close = window.getByTestId('curl-paste-close')
    if (await close.isVisible().catch(() => false)) await close.click()
    await expect(window.getByTestId('curl-paste-toast')).toHaveCount(0)
  })

  uiTest(
    'a multi-line bash cURL fills method, URL, headers and body — and sends',
    async ({ window, app }) => {
      const bash = [
        `curl '${http()}/post?src=paste' \\`,
        `  -X POST \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -H 'X-Trace: it'\\''s-278' \\`,
        `  --data-raw '{"name":"Ada","n":[1,2]}'`,
      ].join('\n')
      await pasteIntoUrlBar(window, app, bash)

      await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/post?src=paste`)
      await expect(window.getByTestId('url-method')).toContainText('POST')
      const toast = window.getByTestId('curl-paste-toast')
      await expect(toast).toBeVisible()
      await expect(toast).toHaveAttribute('data-dialect', 'bash')
      await expect(
        window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
      ).toHaveAttribute('data-dirty', 'true')

      expect(await headerRows(window)).toEqual([
        'Content-Type: application/json',
        "X-Trace: it's-278",
      ])
      await expectRawBody(window, 'json', '"name":"Ada"')
      // No auth flag, no credential header → Inherit (folder / project auth still applies).
      await clickRequestTab(window, 'auth')
      await expect(window.getByText(INHERIT_HELP)).toBeVisible()

      expect(await sendAndReadStatus(window)).toBe(200)
      await expect(window.getByTestId('res-tab-body')).toBeVisible()
    },
  )

  uiTest(
    'a PowerShell curl.exe command fills the request; Undo puts the old one back',
    async ({ window, app }) => {
      await fillUrl(window, `${http()}/get?before=1`)
      const ps = [
        `curl.exe '${http()}/anything/ps' \``,
        '  -X PUT `',
        "  -H 'X-Note: it''s' `",
        "  -H 'X-API-Key: k-278' `",
        `  -d '{\\"id\\":7,\\"tag\\":\\"x\\"}' \``,
        '  --frobnicate',
      ].join('\n')
      await pasteIntoUrlBar(window, app, ps)

      await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/anything/ps`)
      await expect(window.getByTestId('url-method')).toContainText('PUT')
      const toast = window.getByTestId('curl-paste-toast')
      await expect(toast).toHaveAttribute('data-dialect', 'powershell')
      await expect(toast.getByTestId('curl-paste-warning')).toHaveAttribute(
        'data-code',
        'unknown-flag',
      )
      expect(await headerRows(window)).toEqual(["X-Note: it's", 'X-API-Key: k-278'])
      await expectRawBody(window, 'json', '{"id":7,"tag":"x"}')
      // A credential header authenticates the command itself → No Auth (no second auth header).
      await clickRequestTab(window, 'auth')
      await expect(window.getByText(NO_AUTH_HELP)).toBeVisible()

      await toast.getByTestId('curl-paste-undo').click()
      await expect(window.getByTestId('url-input')).toHaveValue(`${http()}/get?before=1`)
      await expect(window.getByTestId('url-method')).toContainText('GET')
      await expect(window.getByTestId('curl-paste-toast')).toHaveCount(0)
    },
  )

  uiTest('a plain URL pastes as text — nothing is replaced, no toast', async ({ window, app }) => {
    await expect(window.getByTestId('url-input')).toHaveValue('')
    const plain = `${http()}/get?plain=1&b=2`
    await pasteIntoUrlBar(window, app, plain)
    await expect(window.getByTestId('url-input')).toHaveValue(plain)
    await expect(window.getByTestId('url-method')).toContainText('GET')
    await expect(window.getByTestId('curl-paste-toast')).toHaveCount(0)
  })
})
