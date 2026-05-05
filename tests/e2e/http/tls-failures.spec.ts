import { expect } from '@playwright/test'
import { httpTest as test } from './_setup'
import { sendRequest } from '../helpers/api'
import { BADSSL_HOSTS, isReachable } from '../helpers/public-endpoints'

test.beforeAll(async () => {
  const ok = await isReachable(BADSSL_HOSTS.expired)
  test.skip(!ok, 'badssl.com is unreachable')
})

const FAILS: Array<{ name: string; url: string }> = [
  { name: 'expired cert', url: BADSSL_HOSTS.expired },
  { name: 'wrong host', url: BADSSL_HOSTS.wrongHost },
  { name: 'self-signed', url: BADSSL_HOSTS.selfSigned },
  { name: 'untrusted root', url: BADSSL_HOSTS.untrustedRoot },
]

for (const { name, url } of FAILS) {
  test(`rejects ${name} by default`, async ({ window }) => {
    const res = await sendRequest(window, { method: 'GET', url, sslVerification: true })
    // Engine may surface the failure as: missing status, 0 status, or explicit error.
    const failed = !res.status || res.status === 0 || Boolean(res.error)
    expect(failed).toBe(true)
  })

  test(`accepts ${name} when sslVerification is disabled`, async ({ window }) => {
    const res = await sendRequest(window, { method: 'GET', url, sslVerification: false })
    expect(res.status).toBe(200)
  })
}
