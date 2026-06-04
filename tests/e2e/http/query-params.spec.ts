import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody, kvList } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('single query param', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
    params: kvList({ name: 'Yıldız' }),
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { args: Record<string, string> }
  expect(body.args.name).toBe('Yıldız')
})

test('multi-valued params — at least one value reaches server', async ({ window }) => {
  // Engine deduplication of repeated keys is implementation-specific. Some
  // engines collapse to last value; httpbin can return string or array. Just
  // verify the value lands somewhere.
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
    params: [
      { id: '1', key: 'tag', value: 'a', enabled: true },
      { id: '2', key: 'tag', value: 'b', enabled: true },
    ],
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { args: Record<string, string | string[]> }
  expect(body.args.tag).toBeDefined()
})

test('special characters are URL-encoded', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
    params: kvList({ q: 'a b&c=d' }),
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { args: Record<string, string> }
  expect(body.args.q).toBe('a b&c=d')
})

test('disabled params are skipped', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
    params: [
      { id: '1', key: 'on', value: '1', enabled: true },
      { id: '2', key: 'off', value: '0', enabled: false },
    ],
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { args: Record<string, string> }
  expect(body.args.on).toBe('1')
  expect(body.args.off).toBeUndefined()
})
