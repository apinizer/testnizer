import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('Basic auth — valid credentials', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/basic-auth/user/pass`,
    auth: { type: 'basic', basic: { username: 'user', password: 'pass' } },
  })
  expect(res.status).toBe(200)
})

test('Basic auth — wrong credentials returns 401', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/basic-auth/user/pass`,
    auth: { type: 'basic', basic: { username: 'user', password: 'wrong' } },
  })
  expect(res.status).toBe(401)
})

test('Bearer auth — valid token returns 200 with token echoed', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/bearer`,
    auth: { type: 'bearer', bearer: { token: 'my-test-token' } },
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { authenticated: boolean; token: string }
  expect(body.authenticated).toBe(true)
  expect(body.token).toBe('my-test-token')
})

test('Bearer auth — missing token returns 401', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/bearer`,
  })
  expect(res.status).toBe(401)
})
