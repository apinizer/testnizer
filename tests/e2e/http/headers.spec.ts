import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody, kvList } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('custom request headers are echoed', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/headers`,
    headers: kvList({ 'X-Test-Header': 'testnizer-value', 'X-Other': 'other' }),
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { headers: Record<string, string> }
  expect(body.headers['X-Test-Header']).toBe('testnizer-value')
  expect(body.headers['X-Other']).toBe('other')
})

test('User-Agent override', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/user-agent`,
    headers: kvList({ 'User-Agent': 'Testnizer/E2E' }),
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { 'user-agent': string }
  expect(body['user-agent']).toBe('Testnizer/E2E')
})

test('response headers are exposed', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/response-headers?X-Custom=xyz`,
  })
  expect(res.status).toBe(200)
  expect(res.headers).toBeDefined()
  // Header keys are lower-cased by the engine; check both cases.
  const lower = Object.fromEntries(
    Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  )
  expect(lower['x-custom']).toBe('xyz')
})
