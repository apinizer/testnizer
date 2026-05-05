import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { startLocalHttps, readPem, type LocalHttpsServer } from '../helpers/local-https'

let server: LocalHttpsServer
let caPem: string

test.beforeAll(async () => {
  // Server uses a cert signed by our test CA but client has no built-in trust.
  server = await startLocalHttps()
  caPem = readPem('ca.crt')
})

test.afterAll(async () => {
  await server?.close()
})

test('CA-signed server rejected without our CA in truststore', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    sslVerification: true,
  })
  const failed = !res.status || res.status === 0 || Boolean(res.error)
  expect(failed).toBe(true)
})

test('CA-signed server accepted when our CA is in truststore', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    sslVerification: true,
    certificates: { caCertsPem: [caPem] },
  })
  expect(res.status).toBe(200)
})
