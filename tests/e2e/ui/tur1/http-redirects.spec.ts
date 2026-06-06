/**
 * MST-042 — Redirect follow / no-follow
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { sendViaIpc } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()

uiTest.describe('Tur1 — HTTP redirects [MST-042]', () => {
  uiTest('MST-042 follow redirects lands on final status', async ({ window }) => {
    await dismissOverlays(window)
    const res = await window.evaluate(async (url) => {
      const w = window as Window & {
        api?: {
          request?: {
            send: (p: unknown) => Promise<{ success: boolean; data?: { status?: number; url?: string } }>
          }
        }
      }
      return w.api?.request?.send({
        method: 'GET',
        url,
        followRedirects: true,
        maxRedirects: 5,
      })
    }, `${http()}/redirect/2`)
    expect(res?.success).toBe(true)
    expect(res?.data?.status).toBe(200)
  })
})
