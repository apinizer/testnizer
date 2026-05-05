import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('completes a fast request within budget', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/delay/1`,
    timeout: 10_000,
  })
  expect(res.status).toBe(200)
})

test('aborts when delay exceeds timeout', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/delay/5`,
    timeout: 1_500,
  })
  // The engine surfaces aborted requests via either an explicit error field
  // or a missing/zero status. Either signal counts as "did not complete".
  const failed = !res.status || res.status === 0 || Boolean(res.error)
  expect(failed).toBe(true)
})
