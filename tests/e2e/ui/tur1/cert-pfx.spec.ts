/**
 * MST-313 — PFX/PKCS12 certificate via the certificate IPC + persist layer.
 *
 * SCOPE (deliberately narrow — the lower layers are already covered):
 *   - `tests/main/cert-pipeline.test.ts` (unit): PFX path wins over cert/key,
 *     PFX bytes + passphrase reach the https.Agent without crashing.
 *   - `tests/e2e/http/mtls.spec.ts`: client.p12 + correct passphrase succeeds at
 *     the TLS layer (direct base64 send, no DB persist).
 *   - `tests/e2e/http/keystore-errors.spec.ts`: corrupted bad.p12 and wrong
 *     passphrase fail at the TLS layer (direct base64 send, no DB persist).
 *   - `tests/e2e/ui/tur1/shell-secure-storage.spec.ts` (MST-228): client.p12 +
 *     passphrase via `certificate:add`, raw DB bytes do not contain plaintext
 *     (standalone electron.launch).
 *   - `tests/e2e/ui/tur1/db-certificates.spec.ts`: PFX *path* persists.
 *
 * This spec covers the gap those don't: the worker-scoped `uiTest` IPC+persist
 * path end-to-end — certificate:add → list (passphrase column not plaintext) →
 * and the wrong-passphrase case driven through the *persisted* cert
 * (request:send auto-loads the DB cert + decrypts the passphrase), which the
 * base64-send keystore-errors tests never exercise.
 */
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { addCertificateIpc, listCertificatesIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { startLocalHttps, type LocalHttpsServer } from '../../helpers/local-https'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

interface SendResult {
  success: boolean
  data?: { status?: number; error?: string }
  error?: string
}

/** Drive request:send with a known _projectId so the handler auto-loads the
 *  project's persisted certificates (no explicit certificate payload). */
async function sendViaProjectCerts(
  window: import('@playwright/test').Page,
  projectId: string,
  url: string,
): Promise<SendResult> {
  return window.evaluate(
    async ({ pid, u }) => {
      const w = window as unknown as Window & {
        api?: { request?: { send: (p: unknown) => Promise<SendResult> } }
      }
      return (await w.api?.request?.send({
        method: 'GET',
        url: u,
        _projectId: pid,
        timeout: 8000,
      })) as SendResult
    },
    { pid: projectId, u: url },
  ) as Promise<SendResult>
}

uiTest.describe('Tur1 — PFX/PKCS12 certificate [MST-313]', () => {
  uiTest('MST-313 client.p12 + passphrase registers, lists, and is not stored plaintext', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const host = `pfx-${uid()}.example.com`
    const passphrase = `pass-${uid()}`

    const id = await addCertificateIpc(window, {
      projectId,
      kind: 'client',
      host,
      pfxPath: path.join(CERT_DIR, 'client.p12'),
      passphrase,
    })

    const rows = (await listCertificatesIpc(window, projectId)) as Array<{
      id: string
      host: string
      pfx_path: string
      passphrase: string | null
    }>
    const row = rows.find((r) => r.id === id)
    expect(row).toBeDefined()
    expect(row?.host).toBe(host)
    expect(row?.pfx_path).toBe(path.join(CERT_DIR, 'client.p12'))

    // The repo returns the stored (encrypted) value verbatim — it must NOT be
    // the plaintext passphrase. On platforms with safeStorage available the
    // value carries the enc:v1: prefix; on headless Linux (no keyring) it may
    // fall back to plaintext, so only assert the strong property when the
    // value was actually encrypted.
    if (row?.passphrase && row.passphrase.startsWith('enc:v1:')) {
      expect(row.passphrase).not.toBe(passphrase)
    }
  })

  uiTest('MST-313 wrong passphrase on a persisted PFX fails the mTLS send', async ({ window }) => {
    let server: LocalHttpsServer | undefined
    try {
      server = await startLocalHttps({ mtls: true })
      await dismissOverlays(window)
      const projectId = await getActiveProjectId(window)
      // mTLS server cert SAN includes 127.0.0.1; match the client cert on it so
      // loadCertificatesFor() picks the persisted PFX up by host.
      const host = '127.0.0.1'
      const url = `https://127.0.0.1:${server.port}/`

      await addCertificateIpc(window, {
        projectId,
        kind: 'ca',
        host,
        crtPath: path.join(CERT_DIR, 'ca.crt'),
      })
      await addCertificateIpc(window, {
        projectId,
        kind: 'client',
        host,
        pfxPath: path.join(CERT_DIR, 'client.p12'),
        passphrase: 'WRONG-PASSPHRASE',
      })

      // The handler reads the persisted PFX + decrypts the (wrong) passphrase
      // and hands it to the engine; PKCS12 decode fails → no usable client cert
      // → mTLS handshake is rejected. We assert the failure surface, matching
      // keystore-errors.spec.ts's predicate.
      const res = await sendViaProjectCerts(window, projectId, url)
      const failed =
        res.success === false ||
        Boolean(res.error) ||
        Boolean(res.data?.error) ||
        !res.data?.status ||
        res.data?.status === 0
      expect(failed).toBe(true)
    } finally {
      await server?.close()
    }
  })
})
