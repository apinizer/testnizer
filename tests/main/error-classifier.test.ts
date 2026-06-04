/**
 * Unit tests for the shared transport-error classifier. The helper feeds
 * every protocol engine's catch block, so its behaviour is the load-bearing
 * piece for the whole "error visibility" story — these cases lock in the
 * exact wording each common failure mode produces.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyTransportError,
  describeGrpcStatus,
  hintForHttpStatus,
} from '../../src/main/lib/error-classifier'

describe('classifyTransportError — axios response (HTTP status)', () => {
  it('maps 401 to an Authorization hint and surfaces httpStatus', () => {
    const out = classifyTransportError({
      message: 'Request failed with status code 401',
      response: { status: 401, statusText: 'Unauthorized' },
    })
    expect(out.httpStatus).toBe(401)
    expect(out.message).toMatch(/HTTP 401/)
    expect(out.message).toMatch(/Authorization/i)
  })

  it('falls back to statusText for unknown HTTP codes', () => {
    const out = classifyTransportError({
      message: 'Request failed',
      response: { status: 418, statusText: "I'm a teapot" },
    })
    expect(out.httpStatus).toBe(418)
    expect(out.message).toMatch(/HTTP 418/)
    expect(out.message).toMatch(/teapot/i)
  })
})

describe('classifyTransportError — transport codes', () => {
  it('classifies ECONNREFUSED', () => {
    const out = classifyTransportError({
      message: 'connect ECONNREFUSED 127.0.0.1:9',
      code: 'ECONNREFUSED',
    })
    expect(out.message).toMatch(/Connection refused/)
    expect(out.code).toBe('ECONNREFUSED')
    expect(out.hint).toMatch(/listening/i)
  })

  it('classifies ENOTFOUND as a DNS lookup failure', () => {
    const out = classifyTransportError({
      message: 'getaddrinfo ENOTFOUND nope.invalid',
      code: 'ENOTFOUND',
    })
    expect(out.message).toMatch(/DNS lookup failed/)
    expect(out.code).toBe('ENOTFOUND')
  })

  it('classifies ETIMEDOUT', () => {
    const out = classifyTransportError({
      message: 'connect ETIMEDOUT 10.0.0.1:80',
      code: 'ETIMEDOUT',
    })
    expect(out.message).toMatch(/Connection timed out/)
    expect(out.code).toBe('ETIMEDOUT')
  })

  it('classifies axios "timeout of Nms exceeded" without a code', () => {
    const out = classifyTransportError({
      message: 'timeout of 30000ms exceeded',
    })
    expect(out.message).toMatch(/Connection timed out/)
  })

  it('classifies CERT_HAS_EXPIRED', () => {
    const out = classifyTransportError({
      message: 'certificate has expired',
      code: 'CERT_HAS_EXPIRED',
    })
    expect(out.message).toMatch(/TLS certificate expired/)
  })

  it('classifies self-signed certs with a "trust" hint', () => {
    const out = classifyTransportError({
      message: 'self signed certificate',
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    })
    expect(out.message).toMatch(/not trusted/)
    expect(out.hint).toMatch(/SSL verification|CA/i)
  })

  it('classifies hostname mismatches', () => {
    const out = classifyTransportError({
      message: "Hostname/IP does not match certificate's altnames",
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    })
    expect(out.message).toMatch(/hostname mismatch/i)
  })

  it('classifies invalid URLs', () => {
    const out = classifyTransportError({
      message: 'Invalid URL',
      code: 'ERR_INVALID_URL',
    })
    expect(out.message).toMatch(/Invalid URL/)
  })

  it('classifies abort signals', () => {
    const out = classifyTransportError({
      message: 'The operation was aborted',
      code: 'ABORT_ERR',
    })
    expect(out.message).toMatch(/aborted/i)
  })
})

describe('classifyTransportError — fallbacks', () => {
  it('handles plain string input', () => {
    expect(classifyTransportError('something broke').message).toBe('something broke')
  })

  it('handles plain string input with a transport hint', () => {
    expect(classifyTransportError('connect ECONNREFUSED 1.2.3.4:80').message).toMatch(
      /Connection refused/,
    )
  })

  it('falls back to "Unknown error" for null/undefined', () => {
    expect(classifyTransportError(null).message).toBe('Unknown error')
    expect(classifyTransportError(undefined).message).toBe('Unknown error')
  })

  it('preserves the raw message when no transport pattern matches', () => {
    const out = classifyTransportError({ message: 'generic failure', code: 'EWEIRD' })
    expect(out.message).toBe('generic failure')
    expect(out.code).toBe('EWEIRD')
  })
})

describe('describeGrpcStatus', () => {
  it('formats UNAVAILABLE (14)', () => {
    const out = describeGrpcStatus(14, 'no connection established')
    expect(out.grpcStatus).toBe(14)
    expect(out.message).toMatch(/UNAVAILABLE/)
    expect(out.message).toMatch(/no connection/)
    expect(out.hint).toMatch(/down|unreachable/i)
  })

  it('formats UNAUTHENTICATED (16)', () => {
    const out = describeGrpcStatus(16)
    expect(out.message).toMatch(/UNAUTHENTICATED/)
    expect(out.hint).toMatch(/credentials/i)
  })

  it('formats DEADLINE_EXCEEDED (4)', () => {
    const out = describeGrpcStatus(4)
    expect(out.message).toMatch(/DEADLINE_EXCEEDED/)
  })

  it('handles unknown codes gracefully', () => {
    const out = describeGrpcStatus(999, 'wat')
    expect(out.grpcStatus).toBe(999)
    expect(out.message).toMatch(/CODE_999/)
    expect(out.message).toMatch(/wat/)
  })
})

describe('hintForHttpStatus', () => {
  it('returns hints for common statuses', () => {
    expect(hintForHttpStatus(401)).toMatch(/Authorization/i)
    expect(hintForHttpStatus(404)).toMatch(/URL/)
    expect(hintForHttpStatus(429)).toMatch(/rate/i)
    expect(hintForHttpStatus(503)).toBeDefined()
  })

  it('returns undefined for unknown statuses', () => {
    expect(hintForHttpStatus(418)).toBeUndefined()
  })
})
