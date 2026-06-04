import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest, parseJsonBody } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test('cookies set by server are exposed to caller', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/cookies/set?session=abc123`,
    followRedirects: false,
  })
  // /cookies/set returns 302 with Set-Cookie header
  expect([200, 302]).toContain(res.status)
  expect(JSON.stringify(res.headers ?? {}).toLowerCase()).toContain('session=abc123')
})

test.skip('cookies are sent on subsequent same-origin request (cookie jar)', async ({ window }) => {
  // The engine maintains a process-global cookie jar but `?from=jar` is the
  // url-query form which the engine strips. With explicit `params` the
  // /cookies/set endpoint also doesn't echo back via /cookies for httpbin's
  // current image. Revisit when a project-scoped jar lands in Sprint 4.
  await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/cookies/set/from/jar`,
    followRedirects: true,
  })
  const res = await sendRequest(window, {
    method: 'GET',
    url: `${HTTPBIN}/cookies`,
  })
  expect(res.status).toBe(200)
  const body = parseJsonBody(res) as { cookies: Record<string, string> }
  expect(body.cookies.from).toBe('jar')
})
