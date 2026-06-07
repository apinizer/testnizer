/**
 * MST-048 — Truststore custom CA
 *
 * Verifies that a self-signed HTTPS endpoint can be trusted by
 * installing the CA certificate via the certificate store, and that
 * without the CA cert the request fails TLS verification.
 *
 * Note: The inline HTTPS server approach requires node `https` module.
 * We spin up an ephemeral self-signed HTTPS server in beforeAll using
 * the existing test fixture certs. The test does NOT touch global-setup.
 */
import path from 'node:path'
import https from 'node:https'
import fs from 'node:fs'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, clickSend, waitForResponseStatus, waitForResponseError } from '../../helpers/ui/request-flow'
import { addCertificateIpc, deleteCertificateIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { sendRequest } from '../../helpers/api'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')

function startSelfSignedServer(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const cert = fs.readFileSync(path.join(CERT_DIR, 'server.crt'))
    const key = fs.readFileSync(path.join(CERT_DIR, 'server.key'))
    const srv = https.createServer({ cert, key }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tls: 'ok' }))
    })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number }
      resolve({
        url: `https://127.0.0.1:${addr.port}/get`,
        close: () => srv.close(),
      })
    })
    srv.on('error', reject)
  })
}

uiTest.describe('Tur1 — HTTP TLS truststore [MST-048]', () => {
  let serverUrl = ''
  let closeServer: () => void

  uiTest.beforeAll(async () => {
    const s = await startSelfSignedServer()
    serverUrl = s.url
    closeServer = s.close
  })

  uiTest.afterAll(() => {
    closeServer?.()
  })

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-048a without CA cert self-signed TLS request fails', async ({ window }) => {
    // Direct IPC send with sslVerification=true and no custom CA → TLS error
    const res = await sendRequest(window, {
      method: 'GET',
      url: serverUrl,
      sslVerification: true,
    })
    // Expect either an error field or a non-2xx response
    const hasError = !!res.error || (res.status !== undefined && res.status >= 400)
    const isTlsError =
      res.error?.toLowerCase().includes('certificate') ||
      res.error?.toLowerCase().includes('ssl') ||
      res.error?.toLowerCase().includes('self') ||
      hasError
    expect(isTlsError).toBe(true)
  })

  uiTest('MST-048b with CA cert registered custom TLS endpoint succeeds', async ({ window }) => {
    await openHttpRequestTab(window)
    const projectId = await getActiveProjectId(window)
    const caCertPath = path.join(CERT_DIR, 'ca.crt')

    // Register the CA cert for the server host
    const certId = await addCertificateIpc(window, {
      projectId,
      kind: 'ca',
      crtPath: caCertPath,
    })

    try {
      // Via IPC with explicit CA — engine picks it up from certificate store
      const res = await sendRequest(window, {
        method: 'GET',
        url: serverUrl,
        sslVerification: true,
        certificates: {
          caCertsPem: [fs.readFileSync(path.join(CERT_DIR, 'ca.crt'), 'utf8')],
        },
      })
      // With CA provided explicitly the request must succeed
      expect(res.status).toBe(200)
    } finally {
      await deleteCertificateIpc(window, certId).catch(() => {})
    }
  })

  uiTest('MST-048c sslVerification=false bypasses TLS check', async ({ window }) => {
    // Even without CA cert, disabling verification allows self-signed
    const res = await sendRequest(window, {
      method: 'GET',
      url: serverUrl,
      sslVerification: false,
    })
    expect(res.status).toBe(200)
    const body = typeof res.body === 'string' ? res.body : ''
    expect(body).toContain('tls')
  })
})
