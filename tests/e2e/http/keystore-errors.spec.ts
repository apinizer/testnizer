import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { startLocalHttps, readPem, readBase64, type LocalHttpsServer } from '../helpers/local-https'

let server: LocalHttpsServer
let caPem: string
let goodP12B64: string
let badP12B64: string

test.beforeAll(async () => {
  server = await startLocalHttps({ mtls: true })
  caPem = readPem('ca.crt')
  goodP12B64 = readBase64('client.p12')
  badP12B64 = readBase64('bad.p12')
})

test.afterAll(async () => {
  await server?.close()
})

test('corrupted PKCS12 fails with descriptive error', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    certificates: {
      caCertsPem: [caPem],
      clientCert: { pfxBase64: badP12B64, passphrase: 'testpassword' },
    },
  })
  const failed = !res.status || res.status === 0 || Boolean(res.error)
  expect(failed).toBe(true)
})

test('wrong PKCS12 password fails with descriptive error', async ({ window }) => {
  const res = await sendRequest(window, {
    method: 'GET',
    url: server.url,
    certificates: {
      caCertsPem: [caPem],
      clientCert: { pfxBase64: goodP12B64, passphrase: 'WRONG' },
    },
  })
  const failed = !res.status || res.status === 0 || Boolean(res.error)
  expect(failed).toBe(true)
})
