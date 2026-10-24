/**
 * Issue #280 — Generate Code: Language → Variant selector + options.
 *  1. the modal opens on cURL (bash) with the request's method, URL and
 *     header; switching to Python → http.client and JavaScript → XHR changes
 *     the snippet, and the choice is remembered per language;
 *  2. the Options popover changes the snippet (Fetch "Follow redirects" off
 *     → `redirect: 'manual'`) and Escape closes only the popover.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { addHeader, fillUrl, sendAndWaitResponse } from '../helpers/ui/request-flow'
import { localHttpBin } from '../helpers/test-servers'

const http = () => localHttpBin()

/** The snippet in the Generate Code dialog (Monaco model when exposed, else the rendered lines). */
async function snippet(page: Page): Promise<string> {
  const modal = page.getByTestId('code-generator-modal')
  const viaModel = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="code-generator-modal"]')
    const monaco = (
      window as Window & {
        monaco?: {
          editor: {
            getEditors: () => Array<{
              getDomNode: () => HTMLElement | null
              getValue: () => string
            }>
          }
        }
      }
    ).monaco
    for (const ed of monaco?.editor?.getEditors?.() ?? []) {
      const dom = ed.getDomNode()
      if (dom && root?.contains(dom)) return ed.getValue()
    }
    return null
  })
  if (viaModel !== null) return viaModel
  const lines = modal.locator('.monaco-editor .view-lines')
  await expect(lines).toBeVisible({ timeout: 15_000 })
  return (await lines.innerText()).replace(/ /g, ' ')
}

async function expectSnippet(page: Page, ...parts: string[]): Promise<void> {
  for (const p of parts) await expect.poll(() => snippet(page), { timeout: 15_000 }).toContain(p)
}

uiTest.describe('Issue #280 — Generate Code languages, variants and options', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  // The selection lives in ui.store for the whole session and the `ui` project
  // shares one Electron instance: put every default back so later specs (e.g.
  // tier5 F16) open Generate Code on cURL, Python on Requests, JS on Fetch.
  uiTest.afterEach(async ({ window }) => {
    const close = window.getByTestId('code-generator-close')
    if (await close.isVisible().catch(() => false)) {
      const restore: Array<[string, string]> = [
        ['python', 'python-requests'],
        ['javascript', 'js-fetch'],
      ]
      for (const [lang, variant] of restore) {
        await window.getByTestId(`codegen-language-${lang}`).click()
        await window.getByTestId(`codegen-variant-${variant}`).click()
        const options = window.getByTestId('codegen-options')
        if ((await options.getAttribute('data-customised')) === 'true') {
          await options.click()
          await window.getByTestId('codegen-options-reset').click()
          await window.keyboard.press('Escape')
        }
      }
      await window.getByTestId('codegen-language-curl').click()
      await close.click()
    }
    await expect(window.getByTestId('code-generator-modal')).toHaveCount(0)
  })

  uiTest('switches language and variant; the snippet follows', async ({ window }) => {
    const url = `${http()}/get?src=codegen280`
    await fillUrl(window, url)
    await addHeader(window, 'X-Trace', 'cg-280')
    await sendAndWaitResponse(window)

    await window.getByTestId('response-code-btn').click()
    await expect(window.getByTestId('code-generator-modal')).toBeVisible()
    await expect(window.getByTestId('codegen-language-curl')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expectSnippet(window, `curl -X GET '${url}'`, "-H 'X-Trace: cg-280'")

    await window.getByTestId('codegen-language-python').click()
    await expect(window.getByTestId('codegen-variant-python-requests')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expectSnippet(window, `requests.get('${url}'`, '"X-Trace": "cg-280"')
    await window.getByTestId('codegen-variant-python-http-client').click()
    await expectSnippet(window, 'import http.client', "conn.request('GET'", "'X-Trace': 'cg-280'")

    await window.getByTestId('codegen-language-javascript').click()
    await window.getByTestId('codegen-variant-js-xhr').click()
    await expectSnippet(
      window,
      `xhr.open('GET', '${url}')`,
      "xhr.setRequestHeader('X-Trace', 'cg-280')",
    )

    // Back to Python: http.client is remembered.
    await window.getByTestId('codegen-language-python').click()
    await expect(window.getByTestId('codegen-variant-python-http-client')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expectSnippet(window, 'import http.client')
  })

  uiTest('options change the snippet; Escape closes only the popover', async ({ window }) => {
    await fillUrl(window, `${http()}/get?src=codegen280-options`)
    await sendAndWaitResponse(window)
    await window.getByTestId('response-code-btn').click()
    await window.getByTestId('codegen-language-javascript').click()
    await window.getByTestId('codegen-variant-js-fetch').click()
    await expectSnippet(window, "method: 'GET'")

    await window.getByTestId('codegen-options').click()
    const panel = window.getByTestId('codegen-options-panel')
    await expect(panel).toBeVisible()
    await panel.getByTestId('codegen-option-followRedirect').click()
    await expectSnippet(window, "redirect: 'manual'")

    await window.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(window.getByTestId('code-generator-modal')).toBeVisible()

    // Reset to defaults puts the snippet back.
    await window.getByTestId('codegen-options').click()
    await window.getByTestId('codegen-options-reset').click()
    await expect.poll(() => snippet(window)).not.toContain("redirect: 'manual'")
    await expect(window.getByTestId('codegen-options')).not.toHaveAttribute('data-customised')
    await window.keyboard.press('Escape')
  })
})
