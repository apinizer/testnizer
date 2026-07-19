import { describe, it, expect } from 'vitest'
import { normalizeCertHost, certHostMatches } from '../../src/main/lib/cert-host-match'

describe('normalizeCertHost', () => {
  it('passes a bare hostname through (lowercased)', () => {
    expect(normalizeCertHost('sandbox.api.visa.com')).toBe('sandbox.api.visa.com')
    expect(normalizeCertHost('SANDBOX.Api.Visa.COM')).toBe('sandbox.api.visa.com')
  })

  it('strips a scheme prefix (the real bug: user pasted the base URL)', () => {
    expect(normalizeCertHost('https://sandbox.api.visa.com')).toBe('sandbox.api.visa.com')
    expect(normalizeCertHost('http://sandbox.api.visa.com')).toBe('sandbox.api.visa.com')
  })

  it('strips a port, a path, a trailing slash, and userinfo', () => {
    expect(normalizeCertHost('sandbox.api.visa.com:443')).toBe('sandbox.api.visa.com')
    expect(normalizeCertHost('https://sandbox.api.visa.com/vdp/helloworld')).toBe(
      'sandbox.api.visa.com',
    )
    expect(normalizeCertHost('https://sandbox.api.visa.com/')).toBe('sandbox.api.visa.com')
    expect(normalizeCertHost('https://user:pass@sandbox.api.visa.com:8443/x')).toBe(
      'sandbox.api.visa.com',
    )
  })

  it('unwraps IPv6 brackets and strips the port', () => {
    expect(normalizeCertHost('https://[::1]:8443/')).toBe('::1')
  })

  it('returns empty for blank input and passes * through', () => {
    expect(normalizeCertHost('')).toBe('')
    expect(normalizeCertHost(null)).toBe('')
    expect(normalizeCertHost(undefined)).toBe('')
    expect(normalizeCertHost('  ')).toBe('')
    expect(normalizeCertHost('*')).toBe('*')
  })
})

describe('certHostMatches', () => {
  const REQ = 'sandbox.api.visa.com'

  it('matches when the stored pattern carries a scheme (regression for the mTLS bug)', () => {
    // Exactly what the user typed in the Certificates settings.
    expect(certHostMatches(REQ, 'https://sandbox.api.visa.com')).toBe(true)
  })

  it('matches port / path / trailing-slash / case variants of the stored host', () => {
    expect(certHostMatches(REQ, 'sandbox.api.visa.com:443')).toBe(true)
    expect(certHostMatches(REQ, 'https://sandbox.api.visa.com/vdp/helloworld')).toBe(true)
    expect(certHostMatches(REQ, 'https://sandbox.api.visa.com/')).toBe(true)
    expect(certHostMatches(REQ, 'SANDBOX.API.VISA.COM')).toBe(true)
  })

  it('matches exact bare hostname', () => {
    expect(certHostMatches(REQ, 'sandbox.api.visa.com')).toBe(true)
  })

  it('treats empty / null / * as "any host"', () => {
    expect(certHostMatches(REQ, '')).toBe(true)
    expect(certHostMatches(REQ, null)).toBe(true)
    expect(certHostMatches(REQ, undefined)).toBe(true)
    expect(certHostMatches(REQ, '*')).toBe(true)
  })

  it('supports *.domain wildcards (apex + subdomains)', () => {
    expect(certHostMatches('sandbox.api.visa.com', '*.visa.com')).toBe(true)
    expect(certHostMatches('visa.com', '*.visa.com')).toBe(true)
    expect(certHostMatches('sandbox.api.visa.com', 'https://*.visa.com')).toBe(true)
    expect(certHostMatches('evil-visa.com', '*.visa.com')).toBe(false)
  })

  it('does NOT match a different host (negative case the old tests never covered)', () => {
    expect(certHostMatches(REQ, 'other.example.com')).toBe(false)
    expect(certHostMatches(REQ, 'https://api.example.com')).toBe(false)
    // a superstring must not match by accident
    expect(certHostMatches('visa.com.attacker.net', 'visa.com')).toBe(false)
  })
})
