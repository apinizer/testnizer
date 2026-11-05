/**
 * MST-108 — WS-Security Signature
 *
 * Verifies that the wsse engine produces a valid XML Signature (sign mode)
 * and that the verify round-trip confirms the signature.
 *
 * Two tests:
 *  a) IPC: wsse:apply with sign mode → envelope contains Signature element.
 *  b) IPC: wsse:apply + wsse:verify round-trip → valid: true.
 *  c) UI: SOAP Sign mode fieldset renders cert/key fields.
 */
import path from 'node:path'
import fs from 'node:fs'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')

const SAMPLE_ENVELOPE = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header/>
  <soap:Body Id="Body-1"><test>sign-e2e</test></soap:Body>
</soap:Envelope>`

uiTest.describe('Tur1 — WSSE Signature [MST-108]', () => {
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

  uiTest('MST-108a wsse:apply sign mode produces Signature element (RSA-SHA256)', async ({ window }) => {
    const result = await window.evaluate(
      async ({ envelope, key, cert }) => {
        const api = (window as unknown as {
          api: {
            wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> }
          }
        }).api
        return api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['sign'],
            sign: {
              privateKeyPem: key,
              certPem: cert,
              algorithm: 'RSA-SHA256',
              references: ['Body'],
              keyInfoStrategy: 'BinarySecurityToken',
            },
          },
        })
      },
      { envelope: SAMPLE_ENVELOPE, key: serverKey, cert: serverCert },
    )

    expect(result.success).toBe(true)
    expect(result.data).toContain('Signature')
    expect(result.data).toContain('SignatureValue')
    expect(result.data).toContain('BinarySecurityToken')
  })

  uiTest('MST-108b wsse:apply + wsse:verify round-trip is valid', async ({ window }) => {
    const signed = await window.evaluate(
      async ({ envelope, key, cert }) => {
        const api = (window as unknown as {
          api: {
            wsse: {
              apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }>
              verify: (x: unknown) => Promise<{ success: boolean; data?: { valid: boolean }; error?: string }>
            }
          }
        }).api
        const s = await api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['sign'],
            sign: {
              privateKeyPem: key,
              certPem: cert,
              algorithm: 'RSA-SHA256',
              references: ['Body'],
              keyInfoStrategy: 'BinarySecurityToken',
            },
          },
        })
        if (!s.success || !s.data) return { success: false, error: s.error, verified: false }
        const v = await api.wsse.verify({ envelope: s.data, certPem: cert })
        return { success: v.success, verified: v.data?.valid ?? false, error: v.error }
      },
      { envelope: SAMPLE_ENVELOPE, key: serverKey, cert: serverCert },
    )

    expect(signed.success).toBe(true)
    expect(signed.verified).toBe(true)
  })

  uiTest('MST-108c Sign mode RSA-SHA1 also produces valid Signature', async ({ window }) => {
    const result = await window.evaluate(
      async ({ envelope, key, cert }) => {
        const api = (window as unknown as {
          api: { wsse: { apply: (x: unknown) => Promise<{ success: boolean; data?: string; error?: string }> } }
        }).api
        return api.wsse.apply({
          envelope,
          config: {
            enabled: true,
            modes: ['sign'],
            sign: {
              privateKeyPem: key,
              certPem: cert,
              algorithm: 'RSA-SHA1',
              references: ['Body'],
              keyInfoStrategy: 'IssuerSerial',
            },
          },
        })
      },
      { envelope: SAMPLE_ENVELOPE, key: serverKey, cert: serverCert },
    )

    expect(result.success).toBe(true)
    expect(result.data).toContain('Signature')
  })

  uiTest('MST-108d UI Sign mode fieldset shows cert and key PEM fields', async ({ window }) => {
    await openNewDropdownItem(window, /SOAP/i)
    await window.getByRole('button', { name: /^Manual$/i }).click()

    // WS-Security lives inside the Auth detail tab (SoapSecuritySection in AuthTab).
    await window.getByRole('button', { name: /^Auth$/i }).click()

    // Expand the collapsible "WS-Security" section header.
    const wsSecBtn = window.getByRole('button', { name: /WS-Security/i })
    await expect(wsSecBtn).toBeVisible({ timeout: 10_000 })
    await wsSecBtn.click()

    const enableCheckbox = window.getByRole('checkbox', { name: /Enable WS-Security/i })
    await enableCheckbox.check()

    // Enable Sign mode — the mode checkbox's label renders "sign". check() is
    // a no-op when it is already ticked.
    await window.getByRole('checkbox', { name: /^sign$/i }).check()

    // Certificate and private-key PEM textareas must both appear.
    await expect(window.getByPlaceholder(/BEGIN CERTIFICATE/i)).toBeVisible({ timeout: 8_000 })
    await expect(window.getByPlaceholder(/BEGIN PRIVATE KEY/i)).toBeVisible({ timeout: 8_000 })
  })
})
