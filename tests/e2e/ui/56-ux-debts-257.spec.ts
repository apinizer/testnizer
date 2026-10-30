/**
 * Issue #257 — UX debts, end to end (the visible half of the unit contracts).
 *
 *  1. new WebSocket / SSE / GraphQL tabs start with an EMPTY url field
 *  2. the right-panel open/closed choice is a persisted preference
 *  3. Mock port dialog: inline validation while typing, privileged-port hint
 *  4. secret variable mask is neutral-coloured and explained once
 *  5. one shortcut notation (command palette == Settings -> Shortcuts)
 *
 * Unit contracts: tests/renderer/new-tab-empty-urls-257, right-panel-pref-257,
 * mock-port-modal-257, secret-mask-257, shortcut-*-257. Export order is covered
 * at the data layer (tests/main/export-order-tree-257.test.ts), the live WebSocket
 * "one status indicator" at tests/renderer/ws-status-once-257.test.tsx (needs a
 * WS server; not duplicated here).
 *
 * The `ui` project shares ONE Electron: everything changed is restored in `finally`.
 * Authored without running Electron (`--list` only); the orchestrator runs it.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  fillCommandPalette,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../helpers/ui/bootstrap'
import { addVariable, closeEnvModal, openEnvModal, openGlobalsPane } from '../helpers/ui/env'
import { persistedRightPanelCollapsed, setRightPanelOpen } from '../helpers/ui/layout-extra'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Issue #257 — UX debts', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  const NEW_TABS = [
    { label: /WebSocket/i, testId: 'ws-url' },
    { label: /SSE/i, testId: 'sse-url' },
    { label: /GraphQL/i, testId: 'graphql-url' },
  ] as const

  for (const { label, testId } of NEW_TABS) {
    uiTest(
      `new ${testId.split('-')[0]} tab starts with an empty URL and a placeholder`,
      async ({ window }) => {
        try {
          await openNewDropdownItem(window, label)
          const input = window.getByTestId(testId)
          await expect(input).toBeVisible({ timeout: 8_000 })
          await expect(input).toHaveValue('')
          const placeholder = await input.getAttribute('placeholder')
          expect((placeholder ?? '').length, 'a placeholder shows the example').toBeGreaterThan(0)
        } finally {
          await closeAllTabs(window)
        }
      },
    )
  }

  uiTest(
    'right panel: the user choice is persisted as ui.rightPanelCollapsed',
    async ({ window }) => {
      const wasOpen = await window
        .getByTestId('right-panel')
        .isVisible()
        .catch(() => false)
      try {
        await openHttpRequestTab(window)
        await setRightPanelOpen(window, true)
        await expect
          .poll(() => persistedRightPanelCollapsed(window), { timeout: 5_000 })
          .toBe(false)
        await setRightPanelOpen(window, false)
        await expect.poll(() => persistedRightPanelCollapsed(window), { timeout: 5_000 }).toBe(true)
      } finally {
        await setRightPanelOpen(window, wasOpen).catch(() => {})
        await closeAllTabs(window)
      }
    },
  )

  uiTest(
    'Mock port: inline error while typing, calm hint for privileged ports',
    async ({ window }) => {
      try {
        await navigateSidebar(window, 'mocks')
        await window.getByTestId('mock-new').click()
        await expect(window.getByTestId('mock-new-dialog')).toBeVisible({ timeout: 10_000 })
        const port = window.getByTestId('mock-new-port')

        await port.fill('70000')
        const error = window.getByTestId('mock-new-port-error')
        await expect(error).toBeVisible()
        await expect(error).toContainText(/1.65535/)
        await expect(window.getByTestId('mock-new-create')).toBeEnabled()

        await port.fill('80')
        await expect(error).toHaveCount(0)
        const hint = window.getByTestId('mock-new-port-hint')
        await expect(hint).toBeVisible()
        await expect(hint).toContainText(/elevated permissions/i)

        await port.fill('31777')
        await expect(hint).toHaveCount(0)
        await expect(error).toHaveCount(0)
      } finally {
        await window
          .getByTestId('mock-new-cancel')
          .click()
          .catch(() => {})
        await dismissOverlays(window)
        await navigateSidebar(window, 'apis')
      }
    },
  )

  uiTest(
    'secret mask: neutral colour, explained once, never the string-orange',
    async ({ window }) => {
      const key = `sec_${uid()}`
      await openEnvModal(window)
      try {
        await openGlobalsPane(window)
        await addVariable(window, { key, initialValue: 'top-secret-value', secret: true })
        const row = window.getByTestId('env-var-row').last()
        await expect(window.getByTestId('env-secret-note').first()).toBeVisible()
        for (const id of ['env-var-initial', 'env-var-current']) {
          const field = row.getByTestId(id)
          await expect(field).toHaveAttribute('title', /.+/)
          const colors = await field.evaluate((el) => {
            const probe = document.createElement('span')
            probe.style.color = 'var(--json-string)'
            document.body.appendChild(probe)
            const orange = getComputedStyle(probe).color
            probe.remove()
            return { actual: getComputedStyle(el).color, orange }
          })
          expect(colors.actual, `${id} must not use the string colour`).not.toBe(colors.orange)
        }
      } finally {
        await window
          .getByTestId('env-var-row')
          .last()
          .getByRole('button', { name: /remove/i })
          .click()
          .catch(() => {})
        await closeEnvModal(window).catch(() => dismissOverlays(window))
      }
    },
  )

  uiTest(
    'one shortcut notation: command palette equals Settings -> Shortcuts',
    async ({ window }) => {
      try {
        await openCommandPalette(window)
        await fillCommandPalette(window, 'New tab')
        const item = window.getByTestId('command-palette').getByRole('option').first()
        await expect(item).toBeVisible()
        const paletteText = (await item.innerText()).replace(/\s+/g, ' ').trim()
        await window.keyboard.press('Escape')

        const mac = process.platform === 'darwin'
        const chord = mac ? '⌘T' : 'Ctrl+T'
        expect(paletteText.endsWith(chord), `palette row "${paletteText}" ends with ${chord}`).toBe(
          true,
        )
        expect(paletteText).not.toMatch(/Cmd|\s\+\s/)

        await window.getByTestId('nav-settings').click()
        const modal = window.getByTestId('project-detail-modal')
        await expect(modal).toBeVisible({ timeout: 8_000 })
        await window.getByTestId('project-detail-tab-shortcuts').click()
        const cells = (await modal.locator('table td').allInnerTexts()).map((s) => s.trim())
        expect(cells, 'Settings shortcut cells use the same chord').toContain(chord)
        expect(
          cells.some((c) => /\s\+\s/.test(c)),
          'no spaced " + " notation left',
        ).toBe(false)
      } finally {
        await dismissOverlays(window)
      }
    },
  )
})
