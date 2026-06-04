/**
 * LIVE network test for gRPC server reflection.
 *
 * Skipped by default. Run with `LIVE_GRPC=1 npm run test:unit -- grpc-reflection-live`
 * to verify against `demo.connectrpc.com:443` (Connect-RPC's public Eliza
 * service). Requires outbound TCP/443.
 */

import { describe, it, expect, vi } from 'vitest'

// Mock electron BEFORE importing the engine so streaming RPCs can dispatch
// events through a fake BrowserWindow.fromId(...).webContents.send.
const sentEvents: Array<{ channel: string; payload: any }> = []
vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: (_id: number) => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => sentEvents.push({ channel, payload }),
      },
    }),
  },
}))

import {
  loadFromReflection,
  executeUnary,
  startBidiStream,
  sendStreamMessage,
  endStream,
} from '../../src/main/protocols/grpc.engine'

const LIVE = process.env.LIVE_GRPC === '1'
const describeLive = LIVE ? describe : describe.skip

async function waitFor(pred: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 30))
  }
}

describeLive('grpc reflection — live (demo.connectrpc.com:443)', () => {
  it('lists Eliza service + methods via reflection', async () => {
    const desc = await loadFromReflection('demo.connectrpc.com:443', true)
    expect(desc.protoPath).toBe('reflection://demo.connectrpc.com:443')
    const eliza = desc.services.find((s) => s.fullName === 'connectrpc.eliza.v1.ElizaService')
    expect(eliza).toBeDefined()
    expect(eliza!.methods.map((m) => m.name).sort()).toEqual(['Converse', 'Introduce', 'Say'])
  }, 30000)

  it('Eliza.Say returns a response after reflection-loaded descriptor', async () => {
    const desc = await loadFromReflection('demo.connectrpc.com:443', true)
    const r = await executeUnary({
      serverAddress: 'demo.connectrpc.com:443',
      protoPath: desc.protoPath,
      serviceName: 'connectrpc.eliza.v1.ElizaService',
      methodName: 'Say',
      requestBody: '{"sentence":"hi"}',
      useTls: true,
    })
    expect(r.grpcStatus).toBe(0)
    expect(r.body).toMatch(/sentence/i)
  }, 30000)

  it('Eliza.Converse (bidi-stream) accepts multiple sequential messages', async () => {
    const desc = await loadFromReflection('demo.connectrpc.com:443', true)
    sentEvents.length = 0

    const streamId = await startBidiStream(
      {
        serverAddress: 'demo.connectrpc.com:443',
        protoPath: desc.protoPath,
        serviceName: 'connectrpc.eliza.v1.ElizaService',
        methodName: 'Converse',
        useTls: true,
      },
      1, // mock windowId
    )
    expect(typeof streamId).toBe('string')

    // Push first message + wait for first response
    expect(sendStreamMessage(streamId, JSON.stringify({ sentence: 'hello' }))).toBe(true)
    await waitFor(() =>
      sentEvents.some(
        (e) =>
          e.payload?.streamId === streamId &&
          e.payload?.type === 'data' &&
          /sentence/i.test(String(e.payload?.data ?? '')),
      ),
    )
    const firstCount = sentEvents.filter(
      (e) => e.payload?.streamId === streamId && e.payload?.type === 'data',
    ).length

    // Push a SECOND message on the same stream — this is what was previously
    // impossible from the UI and is the core bug fix.
    expect(sendStreamMessage(streamId, JSON.stringify({ sentence: 'and again' }))).toBe(true)
    await waitFor(() => {
      const dataEvents = sentEvents.filter(
        (e) => e.payload?.streamId === streamId && e.payload?.type === 'data',
      )
      return dataEvents.length > firstCount
    })

    // Half-close client side; server should send a final 'end' event soon.
    expect(endStream(streamId)).toBe(true)
    await waitFor(() =>
      sentEvents.some((e) => e.payload?.streamId === streamId && e.payload?.type === 'end'),
    )

    const dataEvents = sentEvents.filter(
      (e) => e.payload?.streamId === streamId && e.payload?.type === 'data',
    )
    expect(dataEvents.length).toBeGreaterThanOrEqual(2)
  }, 30000)
})
