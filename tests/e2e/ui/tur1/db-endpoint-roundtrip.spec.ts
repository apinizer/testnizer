/**
 * MST-254 — Endpoint JSON fields roundtrip
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createSavedRequestIpc, updateSavedRequestIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId, getSavedRequest } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB endpoint roundtrip [MST-254]', () => {
  uiTest('MST-254 headers, body, auth, scripts persist through update', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const headers = JSON.stringify([{ id: '1', key: 'X-Test', value: 'hdr', enabled: true }])
    const body = JSON.stringify({ type: 'raw', raw: '{"a":1}', format: 'json' })
    const auth = JSON.stringify({ type: 'apikey', apikey: { key: 'k', value: 'v', in: 'header' } })
    const pre = 'pm.environment.set("pre","1");'
    const post = 'pm.test("ok",()=>pm.response.to.have.status(200));'
    const assertions = JSON.stringify([{ type: 'status', expected: 200 }])

    const id = await createSavedRequestIpc(window, {
      projectId,
      name: `Round ${uid()}`,
      url: 'http://127.0.0.1/post',
      method: 'POST',
      headers,
      body,
      auth,
    })
    await updateSavedRequestIpc(window, id, {
      pre_script: pre,
      post_script: post,
      assertions,
    })

    const row = (await getSavedRequest(window, id)) as Record<string, string>
    expect(row.headers).toBe(headers)
    expect(row.body).toBe(body)
    expect(row.auth).toBe(auth)
    expect(row.pre_script).toContain('pre')
    expect(row.post_script).toContain('pm.test')
    expect(row.assertions).toContain('status')
  })
})
