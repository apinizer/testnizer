/**
 * Pure-logic tests for the TLS Inspector renderer helpers (#64, Faz F). Runs in
 * the node `|tools|` vitest project — no DOM, no network. The heavy functional
 * probe coverage lives in `tests/main/tls-inspect.test.ts`; this locks the
 * request-assembly + display projections the renderer owns.
 */
import { describe, it, expect } from 'vitest'
import {
  buildClientCert,
  buildInspectRequest,
  emptyFormState,
  hasLegacySelection,
  isLegacyTlsVersion,
  leafLabel,
  toCertDetail,
  trustedAliasFor,
  type TlsInspectFormState,
} from '../../../src/renderer/lib/tools/tls-inspect'
import type { TlsCertificateInfo, TlsInspectResult } from '../../../src/renderer/types'

function form(overrides: Partial<TlsInspectFormState> = {}): TlsInspectFormState {
  return { ...emptyFormState(), ...overrides }
}

describe('isLegacyTlsVersion / hasLegacySelection', () => {
  it('flags 1.0 and 1.1 only', () => {
    expect(isLegacyTlsVersion('TLSv1')).toBe(true)
    expect(isLegacyTlsVersion('TLSv1.1')).toBe(true)
    expect(isLegacyTlsVersion('TLSv1.2')).toBe(false)
    expect(isLegacyTlsVersion('TLSv1.3')).toBe(false)
    expect(isLegacyTlsVersion('')).toBe(false)
    expect(isLegacyTlsVersion(undefined)).toBe(false)
  })

  it('detects a legacy selection in either bound', () => {
    expect(hasLegacySelection('TLSv1.2', 'TLSv1.3')).toBe(false)
    expect(hasLegacySelection('TLSv1.1', 'TLSv1.3')).toBe(true)
    expect(hasLegacySelection('TLSv1.2', 'TLSv1')).toBe(true)
  })
})

describe('buildInspectRequest', () => {
  it('rejects an empty host', () => {
    const r = buildInspectRequest(form({ host: '   ' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/host/i)
  })

  it('strips scheme + path and keeps the bare host', () => {
    const r = buildInspectRequest(form({ host: 'https://example.com/some/path?q=1' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.request.host).toBe('example.com')
    expect(r.request.port).toBeUndefined()
  })

  it('splits host:port pasted into the host field', () => {
    const r = buildInspectRequest(form({ host: 'example.com:8443' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.request.host).toBe('example.com')
    expect(r.request.port).toBe(8443)
  })

  it('honours an explicit port field over an inline colon', () => {
    const r = buildInspectRequest(form({ host: 'example.com', port: '9443' }))
    if (!r.ok) throw new Error(r.error)
    expect(r.request.port).toBe(9443)
  })

  it('rejects an out-of-range port', () => {
    expect(buildInspectRequest(form({ host: 'x.com', port: '70000' })).ok).toBe(false)
    expect(buildInspectRequest(form({ host: 'x.com', port: '0' })).ok).toBe(false)
    expect(buildInspectRequest(form({ host: 'x.com', port: 'abc' })).ok).toBe(false)
  })

  it('carries SNI, versions and a valid cipher preset; drops an unknown preset', () => {
    const r = buildInspectRequest(
      form({
        host: 'example.com',
        servername: 'sni.example.com',
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
        cipherPreset: 'legacy',
      }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.request.servername).toBe('sni.example.com')
    expect(r.request.minVersion).toBe('TLSv1.2')
    expect(r.request.maxVersion).toBe('TLSv1.3')
    expect(r.request.cipherPreset).toBe('legacy')

    const bad = buildInspectRequest(form({ host: 'x.com', cipherPreset: 'nope' }))
    if (!bad.ok) throw new Error(bad.error)
    expect(bad.request.cipherPreset).toBeUndefined()
  })

  it('base64-encodes pasted CA anchors so main can decode them', () => {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'
    const r = buildInspectRequest(form({ host: 'x.com', caCerts: pem }))
    if (!r.ok) throw new Error(r.error)
    expect(r.request.caCerts).toHaveLength(1)
    expect(Buffer.from(r.request.caCerts![0], 'base64').toString('utf8')).toBe(pem)
  })

  it('builds no clientCert when the section is disabled', () => {
    const r = buildInspectRequest(
      form({ host: 'x.com', clientCert: { ...emptyFormState().clientCert, enabled: false, certPem: 'x' } }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.request.clientCert).toBeUndefined()
  })

  it('builds an inline clientCert (F-6 inline path)', () => {
    const r = buildInspectRequest(
      form({
        host: 'x.com',
        clientCert: {
          ...emptyFormState().clientCert,
          enabled: true,
          mode: 'inline',
          certPem: 'CERTPEM',
          keyPem: 'KEYPEM',
          passphrase: 'pw',
        },
      }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.request.clientCert).toEqual({
      kind: 'inline',
      certPem: 'CERTPEM',
      keyPem: 'KEYPEM',
      passphrase: 'pw',
    })
  })

  it('builds a file clientCert (F-6 file path)', () => {
    const r = buildInspectRequest(
      form({
        host: 'x.com',
        clientCert: {
          ...emptyFormState().clientCert,
          enabled: true,
          mode: 'file',
          certPath: '/tmp/c.crt',
          keyPath: '/tmp/c.key',
        },
      }),
    )
    if (!r.ok) throw new Error(r.error)
    expect(r.request.clientCert).toEqual({
      kind: 'file',
      certPath: '/tmp/c.crt',
      keyPath: '/tmp/c.key',
    })
  })
})

describe('buildClientCert', () => {
  it('returns undefined when enabled but empty', () => {
    expect(
      buildClientCert({ ...emptyFormState().clientCert, enabled: true, mode: 'inline' }),
    ).toBeUndefined()
    expect(
      buildClientCert({ ...emptyFormState().clientCert, enabled: true, mode: 'file' }),
    ).toBeUndefined()
  })
})

describe('display projections', () => {
  const leaf: TlsCertificateInfo = {
    subjectDN: 'CN=leaf.example.com, O=Acme',
    issuerDN: 'CN=Acme Root',
    serialNumber: '01',
    version: 3,
    sigAlgName: 'sha256WithRSAEncryption',
    notBefore: '2024-01-01T00:00:00Z',
    notAfter: '2025-01-01T00:00:00Z',
    publicKeyAlgorithm: 'RSA',
    keySize: 2048,
    sha1Fingerprint: 'AA:BB',
    sha256Fingerprint: 'DE:AD:BE:EF:00:11',
    subjectAlternativeNames: ['leaf.example.com'],
    pem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
  }

  it('leafLabel extracts CN, falling back to DN then host', () => {
    expect(leafLabel('CN=leaf.example.com, O=Acme', 'h')).toBe('leaf.example.com')
    expect(leafLabel('O=Acme', 'h')).toBe('O=Acme')
    expect(leafLabel('', 'fallback.host')).toBe('fallback.host')
  })

  it('toCertDetail maps a chain into a KeystoreAliasDetail shape', () => {
    const result = { chain: [leaf] } as TlsInspectResult
    const detail = toCertDetail(result, 'example.com')
    expect(detail.entryType).toBe('CERTIFICATE')
    expect(detail.hasPrivateKey).toBe(false)
    expect(detail.alias).toBe('leaf.example.com')
    expect(detail.chain).toHaveLength(1)
  })

  it('trustedAliasFor builds a host + short-fingerprint alias', () => {
    expect(trustedAliasFor('example.com', leaf)).toBe('tls-example.com-deadbeef0011')
    expect(trustedAliasFor('ex ample.com', undefined)).toBe('tls-ex_ample.com')
  })
})
