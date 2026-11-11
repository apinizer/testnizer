/**
 * Both ways to report an issue open the GitHub form on the built app, naming the
 * build and the real OS version. `shell.openExternal` is replaced so no browser
 * opens; the unit tests cannot reach Electron's process.getSystemVersion or the
 * application menu.
 */
import { expect, type ElectronApplication } from '@playwright/test'
import { uiTest } from './_setup'

async function captureOpenedUrls(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened: string[]; __realOpen: typeof shell.openExternal }
    g.__opened = []
    g.__realOpen = shell.openExternal
    shell.openExternal = async (url: string) => {
      g.__opened.push(url)
    }
  })
}

async function restoreOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __realOpen: typeof shell.openExternal }
    shell.openExternal = g.__realOpen
  })
}

async function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
}

function expectIssueForm(url: string): void {
  const parsed = new URL(url)
  expect(parsed.origin + parsed.pathname).toBe('https://github.com/apinizer/testnizer/issues/new')
  // Version, optional build, a named system with a real version, and the arch.
  expect(parsed.searchParams.get('body')).toMatch(
    /Testnizer \d+\.\d+\.\d+.* · (macOS|Windows|Linux) \d\S* (arm64|x64)$/,
  )
}

uiTest.describe('Report an issue or request a feature', () => {
  uiTest.beforeEach(async ({ app }) => {
    await captureOpenedUrls(app)
  })
  uiTest.afterEach(async ({ app }) => {
    await restoreOpenExternal(app)
  })

  uiTest('the session menu opens the form', async ({ app, window }) => {
    await window.getByTitle('Session', { exact: true }).click()
    await window.getByTestId('user-menu-report-issue').click()
    await expect(window.getByTestId('user-menu-report-issue')).toHaveCount(0)
    await expect.poll(() => openedUrls(app)).toHaveLength(1)
    expectIssueForm((await openedUrls(app))[0])
  })

  uiTest('the Help menu opens the same form', async ({ app, window }) => {
    await window.getByTitle('Session', { exact: true }).waitFor()
    await app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()?.items.find((item) => item.role === 'help')
      const entry = help?.submenu?.items.find((item) => item.label.startsWith('Report an Issue'))
      if (!entry) throw new Error('Help menu has no report item')
      entry.click()
    })
    await expect.poll(() => openedUrls(app)).toHaveLength(1)
    expectIssueForm((await openedUrls(app))[0])
  })
})
