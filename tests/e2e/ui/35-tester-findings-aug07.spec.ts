/**
 * The 7 August findings, walked through the real app.
 *
 *   #93  A new tab inside Tests opened the APIs request wizard, and returning
 *        to a suite's runner tab landed on the Tests overview instead of the run.
 *   #94  A collection converted to a suite arrived flat: no folders in the Tests
 *        sidebar, no folder tree in Run Sequence, no folder-level roles.
 *
 * #92 lives in 33-tester-findings-aug05 alongside the stop-button scenario it
 * changed.
 *
 * These exist because #94 is what happens when a fix is reasoned about instead
 * of used. The writer that mirrors the folder tree is covered by unit tests at
 * the DB level (suite-import-folders.test.ts), and the runner's reader was
 * covered when it was written — yet the feature was broken end to end for a
 * release, because nobody converted a collection and looked at the result. So
 * these tests do exactly that: build a nested collection in the APIs tree, use
 * the context-menu action a user would use, and then require the folders to be
 * on screen in both places that read them.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToFolder } from '../helpers/ui/request-flow'
import { addVariable, closeEnvModal, createEnvironment, openEnvModal } from '../helpers/ui/env'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import { treeContextAction, treeOpenNode } from '../helpers/ui/tree'
import { clickContextMenuItem } from '../helpers/ui/context-menu'
import { localHttpBin } from '../helpers/test-servers'
import type { Page } from '@playwright/test'

const uid = (): string => String(Date.now()).slice(-7)

/** The Tests sidebar has its own rows — `tree-node` is the APIs tree only. */
function suiteRow(page: Page, name: string) {
  return page.getByTestId('suite-row').filter({ hasText: name }).first()
}

async function suiteContextAction(page: Page, name: string, action: RegExp): Promise<void> {
  await suiteRow(page, name).click({ button: 'right' })
  await clickContextMenuItem(page, action)
}

/** Create a subfolder — the IPC helper only covers root-level folders. */
async function createSubfolder(
  page: Page,
  projectId: string,
  parentId: string,
  name: string,
): Promise<string> {
  return page.evaluate(
    async ({ pid, parent, n }) => {
      const w = window as Window & {
        api?: {
          folder?: {
            create: (o: {
              project_id: string
              parent_id: string
              name: string
            }) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
          }
        }
      }
      const res = await w.api?.folder?.create({ project_id: pid, parent_id: parent, name: n })
      if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create subfolder failed')
      return res.data.id
    },
    { pid: projectId, parent: parentId, n: name },
  )
}

/**
 * Save a request straight into `folderName` through the save dialog.
 *
 * Not "save at the root, then move it over IPC": the move succeeds in the
 * database but nothing tells the sidebar to reload, so the tree the
 * create-a-suite action reads is stale and the request is collected as if it
 * were still at the root. The dialog is also the path a user takes.
 */
async function seedRequestIn(
  page: Page,
  folderName: string,
  name: string,
  url: string,
): Promise<void> {
  await openHttpRequestTab(page)
  await fillUrl(page, url)
  await saveRequestToFolder(page, name, folderName)
}

uiTest.describe('tester findings, 7 August', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('a collection converted to a suite keeps its folders (issue #94)', async ({ window }) => {
    const stamp = uid()
    const root = `Collection ${stamp}`
    const setupFolder = `01 Setup ${stamp}`
    const cleanupFolder = `02 Cleanup ${stamp}`
    const seedReq = `Seed ${stamp}`
    const wipeReq = `Wipe ${stamp}`

    await navigateSidebar(window, 'apis')
    const projectId = await getActiveProjectId(window)
    const rootId = await createFolder(window, projectId, root)
    await createSubfolder(window, projectId, rootId, setupFolder)
    await createSubfolder(window, projectId, rootId, cleanupFolder)

    await seedRequestIn(window, setupFolder, seedReq, `${localHttpBin()}/get?seed=1`)
    await seedRequestIn(window, cleanupFolder, wipeReq, `${localHttpBin()}/get?wipe=1`)

    // The action a user reaches for: right-click the collection folder.
    await navigateSidebar(window, 'apis')
    await treeOpenNode(window, root)
    await treeContextAction(window, root, /Create Test Suite from this folder/i)

    // It hands off to Tests. The suite is named after the folder.
    await navigateSidebar(window, 'tests')
    const row = suiteRow(window, root)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await row.click() // expand its contents

    /*
     * THE assertion for the sidebar half: both subfolders are on screen. Before
     * the fix the import wrote every request to a single folder_id, so the suite
     * held two loose requests and no folders at all.
     */
    await expect(window.getByText(setupFolder, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    })
    await expect(window.getByText(cleanupFolder, { exact: true }).first()).toBeVisible()
  })

  uiTest(
    'Run Sequence for a suite shows the folders and takes a role on one',
    async ({ window }) => {
      const stamp = uid()
      const root = `Runnable ${stamp}`
      const cleanupFolder = `Cleanup ${stamp}`
      const flowReq = `Flow ${stamp}`
      const wipeReq = `Wipe ${stamp}`

      await navigateSidebar(window, 'apis')
      const projectId = await getActiveProjectId(window)
      const rootId = await createFolder(window, projectId, root)
      await createSubfolder(window, projectId, rootId, cleanupFolder)

      await seedRequestIn(window, root, flowReq, `${localHttpBin()}/get?flow=1`)
      await seedRequestIn(window, cleanupFolder, wipeReq, `${localHttpBin()}/get?wipe=1`)

      await navigateSidebar(window, 'apis')
      await treeOpenNode(window, root)
      await treeContextAction(window, root, /Create Test Suite from this folder/i)

      await navigateSidebar(window, 'tests')
      await expect(suiteRow(window, root)).toBeVisible({ timeout: 20_000 })
      await suiteContextAction(window, root, /Run Suite/i)

      // The folder is a row in the sequence — collapsible, with its own role
      // picker. This is the half that already worked and was never fed.
      const folderPhase = window.getByLabel(new RegExp(`— ${cleanupFolder}$`))
      await expect(folderPhase).toBeVisible({ timeout: 30_000 })

      // A role applied to the folder, which is the capability #94 asked for on
      // the suite side. It must stick — a select that resets is the same bug in
      // a different costume.
      await folderPhase.selectOption('teardown')
      await expect(folderPhase).toHaveValue('teardown')
    },
  )

  uiTest('a new tab in Tests opens Tests, not the APIs wizard (issue #93)', async ({ window }) => {
    // The tab bar (and with it "+") only renders once something is open, so
    // there has to be a tab before there can be a second one. It comes from the
    // APIs panel's New dropdown, hence the trip there first.
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await navigateSidebar(window, 'tests')
    await window.getByTestId('tab-new').click()

    // The symptom: the protocol picker, opened from inside Tests.
    await expect(window.getByText(/New Request/i)).toHaveCount(0)
    await expect(window.getByTestId('workbench')).not.toContainText('WebSocket')

    // And the control still does what it always did everywhere else — same
    // signal as above, so the two halves cannot drift apart.
    await navigateSidebar(window, 'apis')
    await window.getByTestId('tab-new').click()
    await expect(window.getByText(/New Request/i).first()).toBeVisible({ timeout: 15_000 })
  })

  uiTest('a variable can be found without scrolling for it (issue #95)', async ({ window }) => {
    const envName = `Search ${uid()}`

    await openEnvModal(window)
    try {
      // `createEnvironment` leaves the new environment selected.
      await createEnvironment(window, envName)
      await addVariable(window, { key: 'AccessURL', initialValue: 'https://api.example.com' })
      await addVariable(window, { key: 'ProjectName', initialValue: 'demo-project' })
      await addVariable(window, { key: 'timeout', initialValue: '30' })

      const search = window.getByTestId('env-var-search')
      const keys = window.getByTestId('env-var-key')

      await search.fill('access')
      await expect(keys).toHaveCount(1)
      await expect(keys.first()).toHaveValue('AccessURL')
      // The count is what answers the question the issue actually asks —
      // "is this variable present or missing?"
      await expect(window.getByTestId('env-var-search-count')).toContainText('1')

      // A variable that isn't there says so. An empty table on its own reads
      // as "this environment has nothing in it".
      await search.fill('NotHere')
      await expect(keys).toHaveCount(0)
      await expect(window.getByTestId('env-var-no-match')).toBeVisible()

      // And the table underneath still works: adding while a filter is on must
      // not hide the row it just created.
      await window.getByTestId('env-var-add').click()
      await expect(search).toHaveValue('')
      await expect(keys).toHaveCount(4)
    } finally {
      // The modal is shared state for every spec that follows — leaving it
      // open on a failure would take the next one down with it.
      await closeEnvModal(window).catch(() => {})
    }
  })
})
