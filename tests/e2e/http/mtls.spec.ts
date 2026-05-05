import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { startLocalHttps, readPem, readBase64, type LocalHttpsServer } from '../helpers/local-https'

let server: LocalHttpsServer
let caPem: string
let clientCertPem: string
let clientKeyPem: string
let clientP12B64: string

test.beforeAll(async () => {
  server = await startLocalHttps({ mtls: true })
  caPem = readPem('ca.crt')
  clientCertPem = readPem('client.crt')
  clientKeyPem = readPem('client.key')
  clientP12B64 = readBase64('client.p12')
})

test.afterAll(async () => {
  await server?.close()
})

test('mTLS — request without client cert is rejected', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    certificates: { caCertsPem: [caPem] },
  })
  const failed = !res.status || res.status === 0 || Boolean(res.error)
  expect(failed).toBe(true)
})

test('mTLS — request with PEM client cert succeeds', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    certificates: {
      caCertsPem: [caPem],
      clientCert: { certPem: clientCertPem, keyPem: clientKeyPem },
    },
  })
  expect(res.status).toBe(200)
})

test('mTLS — request with PKCS12 client cert succeeds', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    certificates: {
      caCertsPem: [caPem],
      clientCert: { pfxBase64: clientP12B64, passphrase: 'testpassword' },
    },
  })
  expect(res.status).toBe(200)
})
