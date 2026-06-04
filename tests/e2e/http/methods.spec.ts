import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody, kvList } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable — skipping HTTP method tests')
})

test('GET returns 200 with echoed args', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
    params: kvList({ foo: 'bar' }),
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { args: Record<string, string> }
  expect(body.args.foo).toBe('bar')
})

test('POST echoes JSON body', async ({ window }) => {
  const payload = { hello: 'world', n: 42 }
  const res = await sendRequest(window, {
    method: 'POST',
    url: `${HTTPBIN}/post`,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: JSON.stringify(payload) },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { json: typeof payload }
  expect(body.json).toEqual(payload)
})

test('PUT, PATCH, DELETE return 200', async ({ window }) => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const res = await sendRequest(window, {
      method,
      url: `${HTTPBIN}/${method.toLowerCase()}`,
    })
    expect(res.status, `${method} status`).toBe(200)
  }
})

test('HEAD returns headers without body', async ({ window }) => {
  const res = await sendRequest(window, { method: 'HEAD', url: `${HTTPBIN}/get` })
  expect(res.status).toBe(200)
  expect(res.body ?? '').toBe('')
})

test('OPTIONS returns Allow header', async ({ window }) => {
  const res = await sendRequest(window, { method: 'OPTIONS', url: `${HTTPBIN}/get` })
  // httpbin returns CORS-style allow headers
  expect(res.status).toBe(200)
})
