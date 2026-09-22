/**
 * Issue #125 — "Save response": pin the current response to a saved request,
 * see it under the Saved tab, reopen the request, Open / Delete it.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  fillUrl,
  saveRequestToTree,
  sendAndWaitResponse,
  setBodyType,
  setHttpMethod,
} from '../../helpers/ui/request-flow'
import { treeClearSearch, treeOpenNode, treeSearch } from '../../helpers/ui/tree'
import { fillMonaco } from '../../helpers/ui/monaco'
import { clickContextMenuItem } from '../../helpers/ui/context-menu'
import { localHttpBin } from '../../helpers/test-servers'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Save response [issue #125]', () => {
  uiTest('save → Saved tab → reopen → Open → Delete', async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
    const name = `saved-resp-${uid()}`

    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?x=1`)
    await sendAndWaitResponse(window)

    // Scratch tab: the button explains instead of opening the name prompt.
    await window.getByTestId('response-save-btn').click()
    await expect(window.getByTestId('response-save-popover')).toHaveCount(0)

    await saveRequestToTree(window, name)

    await window.getByTestId('response-save-btn').click()
    const pop = window.getByTestId('response-save-popover')
    await expect(pop).toBeVisible()
    await pop.locator('input').fill('200 sample')
    await pop.locator('input').press('Enter')
    await expect(pop).toBeHidden({ timeout: 10_000 })

    await expect(window.getByTestId('res-tab-saved')).toContainText('1')
    await expect(window.getByTestId('saved-response-row')).toHaveCount(1)
    await expect(window.getByTestId('saved-response-row')).toContainText('200 sample')

    // Reopen from the tree: no response yet → saved-only panel lists it.
    await closeAllTabs(window)
    await treeOpenNode(window, name)
    try {
      await expect(window.getByTestId('response-saved-only')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('saved-response-row')).toHaveCount(1)
      // Open → the example gets its OWN read-only tab (request + response);
      // the owner tab is left untouched.
      await window
        .getByTestId('saved-response-row')
        .getByRole('button', { name: /^(Open|Aç)$/ })
        .click()
      await expect(window.getByTestId('example-view')).toBeVisible({ timeout: 10_000 })
      await expect(window.getByTestId('response-status')).toContainText('200')
      await expect(window.getByTestId('example-banner')).toContainText('200 sample')
      await expect(
        window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
      ).toContainText('200 sample')

      // Back on the owner tab (no live response there → the saved-only panel
      // lists the example directly): delete with confirm.
      await window.getByTestId('endpoint-tab').filter({ hasText: name }).first().click()
      await expect(window.getByTestId('response-saved-only')).toBeVisible({ timeout: 10_000 })
      await window
        .getByTestId('saved-response-row')
        .getByTitle(/Delete saved response|Kayıtlı yanıtı sil/)
        .click()
      await window.getByTestId('delete-confirm-btn').click()
      await expect(window.getByTestId('saved-response-row')).toHaveCount(0)
      // Deleting from the Saved tab also closed the example tab.
      await expect(
        window.getByTestId('endpoint-tab').filter({ hasText: '200 sample' }),
      ).toHaveCount(0)
    } finally {
      await treeClearSearch(window)
    }
  })

  uiTest(
    'examples are children of the request in the tree; a child opens the RESOLVED request + response',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await closeAllTabs(window)
      const name = `ex-tree-${uid()}`

      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await setHttpMethod(window, 'POST')
      // Body is a variable produced by the pre-request script — the classic
      // "what did we actually send?" case the example view exists for.
      await setBodyType(window, 'json', '{{employee_body}}')
      await window.getByTestId('req-tab-scripts').click()
      await window.getByTestId('scripts-pre').click()
      await fillMonaco(
        window,
        'scripts-pre-editor',
        `pm.variables.set('who', 'ada'); pm.variables.set('employee_body', JSON.stringify({ name: 'Ada', role: 'eng' }));`,
      )
      // URL last: once it holds `{{who}}` the variable-highlight overlay sits
      // over the input and the Monaco helper's blur-click can't reach it.
      await fillUrl(window, `${localHttpBin()}/post?who={{who}}`)
      await saveRequestToTree(window, name)
      await sendAndWaitResponse(window)

      const saveExample = async (label: string): Promise<void> => {
        await window.getByTestId('response-save-btn').click()
        const pop = window.getByTestId('response-save-popover')
        await expect(pop).toBeVisible()
        await pop.locator('input').fill(label)
        await pop.locator('input').press('Enter')
        await expect(pop).toBeHidden({ timeout: 10_000 })
      }
      await saveExample('200 first')
      await saveExample('200 second')
      await expect(window.getByTestId('saved-response-row')).toHaveCount(2)

      try {
        // Tree: both examples sit under the request row (search keeps the
        // parent and force-expands it).
        await treeSearch(window, name)
        const parent = window
          .locator('[data-testid="tree-node"][data-node-type="request"]')
          .filter({ hasText: name })
        await expect(parent).toHaveCount(1, { timeout: 10_000 })
        const children = window.locator('[data-testid="tree-node"][data-node-type="example"]')
        await expect(children).toHaveCount(2, { timeout: 10_000 })
        await expect(children.first()).toContainText('200 first')
        await expect(children.nth(1)).toContainText('200 second')
        await expect(children.first().getByTestId('tree-example-status')).toContainText('200')

        // Child click → example tab with the RESOLVED request.
        await children.first().click()
        await expect(window.getByTestId('example-view')).toBeVisible({ timeout: 10_000 })
        await expect(window.getByTestId('example-mode-sent')).toHaveAttribute('data-active', 'true')
        await expect(window.getByTestId('example-sent-url')).toContainText('who=ada')
        await expect(window.getByTestId('example-sent-body')).toContainText('"Ada"')
        await expect(window.getByTestId('example-sent-body')).not.toContainText('employee_body')
        await expect(window.getByTestId('response-status')).toContainText('200')

        // Original toggle shows the template.
        await window.getByTestId('example-mode-original').click()
        await expect(window.getByTestId('example-original-body')).toContainText('{{employee_body}}')
        await expect(window.getByTestId('example-original-url')).toContainText('{{who}}')

        // Parent click → the LIVE request; its editor still holds the template.
        await parent.click()
        const active = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
        await expect(active).toContainText(name)
        await expect(active).not.toContainText('200 first')
        await window.getByTestId('req-tab-body').click()
        await expect(window.getByTestId('body-raw-editor')).toContainText('employee_body')

        // Rename from the tree reaches the Saved tab.
        await children.nth(1).click({ button: 'right' })
        await clickContextMenuItem(window, /^(Rename|Yeniden adlandır)$/)
        const renameInput = children.nth(1).locator('input')
        await renameInput.fill('200 renamed')
        await renameInput.press('Enter')
        await expect(children.nth(1)).toContainText('200 renamed', { timeout: 10_000 })
        await parent.click()
        await window.getByTestId('res-tab-saved').click()
        await expect(window.getByTestId('saved-response-row').nth(0)).toContainText('200 renamed')
      } finally {
        await treeClearSearch(window)
      }
    },
  )

  uiTest(
    'opening a different saved request shows ITS examples, never the previous ones',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      await closeAllTabs(window)
      const a = `sr-a-${uid()}`
      const b = `sr-b-${uid()}`

      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?a=1`)
      await sendAndWaitResponse(window)
      await saveRequestToTree(window, a)
      await window.getByTestId('response-save-btn').click()
      await window.getByTestId('response-save-popover').locator('input').press('Enter')
      await expect(window.getByTestId('saved-response-row')).toHaveCount(1)

      await navigateSidebar(window, 'apis')
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?b=1`)
      await saveRequestToTree(window, b)
      await sendAndWaitResponse(window)
      await window.getByTestId('res-tab-saved').click()
      await expect(window.getByTestId('saved-response-row')).toHaveCount(0)
      await expect(window.getByTestId('res-tab-saved')).not.toContainText('1')
    },
  )
})
