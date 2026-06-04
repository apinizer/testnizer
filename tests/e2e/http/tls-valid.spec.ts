import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { HTTPBIN, isReachable, BADSSL_HOSTS } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('valid HTTPS — httpbin.org', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/get`,
  })
  expect(res.status).toBe(200)
})

test('valid TLS 1.3 — badssl', async ({ window }) => {
  const reachable = await isReachable(BADSSL_HOSTS.tls13)
  test.skip(!reachable, 'badssl tls 1.3 endpoint unreachable')
  const res = await sendRequest(window, {
    method: 'GET',
    url: BADSSL_HOSTS.tls13,
  })
  expect(res.status).toBe(200)
})
