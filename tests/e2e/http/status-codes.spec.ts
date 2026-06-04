import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

const CODES = [200, 201, 204, 400, 401, 404, 500, 503]

for (const code of CODES) {
  test(`status ${code} is propagated to the response`, async ({ window }) => {
    const res = await sendRequest(window, {
      method: 'GET',
      url: `${HTTPBIN}/status/${code}`,
      followRedirects: false,
    })
    expect(res.status).toBe(code)
  })
}
