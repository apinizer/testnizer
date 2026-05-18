// tests/e2e/tls-legacy-sidecar.spec.ts
//
// Live end-to-end verification of the TLS 1.0/1.1 curl sidecar (F25).
// Boots a fully packaged Electron app and calls the `request:send` IPC
// directly, then asserts:
//
//   1. A TLS-1.0-only server (https://tls-v1-0.badssl.com:1010/) is
//      reachable with `tls.minVersion='TLSv1', maxVersion='TLSv1'`
//      AND the response shows the [curl sidecar] console log marker.
//   2. The same server pinned to TLS 1.2 returns an error (axios path
//      can't talk TLS 1.0; we verify the sidecar trigger predicate is
//      correctly inverted).
//   3. A modern HTTPS endpoint (httpbin.org) still works on the default
//      axios path with no sidecar marker — guards against accidental
//      "everything goes through curl" regressions.
//
// Network-dependent — skips automatically if the BadSSL host is
// unreachable (CI offline scenarios). Run locally with:
//   npm run build && npx playwright test tests/e2e/tls-legacy-sidecar.spec.ts

import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

let app: ElectronApplication
let userDataDir: string

const BADSSL_TLS10 = 'https://tls-v1-0.badssl.com:1010/'
const HTTPBIN = 'https://httpbin.org/get'

test.beforeAll(async () => {
  const mainPath = path.resolve(__dirname, '../../out/main/index.js')
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
  }
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-tlssidecar-'))
  app = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  // Wait for the first window so app.evaluate has a main-process context.
  await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir && fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

/**
 * Invoke `request:send` via Electron's main-process IPC dispatch. Returns
 * the engine's ApiResponse shape directly. Bypasses the renderer so this
 * test stays focused on the engine/sidecar contract.
 */
type SendResult = {
  success?: boolean
  data?: {
    status?: number
    error?: string
    consoleLogs?: Array<{ message: string }>
  }
  error?: string
}

async function send(options: {
  url: string
  tls?: { minVersion?: string; maxVersion?: string }
}): Promise<SendResult> {
  return (await app.evaluate(async ({ ipcMain }, args) => {
    // The IPC handler is registered at app start; we re-invoke it the same
    // way the renderer would. ipcMain.handle stores listeners as a private
    // map keyed by channel — call directly via emit.
    type Listener = (event: unknown, payload: unknown) => Promise<unknown>
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, Listener> }
    )._invokeHandlers
    const listener = handlers.get('request:send')
    if (!listener) throw new Error('request:send handler not registered')
    return listener({}, {
      method: 'GET',
      url: args.url,
      tls: args.tls,
      timeout: 15000,
      followRedirects: false,
    })
  }, options)) as SendResult
}

test('TLS 1.0 endpoint via curl sidecar — handshake succeeds', async () => {
  test.setTimeout(30000)
  const res = await send({
    url: BADSSL_TLS10,
    tls: { minVersion: 'TLSv1', maxVersion: 'TLSv1' },
  })

  // Skip if BadSSL itself is down (rare but it has had multi-day outages).
  if (!res?.success && /ENETUNREACH|ETIMEDOUT|EAI_AGAIN/i.test(res?.error ?? '')) {
    test.skip(true, `BadSSL unreachable: ${res?.error}`)
  }

  expect(res.success, `IPC error: ${res.error}`).toBe(true)
  expect(res.data?.status, `expected HTTP 200, got error: ${res.data?.error}`).toBe(200)
  const sidecarLog = res.data?.consoleLogs?.find((l) => /\[curl sidecar\]/.test(l.message))
  expect(sidecarLog, 'curl sidecar marker missing from consoleLogs').toBeTruthy()
})

test('TLS 1.0 endpoint pinned to TLS 1.2 (axios path) — handshake fails', async () => {
  test.setTimeout(30000)
  const res = await send({
    url: BADSSL_TLS10,
    tls: { minVersion: 'TLSv1.2' },
  })
  // Either the IPC reports success:false, or success:true with an engine
  // error in data.error. Both shapes are valid — the contract is "axios
  // can't reach this server when min is TLS 1.2".
  const status = res.data?.status
  const errMsg = res.data?.error ?? res.error ?? ''
  expect(
    status === undefined || /SSL|TLS|handshake|connect|reset|protocol/i.test(errMsg),
    `expected TLS handshake failure; got status=${status} error="${errMsg}"`,
  ).toBe(true)
  // And critically: no sidecar marker — we wanted the axios path.
  const sidecarLog = res.data?.consoleLogs?.find((l) => /\[curl sidecar\]/.test(l.message))
  expect(sidecarLog, 'unexpected curl sidecar marker on modern-TLS request').toBeFalsy()
})

test('Modern HTTPS via axios — no sidecar (regression guard)', async () => {
  test.setTimeout(30000)
  const res = await send({ url: HTTPBIN })
  if (!res?.success && /ENETUNREACH|ETIMEDOUT|EAI_AGAIN/i.test(res?.error ?? '')) {
    test.skip(true, `httpbin unreachable: ${res?.error}`)
  }
  expect(res.success, `IPC error: ${res.error}`).toBe(true)
  expect(res.data?.status).toBe(200)
  const sidecarLog = res.data?.consoleLogs?.find((l) => /\[curl sidecar\]/.test(l.message))
  expect(sidecarLog, 'unexpected curl sidecar marker on default modern HTTPS').toBeFalsy()
})
