/**
 * Regression tests for the gRPC dispatch / URL-parse layer.
 *
 * Bug repro: an "Unsupported protocol grpc:" error surfaced when the renderer
 * routed a gRPC call through `window.api.request.send` with a `grpc://...` URL,
 * which axios then rejected. The fix moves dispatch to `window.api.grpc.*` and
 * normalizes the user-entered server address to the bare `host:port` form
 * required by `@grpc/grpc-js`.
 *
 * These tests cover the pure helpers that drive that dispatch + parse layer
 * (no Electron / network involvement).
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeGrpcAddress,
  stripGrpcScheme,
  dispatchChannelFor,
  mapEngineServices,
  grpcResponseToApi,
} from '../../src/renderer/stores/grpc.store'

describe('normalizeGrpcAddress', () => {
  it('strips the grpc:// scheme and appends the TLS default port', () => {
    expect(normalizeGrpcAddress('grpc://demo.connectrpc.com', true)).toBe('demo.connectrpc.com:443')
  })

  it('strips the grpcs:// scheme and keeps the TLS default port', () => {
    expect(normalizeGrpcAddress('grpcs://demo.connectrpc.com', true)).toBe('demo.connectrpc.com:443')
  })

  it('accepts an https://host paste and produces host:443', () => {
    expect(normalizeGrpcAddress('https://demo.connectrpc.com', true)).toBe('demo.connectrpc.com:443')
  })

  it('uses port 80 when TLS is off and no explicit port is given', () => {
    expect(normalizeGrpcAddress('localhost', false)).toBe('localhost:80')
  })

  it('preserves an explicit port', () => {
    expect(normalizeGrpcAddress('localhost:50051', false)).toBe('localhost:50051')
    expect(normalizeGrpcAddress('grpc://localhost:50051', false)).toBe('localhost:50051')
  })

  it('drops trailing path segments the user might have copied in', () => {
    expect(normalizeGrpcAddress('https://demo.connectrpc.com/eliza.v1/Say', true))
      .toBe('demo.connectrpc.com:443')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeGrpcAddress('', true)).toBe('')
    expect(normalizeGrpcAddress('   ', false)).toBe('')
  })

  it('handles bare host:port without scheme', () => {
    expect(normalizeGrpcAddress('demo.connectrpc.com:443', true)).toBe('demo.connectrpc.com:443')
  })
})

describe('stripGrpcScheme', () => {
  it('strips grpc:// without adding a port', () => {
    expect(stripGrpcScheme('grpc://demo.connectrpc.com')).toBe('demo.connectrpc.com')
  })

  it('strips grpcs:// without adding a port', () => {
    expect(stripGrpcScheme('grpcs://demo.connectrpc.com:443')).toBe('demo.connectrpc.com:443')
  })

  it('strips https:// without adding a port', () => {
    expect(stripGrpcScheme('https://demo.connectrpc.com')).toBe('demo.connectrpc.com')
  })

  it('leaves a scheme-less address untouched', () => {
    expect(stripGrpcScheme('localhost:50051')).toBe('localhost:50051')
  })

  it('returns empty string for empty input', () => {
    expect(stripGrpcScheme('')).toBe('')
  })
})

describe('dispatchChannelFor', () => {
  it('routes unary to the execute channel', () => {
    expect(dispatchChannelFor('unary')).toBe('execute')
  })

  it('routes server_streaming to the serverStream channel', () => {
    expect(dispatchChannelFor('server_streaming')).toBe('serverStream')
  })

  it('routes client_streaming to the clientStream channel', () => {
    expect(dispatchChannelFor('client_streaming')).toBe('clientStream')
  })

  it('routes bidi_streaming to the bidiStream channel', () => {
    expect(dispatchChannelFor('bidi_streaming')).toBe('bidiStream')
  })
})

describe('mapEngineServices', () => {
  it('maps streaming flags into the GrpcMethodType enum', () => {
    const services = mapEngineServices({
      protoPath: '/tmp/eliza.proto',
      packageName: 'connectrpc.eliza.v1',
      services: [
        {
          name: 'ElizaService',
          fullName: 'connectrpc.eliza.v1.ElizaService',
          methods: [
            { name: 'Say',       requestType: 'SayRequest',       responseType: 'SayResponse',       requestStream: false, responseStream: false },
            { name: 'Introduce', requestType: 'IntroduceRequest', responseType: 'IntroduceResponse', requestStream: false, responseStream: true },
            { name: 'Converse',  requestType: 'ConverseRequest',  responseType: 'ConverseResponse',  requestStream: true,  responseStream: true },
          ],
        },
      ],
    })

    expect(services).toHaveLength(1)
    expect(services[0].name).toBe('connectrpc.eliza.v1.ElizaService')
    expect(services[0].methods.map((m) => m.type)).toEqual([
      'unary',
      'server_streaming',
      'bidi_streaming',
    ])
  })

  it('falls back to short name when fullName is missing', () => {
    const services = mapEngineServices({
      protoPath: '/tmp/x.proto',
      packageName: '',
      services: [{ name: 'Greeter', fullName: '', methods: [] }],
    })
    expect(services[0].name).toBe('Greeter')
  })

  it('returns an empty array when there are no services', () => {
    expect(mapEngineServices({ protoPath: '', packageName: '', services: [] })).toEqual([])
  })
})

describe('grpcResponseToApi', () => {
  it('translates a successful unary response to ApiResponse', () => {
    const api = grpcResponseToApi({
      requestId: 'req-1',
      protocol: 'grpc',
      body: '{"greeting":"hi"}',
      bodySize: 17,
      timing: { total: 42 },
      grpcStatus: 0,
      grpcStatusMessage: 'OK',
      responseMetadata: { 'content-type': 'application/grpc' },
      actualRequest: {
        method: 'Say',
        url: 'demo.connectrpc.com:443/connectrpc.eliza.v1.ElizaService/Say',
        headers: {},
        body: '{}',
      },
    })

    expect(api.protocol).toBe('grpc')
    expect(api.status).toBe(0)
    expect(api.statusText).toBe('OK')
    expect(api.body).toBe('{"greeting":"hi"}')
    expect(api.timing.total).toBe(42)
    expect(api.headers).toEqual({ 'content-type': 'application/grpc' })
    expect(api.actualRequest?.url).toBe('demo.connectrpc.com:443/connectrpc.eliza.v1.ElizaService/Say')
  })

  it('preserves an error message verbatim', () => {
    const api = grpcResponseToApi({
      requestId: 'req-2',
      protocol: 'grpc',
      timing: { total: 5 },
      error: 'DEADLINE_EXCEEDED',
      grpcStatus: 4,
      grpcStatusMessage: 'deadline',
    })
    expect(api.error).toBe('DEADLINE_EXCEEDED')
    expect(api.status).toBe(4)
    expect(api.statusText).toBe('deadline')
  })
})
