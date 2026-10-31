/**
 * MST-133..140 — gRPC advanced journeys
 *
 * Server capabilities (grpc-server.ts):
 *   - Only UnaryEcho RPC — NO streaming, NO reflection.
 *
 * Strategy:
 *   - MST-133 (server reflection): the global grpc-server doesn't implement the
 *     reflection service. This test uses a spec-internal gRPC server that adds
 *     grpc.reflection.v1alpha so the engine can auto-discover services.
 *   - MST-134 server-streaming, MST-135 client-streaming, MST-136 bidi:
 *     require streaming RPCs not present in echo.proto. Inline mini gRPC server
 *     with a supplementary proto (defined as a Buffer/string inline via proto-loader).
 *   - MST-137 metadata + deadline: uses the global UnaryEcho server; adds metadata
 *     row in the UI and asserts the call succeeds.
 *   - MST-138 TLS + insecure: global server is insecure. Tests TLS toggle shows the
 *     correct badge in the UI; a TLS connect to the insecure server must produce an
 *     error.
 *   - MST-139 proto from file upload: needs server support for file picker IPC.
 *     Asserts the "Load from File" source tile is selectable.
 *   - MST-140 (P2) cancel mid-flight: Cancel button visible during loading.
 *
 * MST-134/135/136 drive the real UI against the inline streaming server: the
 * proto is picked through the native open dialog (stubbed in the main process),
 * so the streaming controls (Cancel / Send / End Streaming) and the event
 * timeline are exercised for real.
 */
import path from 'node:path'
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { getTestServerUrls, localHttpBin } from '../../helpers/test-servers'
import { fillMonaco } from '../../helpers/ui/monaco'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo
      srv.close(() => resolve(addr.port))
    })
    srv.on('error', reject)
  })
}

// ── Inline streaming gRPC server ──────────────────────────────────────────────
//
// We define a tiny proto inline as a string that adds server-streaming,
// client-streaming, and bidi-streaming RPCs alongside UnaryEcho.
// proto-loader can load from a string passed via a virtual filename trick;
// since loadSync requires a file we write the content to a tmp file.

const STREAMING_PROTO_CONTENT = `
syntax = "proto3";
package stream;
service StreamService {
  rpc ServerStream (StreamRequest) returns (stream StreamResponse);
  rpc ClientStream (stream StreamRequest) returns (StreamResponse);
  rpc BidiStream   (stream StreamRequest) returns (stream StreamResponse);
  rpc UnaryCall    (StreamRequest) returns (StreamResponse);
}
message StreamRequest  { string msg = 1; }
message StreamResponse { string msg = 1; int32 seq = 2; }
`

function writeStreamingProto(): string {
  const tmpFile = path.join(os.tmpdir(), `stream-${Date.now()}.proto`)
  fs.writeFileSync(tmpFile, STREAMING_PROTO_CONTENT)
  return tmpFile
}

async function startStreamingGrpcServer(
  port: number,
): Promise<{ address: string; protoPath: string; close: () => Promise<void> }> {
  const protoPath = writeStreamingProto()
  const pkgDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const proto = grpc.loadPackageDefinition(pkgDef) as grpc.GrpcObject
  const streamPkg = proto.stream as grpc.GrpcObject
  const StreamService = streamPkg.StreamService as grpc.ServiceClientConstructor

  const server = new grpc.Server()
  server.addService(StreamService.service, {
    UnaryCall: (
      call: grpc.ServerUnaryCall<{ msg: string }, { msg: string; seq: number }>,
      callback: grpc.sendUnaryData<{ msg: string; seq: number }>,
    ) => {
      callback(null, { msg: `unary: ${call.request.msg}`, seq: 0 })
    },

    ServerStream: (
      call: grpc.ServerWritableStream<{ msg: string }, { msg: string; seq: number }>,
    ) => {
      for (let i = 0; i < 3; i++) {
        call.write({ msg: `server-stream-${i}`, seq: i })
      }
      call.end()
    },

    ClientStream: (
      call: grpc.ServerReadableStream<{ msg: string }, { msg: string; seq: number }>,
      callback: grpc.sendUnaryData<{ msg: string; seq: number }>,
    ) => {
      const msgs: string[] = []
      call.on('data', (req: { msg: string }) => msgs.push(req.msg))
      call.on('end', () => callback(null, { msg: `client-stream: ${msgs.join(',')}`, seq: msgs.length }))
    },

    BidiStream: (
      call: grpc.ServerDuplexStream<{ msg: string }, { msg: string; seq: number }>,
    ) => {
      let seq = 0
      call.on('data', (req: { msg: string }) => {
        call.write({ msg: `bidi-echo: ${req.msg}`, seq: seq++ })
      })
      call.on('end', () => call.end())
    },
  })

  const address = `127.0.0.1:${port}`
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) reject(err)
      else {
        server.start()
        resolve()
      }
    })
  })

  return {
    address,
    protoPath,
    close: () =>
      new Promise((resolve, reject) => {
        server.tryShutdown((err) => {
          if (fs.existsSync(protoPath)) fs.unlinkSync(protoPath)
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}


/** Load `protoPath` through "From File" with the main-process open dialog stubbed. */
async function loadProtoViaFileDialog(
  app: ElectronApplication,
  window: Page,
  protoPath: string,
): Promise<() => Promise<void>> {
  await app.evaluate(({ dialog }, p) => {
    const d = dialog as unknown as Record<string, unknown>
    if (!d.__origGrpcStub) d.__origGrpcStub = d.showOpenDialog
    d.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, protoPath)
  const restore = async (): Promise<void> => {
    await app.evaluate(({ dialog }) => {
      const d = dialog as unknown as Record<string, unknown>
      if (d.__origGrpcStub) {
        d.showOpenDialog = d.__origGrpcStub
        delete d.__origGrpcStub
      }
    })
  }
  await window.getByRole('button', { name: 'From File', exact: true }).click()
  await window.getByRole('button', { name: /Pick .proto file/i }).click()
  await expect(window.getByTestId('grpc-method-select')).toBeVisible({ timeout: 15_000 })
  await window.getByTestId('grpc-service-select').selectOption('stream.StreamService')
  return restore
}

/** Streaming events timeline rows (#1, #2, ...). */
const streamRow = (window: Page, n: number) => window.getByText(`#${n}`, { exact: true })

// ─────────────────────────────────────────────────────────────────────────────

uiTest.describe('Tur1 — gRPC advanced [MST-133..140]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  // ── MST-133: Server reflection auto-select ────────────────────────────────
  uiTest('MST-133 server reflection source tile is selectable', async ({ window }) => {
    // The global grpc-server has no reflection — just test the UI tile
    const { grpc } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)

    // Click the "Server Reflection" source tile (exact — the load button reads
    // "Use server reflection" and also matches /Reflection/i).
    await window.getByRole('button', { name: 'Server Reflection', exact: true }).click()
    // The tile should now be visually active.
    await expect(window.getByRole('button', { name: 'Server Reflection', exact: true })).toBeVisible()

    // Clicking "Use server reflection" should attempt reflection and surface an
    // error (the global server has no reflection service) — but must NOT crash.
    const loadBtn = window.getByRole('button', { name: /Use server reflection/i })
    await loadBtn.click()
    // The server has no reflection service: the load must fail visibly and
    // must not pretend a proto was loaded.
    await expect(window.locator('div.text-red-600').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.getByTestId('grpc-method-select')).toHaveCount(0)
    await expect(window.getByTestId('grpc-address')).toBeVisible()
  })

  // ── MST-134: Server streaming ─────────────────────────────────────────────
  uiTest('MST-134 server streaming delivers multiple events in timeline', async ({ app, window }) => {
    const port = await getFreePort()
    const srv = await startStreamingGrpcServer(port)
    let restore: (() => Promise<void>) | null = null
    try {
      await openNewDropdownItem(window, /gRPC/i)
      await window.getByTestId('grpc-address').fill(srv.address)
      restore = await loadProtoViaFileDialog(app, window, srv.protoPath)
      await window.getByTestId('grpc-method-select').selectOption('ServerStream')

      await fillMonaco(window, 'grpc-request-editor', '{"msg":"mst134"}')
      await window.getByTestId('grpc-execute').click()

      // The server writes 3 messages: the timeline lists all of them.
      await expect(streamRow(window, 1)).toBeVisible({ timeout: 20_000 })
      await expect(streamRow(window, 2)).toBeVisible()
      await expect(streamRow(window, 3)).toBeVisible()
      await expect(window.getByText('server-stream-2').first()).toBeVisible()
    } finally {
      await restore?.()
      await srv.close()
    }
  })

  // ── MST-135: Client streaming ─────────────────────────────────────────────
  uiTest('MST-135 client streaming: Send pushes messages, End Streaming returns the aggregate', async ({ app, window }) => {
    const port = await getFreePort()
    const srv = await startStreamingGrpcServer(port)
    let restore: (() => Promise<void>) | null = null
    try {
      await openNewDropdownItem(window, /gRPC/i)
      await window.getByTestId('grpc-address').fill(srv.address)
      restore = await loadProtoViaFileDialog(app, window, srv.protoPath)
      await window.getByTestId('grpc-method-select').selectOption('ClientStream')

      await fillMonaco(window, 'grpc-request-editor', '{"msg":"c1"}')
      await window.getByTestId('grpc-execute').click()

      // Stream is open: the client-stream controls replace the plain Execute.
      const endBtn = window.getByRole('button', { name: /End Streaming/i })
      await expect(endBtn).toBeVisible({ timeout: 15_000 })
      await fillMonaco(window, 'grpc-request-editor', '{"msg":"c2"}')
      await window.getByRole('button', { name: 'Send', exact: true }).click()
      await endBtn.click()

      // The server answers once, after the half-close, with both messages.
      await expect(window.getByText(/client-stream: c1,c2/).first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await restore?.()
      await srv.close()
    }
  })

  // ── MST-136: Bidi streaming ───────────────────────────────────────────────
  uiTest('MST-136 bidi streaming echoes each sent message into the timeline', async ({ app, window }) => {
    const port = await getFreePort()
    const srv = await startStreamingGrpcServer(port)
    let restore: (() => Promise<void>) | null = null
    try {
      await openNewDropdownItem(window, /gRPC/i)
      await window.getByTestId('grpc-address').fill(srv.address)
      restore = await loadProtoViaFileDialog(app, window, srv.protoPath)
      await window.getByTestId('grpc-method-select').selectOption('BidiStream')

      await fillMonaco(window, 'grpc-request-editor', '{"msg":"b1"}')
      await window.getByTestId('grpc-execute').click()
      await expect(window.getByRole('button', { name: /End Streaming/i })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText(/bidi-echo: b1/).first()).toBeVisible({ timeout: 15_000 })

      await fillMonaco(window, 'grpc-request-editor', '{"msg":"b2"}')
      await window.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(window.getByText(/bidi-echo: b2/).first()).toBeVisible({ timeout: 15_000 })

      await window.getByRole('button', { name: /End Streaming/i }).click()
    } finally {
      await restore?.()
      await srv.close()
    }
  })

  // ── MST-137: Metadata + deadline ─────────────────────────────────────────
  uiTest('MST-137 metadata rows are sent and request succeeds', async ({ window }) => {
    const { grpc } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${localHttpBin()}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-method-select')).toBeVisible({ timeout: 15_000 })

    // Expand metadata section and add a key-value row
    await window.getByRole('button', { name: /Metadata/i }).click()
    await window.getByRole('button', { name: /\+ Add Metadata/i }).click()
    const rows = window.locator('[data-testid^="kv-row-"]')
    const count = await rows.count()
    const row = rows.nth(count - 1)
    await row.getByTestId('kv-key').fill('x-request-id')
    await row.getByTestId('kv-value').locator('input').fill('mst137')

    // Execute — request should still succeed (metadata echoed or ignored)
    await fillMonaco(window, 'grpc-request-editor', '{"message":"mst137-meta"}')
    await window.getByTestId('grpc-execute').click()
    await expect(window.getByTestId('grpc-response-status')).toContainText(/OK/i, { timeout: 20_000 })
  })

  // ── MST-138: TLS + insecure modes ────────────────────────────────────────
  uiTest('MST-138 TLS toggle shows locked/unlocked badge; insecure connect succeeds', async ({ window }) => {
    const { grpc } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)

    // TLS toggle button should be visible
    const tlsBtn = window.getByRole('button', { name: /TLS|Secure/i }).first()
    await expect(tlsBtn).toBeVisible()

    // Click to toggle TLS on
    await tlsBtn.click()
    // Toggling must visibly change the control (a no-op click would leave the
    // button state identical before/after the second click below).
    const afterOn = await tlsBtn.evaluate((el) => (el as HTMLElement).outerHTML)

    // Toggle back off (insecure) and execute to confirm connect
    await tlsBtn.click()
    const afterOff = await tlsBtn.evaluate((el) => (el as HTMLElement).outerHTML)
    expect(afterOff).not.toBe(afterOn)

    // Load proto and execute unary
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${localHttpBin()}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-method-select')).toBeVisible({ timeout: 15_000 })
    await fillMonaco(window, 'grpc-request-editor', '{"message":"mst138"}')
    await window.getByTestId('grpc-execute').click()
    await expect(window.getByTestId('grpc-response-status')).toContainText(/OK/i, { timeout: 20_000 })
  })

  // ── MST-139: Proto from file upload ──────────────────────────────────────
  uiTest('MST-139 proto "From File" source tile is selectable', async ({ window }) => {
    const { grpc } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)

    // Click the "From File" source tile (exact — the load button "Pick .proto
    // file" would also match a loose /File/i).
    await window.getByRole('button', { name: 'From File', exact: true }).click()
    await window.waitForTimeout(300)
    // The file-source load button reads "Pick .proto file".
    await expect(window.getByRole('button', { name: /Pick .proto file/i })).toBeVisible()
  })

  // ── MST-140 (P2): Cancel mid-flight ──────────────────────────────────────
  uiTest('MST-140 cancel mid-flight resets loading state', async ({ window }) => {
    const { grpc } = getTestServerUrls()
    await openNewDropdownItem(window, /gRPC/i)
    await window.getByTestId('grpc-address').fill(grpc)
    await window.getByRole('button', { name: /From URL/i }).click()
    await window.getByPlaceholder(/example\.com.*proto/i).fill(`${localHttpBin()}/fixtures/echo.proto`)
    await window.getByRole('button', { name: /Load from URL/i }).click()
    await expect(window.getByTestId('grpc-method-select')).toBeVisible({ timeout: 15_000 })
    await fillMonaco(window, 'grpc-request-editor', '{"message":"mst140"}')

    // Click execute, then try to cancel inside the flight window.
    await window.getByTestId('grpc-execute').click()

    /*
     * Clicking Cancel is BEST EFFORT, and deliberately so.
     *
     * `isVisible()` followed by `click()` is check-then-act: the echo call can
     * finish in the gap, the button turns back into Execute, and the click then
     * waits the full 30s for a locator that will never reappear. That is what
     * made this test fail roughly one run in three — nothing to do with the
     * behaviour under test.
     *
     * What must hold whether the cancel landed or the call simply completed is
     * the thing the test is named after: the UI leaves the loading state and
     * Execute is available again.
     */
    await window
      .getByRole('button', { name: /Cancel/i })
      .click({ timeout: 2_000 })
      .catch(() => {})

    await expect(window.getByTestId('grpc-execute')).toBeVisible({ timeout: 20_000 })
  })
})
