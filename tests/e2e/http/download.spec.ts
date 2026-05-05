import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('binary download — /bytes/N', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/bytes/256`,
  })
  expect(res.status).toBe(200)
  // body may be base64-encoded by the engine when content is non-text
  const len = res.body?.length ?? 0
  expect(len).toBeGreaterThan(0)
})

test('image download — /image/png', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/image/png`,
  })
  expect(res.status).toBe(200)
  const ct = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-type')
  expect(ct?.[1]).toContain('image/png')
})

test('large download (~30 KB)', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/stream-bytes/30000`,
  })
  expect(res.status).toBe(200)
  expect((res.body?.length ?? 0)).toBeGreaterThan(0)
})
