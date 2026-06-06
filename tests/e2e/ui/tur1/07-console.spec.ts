/**
 * MST-040 — Footer console log + script output
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { addPostScript, fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { expectConsoleContains, expectConsoleScriptLog, openConsolePanel } from '../../helpers/ui/console-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — Console [MST-040]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-040 post-script console.log appears in footer console', async ({ window }) => {
    const marker = `clog-${Math.random().toString(36).slice(2, 8)}`
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get`)
    await addPostScript(window, `console.log('${marker}')`)
    await sendAndWaitResponse(window)
    await openConsolePanel(window)
    await expectConsoleScriptLog(window, marker)
    await expectConsoleContains(window, /GET|200/i)
  })
})
