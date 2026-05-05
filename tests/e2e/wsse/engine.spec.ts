import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { wsseTest as test } from './_setup'

const CERTS = path.resolve(__dirname, '../../fixtures/certs')

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body>
    <tns:Echo xmlns:tns="http://testnizer.com/echo">
      <tns:Message>Hello, WSSE</tns:Message>
    </tns:Echo>
  </soap:Body>
</soap:Envelope>`

type ApplyResult = { success: true; data: string } | { success: false; error: string }

async function callApply(window: import('@playwright/test').Page, payload: unknown): Promise<{ success: boolean; data?: string; error?: string }> {
  return await window.evaluate(async (p) => {
    const api = (window as unknown as { api: { wsse: { apply: (x: unknown) => Promise<unknown> } } }).api
    return (await api.wsse.apply(p)) as { success: boolean; data?: string; error?: string }
  }, payload)
}

async function callVerify(window: import('@playwright/test').Page, payload: unknown) {
  return await window.evaluate(async (p) => {
    const api = (window as unknown as { api: { wsse: { verify: (x: unknown) => Promise<unknown> } } }).api
    return (await api.wsse.verify(p)) as { success: boolean; data?: { valid: boolean }; error?: string }
  }, payload)
}

test('IPC: wsse:apply produces UsernameToken', async ({ window }) => {
  const result = await callApply(window, {
    envelope: SAMPLE_ENVELOPE,
    config: {
      enabled: true,
      modes: ['username-token'],
      usernameToken: { username: 'alice', password: 'secret', passwordType: 'PasswordText', nonce: false, created: false },
    },
  })
  expect(result.success).toBe(true)
  expect(result.data).toContain('<wsse:UsernameToken')
  expect(result.data).toContain('<wsse:Username>alice</wsse:Username>')
})

test('IPC: wsse:apply + wsse:verify roundtrip', async ({ window }) => {
  const serverCert = readFileSync(path.join(CERTS, 'server.crt'), 'utf8')
  const serverKey = readFileSync(path.join(CERTS, 'server.key'), 'utf8')

  const signed = await callApply(window, {
    envelope: SAMPLE_ENVELOPE,
    config: {
      enabled: true,
      modes: ['sign'],
      sign: {
        privateKeyPem: serverKey,
        certPem: serverCert,
        algorithm: 'RSA-SHA256',
        references: ['Body'],
        keyInfoStrategy: 'BinarySecurityToken',
      },
    },
  })
  expect(signed.success).toBe(true)
  expect(signed.data).toContain('Signature')

  const verify = await callVerify(window, { envelope: signed.data, certPem: serverCert })
  expect(verify.success).toBe(true)
  expect(verify.data?.valid).toBe(true)
})

test('IPC: wsse:apply with disabled config is passthrough', async ({ window }) => {
  const result: ApplyResult = await callApply(window, {
    envelope: SAMPLE_ENVELOPE,
    config: { enabled: false, modes: [] },
  }) as ApplyResult
  expect(result.success).toBe(true)
  if (result.success) {
    expect(result.data).toBe(SAMPLE_ENVELOPE)
  }
})
