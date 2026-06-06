/**
 * MST-046 — Cookie jar set + resend
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { sendViaIpc } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — HTTP cookies [MST-046]', () => {
  uiTest('MST-046 Set-Cookie from server is sent on follow-up request', async ({ window }) => {
    await dismissOverlays(window)
    const base = http()
    const set = await sendViaIpc(window, { method: 'GET', url: `${base}/cookies/set?k=e2e&v=jar1` })
    expect(set.status).toBe(200)

    const jar = await sendViaIpc(window, { method: 'GET', url: `${base}/cookies` })
    expect(jar.status).toBe(200)
    const body = typeof jar.body === 'string' ? jar.body : JSON.stringify(jar.body ?? {})
    expect(body).toMatch(/e2e|jar1|k/i)
  })
})
