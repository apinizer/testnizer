/**
 * The three Runner issues filed on 6 August, walked through the real app.
 *
 *   #89  Run configuration had one delay ("between requests") and no way to
 *        express "pause between iterations".
 *   #90  Run Sequence flattened a folder structure into a single list, and a
 *        Setup / Flow / Teardown role could only be set one request at a time.
 *   #91  Manual Stop was not trustworthy, and one control had to serve two
 *        intentions: abort-but-clean-up, and halt-right-now.
 *
 * The wiring behind each is covered by unit tests (payload fields, subtree
 * expansion, abort semantics). These exist for the parts a unit test cannot
 * see: that the folder rows are actually on screen and collapsible, and that a
 * hard stop really does cut a live request short in the running app.
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
import { fillUrl, saveRequestToFolder, saveRequestToTree } from '../helpers/ui/request-flow'
import { createFolder, getActiveProjectId } from '../helpers/ui/assert-ipc'
import {
  openCollectionRunner,
  selectOnlyRunnerEndpoints,
  startRunnerTabRun,
  waitRunnerTabComplete,
} from '../helpers/ui/runner-flow'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => String(Date.now()).slice(-7)

uiTest.describe('runner issues, 6 August', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await closeAllTabs(window)
  })

  uiTest('Run Sequence keeps the folder, and the folder carries a role', async ({ window }) => {
    const stamp = uid()
    const folderName = `Fixtures ${stamp}`
    const inFolder = `Seed ${stamp}`
    const atRoot = `Loose ${stamp}`

    await navigateSidebar(window, 'apis')
    const projectId = await getActiveProjectId(window)
    await createFolder(window, projectId, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?in-folder=1`)
    await saveRequestToFolder(window, inFolder, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?at-root=1`)
    await saveRequestToTree(window, atRoot)

    await openCollectionRunner(window)
    // Scope to the sequence: the saved requests also have open TABS carrying the
    // same names, and an unscoped text query hits both.
    const seq = window.getByTestId('runner-sequence-list')

    // 1. The folder is a ROW, not a label repeated on every request. Under the
    //    old flattening there was no such row at all.
    const folderRow = seq
      .getByTestId('runner-sequence-folder')
      .filter({ hasText: folderName })
      .first()
    await expect(folderRow).toBeVisible({ timeout: 20_000 })

    // 2. It collapses, and takes only its own contents with it.
    await expect(seq.getByText(inFolder, { exact: true })).toBeVisible()
    await folderRow.getByRole('button', { name: new RegExp(`Collapse ${folderName}`, 'i') }).click()
    await expect(seq.getByText(inFolder, { exact: true })).toBeHidden()
    await expect(seq.getByText(atRoot, { exact: true })).toBeVisible()
    await folderRow.getByRole('button', { name: new RegExp(`Expand ${folderName}`, 'i') }).click()

    // 3. A role set on the folder reaches the requests inside it — the part
    //    users asked for so they would stop tagging requests one by one.
    await folderRow.getByLabel(new RegExp(`Phase — ${folderName}`, 'i')).selectOption('teardown')
    await expect(seq.getByLabel(new RegExp(`Phase: ${inFolder}$`, 'i'))).toHaveValue('teardown')
    // …and nothing outside it moved.
    await expect(seq.getByLabel(new RegExp(`Phase: ${atRoot}$`, 'i'))).toHaveValue('main')
  })

  uiTest('a folder marked Teardown actually runs as cleanup', async ({ window }) => {
    /*
     * The screen test above proves the role reaches the requests; the unit
     * tests prove it reaches the payload. This proves the whole loop — a folder
     * tagged in the sequence really does execute in the teardown phase — which
     * is the thing the user asked for and the only place all three layers are
     * exercised together.
     */
    const stamp = uid()
    const folderName = `Cleanup ${stamp}`
    const cleanupA = `Wipe A ${stamp}`
    const cleanupB = `Wipe B ${stamp}`
    const flow = `Flow ${stamp}`

    await navigateSidebar(window, 'apis')
    const projectId = await getActiveProjectId(window)
    await createFolder(window, projectId, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?wipe=a`)
    await saveRequestToFolder(window, cleanupA, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?wipe=b`)
    await saveRequestToFolder(window, cleanupB, folderName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?flow=1`)
    await saveRequestToTree(window, flow)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp)

    // One control, two requests — instead of tagging each of them.
    const seq = window.getByTestId('runner-sequence-list')
    await seq
      .getByTestId('runner-sequence-folder')
      .filter({ hasText: folderName })
      .first()
      .getByLabel(new RegExp(`Phase — ${folderName}`, 'i'))
      .selectOption('teardown')

    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window)

    // Both landed in the Teardown section of the report…
    const teardown = window.getByTestId('runner-phase-teardown')
    await expect(teardown).toContainText(cleanupA)
    await expect(teardown).toContainText(cleanupB)
    // …and the flow request did not follow them there.
    await expect(teardown).not.toContainText(flow)
  })

  uiTest('"Stop now" cuts the live request short and skips cleanup', async ({ window }) => {
    const stamp = uid()
    const slowName = `Slow ${stamp}`
    const cleanupName = `Cleanup ${stamp}`

    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    // Long enough that the run is unmistakably still in flight when the button
    // is pressed — the exact window in which the old Stop appeared to do
    // nothing, because the flag was only read between steps.
    await fillUrl(window, `${localHttpBin()}/delay/8`)
    await saveRequestToTree(window, slowName)

    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?cleanup=1`)
    await saveRequestToTree(window, cleanupName)

    await openCollectionRunner(window)
    await selectOnlyRunnerEndpoints(window, stamp)
    await window.getByLabel(new RegExp(`Phase: ${cleanupName}$`)).selectOption('teardown')

    await startRunnerTabRun(window)

    // The hard stop is its OWN button, sitting beside Stop. That separation is
    // the fix: the single control had to infer which of the two you meant.
    const direct = window.getByTestId('runner-stop-direct')
    await expect(direct).toBeVisible({ timeout: 20_000 })
    await expect(window.getByTestId('runner-stop')).toHaveText('Stop')
    await direct.click()

    // The run ends long before the 8-second request would have answered.
    await waitRunnerTabComplete(window, 20_000)

    // It says which stop happened — not "cleanup was abandoned", which
    // describes a consequence, and not "teardown still ran", which is false.
    await expect(window.getByTestId('workbench')).toContainText(/Halted by you/i)
    // Cleanup did NOT run: that is the promise of this button.
    const list = window.getByTestId('runner-results-list')
    await expect(list).toContainText('NOT RUN')
  })

  uiTest('the two delays are separate fields that add up', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${localHttpBin()}/get?delays=1`)
    await saveRequestToTree(window, `Delays ${uid()}`)
    await openCollectionRunner(window)

    const wb = window.getByTestId('workbench')
    await expect(wb.getByText('Delay between requests')).toBeVisible({ timeout: 20_000 })
    await expect(wb.getByText('Delay between iterations')).toBeVisible()

    // With more than one iteration configured, the screen states the total wait
    // at the boundary. The ambiguity of a bare "Delay" is what made a tester
    // time a run and file the behaviour as a bug in the first place.
    await wb.getByTestId('runner-iterations').fill('2')
    await wb.getByTestId('runner-iteration-delay').fill('500')
    await wb.getByTestId('runner-iteration-delay').blur()
    await expect(wb.getByText(/waits 500 ms/i)).toBeVisible({ timeout: 5_000 })
  })
})
