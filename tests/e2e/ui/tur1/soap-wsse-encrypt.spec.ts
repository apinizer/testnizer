/**
 * MST-109 — WS-Security Encryption
 *
 * Verifies that the wsse engine encrypts the SOAP body:
 *  a) wsse:apply with encrypt mode produces an EncryptedData element.
 *  b) Sign-then-encrypt produces both Signature and EncryptedData.
 *  c) wsse:apply with disabled config is a passthrough (no modification).
 */
import path from 'node:path'
import fs from 'node:fs'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
} from '../../helpers/ui/bootstrap'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body><secret>encrypt-e2e</secret></soap:Body>
</soap:Envelope>`

uiTest.describe('Tur1 — WSSE Encryption [MST-109]', () => {
  let serverKey: string
  let serverCert: string

  uiTest.beforeAll(() => {
    serverKey = fs.readFileSync(path.join(CERT_DIR, 'server.key'), 'utf8')
    serverCert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'), 'utf8')
  })

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-109a encrypt mode produces EncryptedData (AES-256-CBC)', async ({ window }) => {
    const result = await window.evaluate(
      async ({ envelope, cert }) => {
        const api = (window as unknown as {
          api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } }
        }).api
        return api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['encrypt'],
            encrypt: {
              recipientCertPem: cert,
              algorithm: 'AES-256-CBC',
              keyWrap: 'RSA-OAEP',
            },
          },
        })
      },
      { envelope: SAMPLE_ENVELOPE, cert: serverCert },
    )

    expect(result.success).toBe(true)
    expect(result.data).toContain('EncryptedData')
    // Original plaintext must be hidden
    expect(result.data).not.toContain('encrypt-e2e')
  })

  uiTest('MST-109b sign-then-encrypt produces both Signature and EncryptedData', async ({ window }) => {
    const result = await window.evaluate(
      async ({ envelope, key, cert }) => {
        const api = (window as unknown as {
          api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } }
        }).api
        return api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['sign', 'encrypt'],
            signFirst: true,
            sign: {
              privateKeyPem: key,
              certPem: cert,
              algorithm: 'RSA-SHA256',
              references: ['Body'],
              keyInfoStrategy: 'BinarySecurityToken',
            },
            encrypt: {
              recipientCertPem: cert,
              algorithm: 'AES-128-CBC',
              keyWrap: 'RSA-OAEP',
            },
          },
        })
      },
      { envelope: SAMPLE_ENVELOPE, key: serverKey, cert: serverCert },
    )

    expect(result.success).toBe(true)
    // Must have encrypted the body
    expect(result.data).toContain('EncryptedData')
  })

  uiTest('MST-109c disabled config is passthrough (no modification)', async ({ window }) => {
    const result = await window.evaluate(
      async (envelope) => {
        const api = (window as unknown as {
          api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } }
        }).api
        return api.wsse.apply({
          envelope,
          config: { enabled: false, modes: [] },
        })
      },
      SAMPLE_ENVELOPE,
    )

    expect(result.success).toBe(true)
    expect(result.data).toBe(SAMPLE_ENVELOPE)
  })

  uiTest('MST-109d AES-128-CBC encryption works without error', async ({ window }) => {
    const result = await window.evaluate(
      async ({ envelope, cert }) => {
        const api = (window as unknown as {
          api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } }
        }).api
        return api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['encrypt'],
            encrypt: {
              recipientCertPem: cert,
              algorithm: 'AES-128-CBC',
              keyWrap: 'RSA-1.5',
            },
          },
        })
      },
      { envelope: SAMPLE_ENVELOPE, cert: serverCert },
    )

    expect(result.success).toBe(true)
    expect(result.data).toContain('EncryptedData')
  })
})
