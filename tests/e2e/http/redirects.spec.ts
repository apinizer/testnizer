import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('follows single redirect by default', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/redirect/1`,
    followRedirects: true,
  })
  expect(res.status).toBe(200)
})

test('follows 3-hop chain', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/redirect/3`,
    followRedirects: true,
  })
  expect(res.status).toBe(200)
})

test('does not follow when followRedirects is false', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/redirect/1`,
    followRedirects: false,
  })
  expect([301, 302]).toContain(res.status)
})
