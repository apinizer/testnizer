/**
 * MCP tool arguments in e2e flows. The args editor opens in the Form view by
 * default (issue #162 decision), so a spec that types raw JSON must switch to
 * the JSON view first. Clicking the JSON toggle is idempotent (it is never
 * disabled — only Form is, for schemas the form cannot represent) and the
 * choice is remembered per user, which is harmless for later specs: the
 * textarea and the form edit the same `toolArgs`.
 */
import { expect, type Page } from '@playwright/test'

/** Switch the tool's arguments editor to the raw JSON view. */
export async function showMcpJsonArgs(page: Page): Promise<void> {
  await page.getByTestId('mcp-args-view-json').click()
  await expect(page.getByTestId('mcp-tool-args')).toBeVisible()
}

/**
 * Switch the selected tool's arguments editor to the Form view. The view is
 * remembered per user and the ui project shares one Electron, so a spec that
 * relies on Form-view behaviour (an empty optional field is not sent, #162
 * follow-up) sets it explicitly; switching drops the JSON skeleton's empty
 * optional values.
 */
export async function showMcpFormArgs(page: Page): Promise<void> {
  await page.getByTestId('mcp-args-view-form').click()
  await expect(page.getByTestId('mcp-args-view-form')).toHaveAttribute('aria-pressed', 'true')
}

/** Replace the selected tool's arguments with `json` (raw text, `{{var}}` allowed). */
export async function fillMcpArgs(page: Page, json: string): Promise<void> {
  await showMcpJsonArgs(page)
  await page.getByTestId('mcp-tool-args').fill(json)
}
