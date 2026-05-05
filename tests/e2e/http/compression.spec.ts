import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

for (const algo of ['gzip', 'deflate', 'brotli']) {
  test(`auto-decodes ${algo} response`, async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${HTTPBIN}/${algo}`,
    })
    expect(res.status).toBe(200)
    // httpbin returns JSON with a "gzipped"/"deflated"/"brotli" boolean flag
    const body = parseJsonBody(res) as Record<string, boolean>
    const flagKey = algo === 'gzip' ? 'gzipped' : algo === 'deflate' ? 'deflated' : 'brotli'
    expect(body[flagKey]).toBe(true)
  })
}
