/**
 * MST-044 — All HTTP methods echo
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { sendViaIpc } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — HTTP methods [MST-044]', () => {
  uiTest('MST-044 GET POST PUT PATCH DELETE HEAD OPTIONS reach echo', async ({ window }) => {
    await dismissOverlays(window)
    const base = http()
    const cases: Array<{ method: string; path: string }> = [
      { method: 'GET', path: '/get' },
      { method: 'POST', path: '/post' },
      { method: 'PUT', path: '/put' },
      { method: 'PATCH', path: '/patch' },
      { method: 'DELETE', path: '/delete' },
      { method: 'HEAD', path: '/head' },
      { method: 'OPTIONS', path: '/options' },
    ]
    for (const { method, path } of cases) {
      const res = await sendViaIpc(window, { method, url: `${base}${path}` })
      expect(res.status, method).toBeGreaterThanOrEqual(200)
      expect(res.status, method).toBeLessThan(500)
    }
  })
})
