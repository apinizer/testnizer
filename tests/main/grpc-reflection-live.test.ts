/**
 * LIVE network test for gRPC server reflection.
 *
 * Skipped by default. Run with `LIVE_GRPC=1 npm run test:unit -- grpc-reflection-live`
 * to verify against `demo.connectrpc.com:443` (Connect-RPC's public Eliza
 * service). Requires outbound TCP/443.
 */

import { describe, it, expect } from 'vitest'
import { loadFromReflection, executeUnary } from '../../src/main/protocols/grpc.engine'

const LIVE = process.env.LIVE_GRPC === '1'
const describeLive = LIVE ? describe : describe.skip

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
})
