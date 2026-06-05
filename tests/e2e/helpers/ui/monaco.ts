import type { Page, Locator } from '@playwright/test'

/** Locate a Monaco editor inside a testid wrapper or by index. */
export function monacoEditor(page: Page, testId?: string): Locator {
  if (testId) {
    return page.getByTestId(testId).locator('.monaco-editor')
  }
  return page.locator('.monaco-editor').first()
}

/** Fill Monaco via model API when available, else keyboard typing. */
export async function fillMonaco(page: Page, testId: string, text: string): Promise<void> {
  const setViaModel = await page.evaluate(
    ({ id, value }) => {
      const root = document.querySelector(`[data-testid="${id}"]`)
      const monaco = (window as Window & { monaco?: { editor: { getEditors: () => Array<{ getDomNode: () => HTMLElement | null; setValue: (v: string) => void }> } } }).monaco
      const editors = monaco?.editor?.getEditors?.() ?? []
      for (const ed of editors) {
        const dom = ed.getDomNode()
        if (dom && root?.contains(dom)) {
          ed.setValue(value)
          return true
        }
      }
      return false
    },
    { id: testId, value: text },
  )

  const editor = monacoEditor(page, testId)
  if (!setViaModel) {
    await editor.click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${mod}+KeyA`)
    await page.keyboard.press('Backspace')
    await page.keyboard.insertText(text)
  }
  // Nudge @monaco-editor/react onChange after programmatic setValue or typing.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' ')
  await page.keyboard.press('Backspace')
  // HTTP tabs expose url-input; protocol editors (WS, GraphQL, gRPC…) do not.
  const urlInput = page.getByTestId('url-input')
  if (await urlInput.isVisible().catch(() => false)) {
    await urlInput.click()
  } else {
    await page.locator('body').click({ position: { x: 4, y: 4 } })
  }
  await page.waitForTimeout(150)
}

/** Read visible Monaco model text via evaluate. */
export async function readMonaco(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => {
    const textarea = el.querySelector('textarea.inputarea') as HTMLTextAreaElement | null
    return textarea?.value ?? el.textContent ?? ''
  })
}
