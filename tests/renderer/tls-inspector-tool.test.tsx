/**
 * The TLS Inspector's result pane, asserted through the DOM.
 *
 * `resultVisibility` is unit-tested next to the other pure helpers; this file
 * pins that the pane actually OBEYS it, which is where the reported bug lived:
 *
 *   TLS-1  on a DNS failure the pane rendered the engine's placeholder fields as
 *          findings — "Hostname mismatch", "NOT independently validated" and an
 *          expiry countdown for a server it never reached.
 *   TLS-5  `ok: true` with an empty chain told the same lie: the handshake
 *          completed, but there was no certificate to judge.
 *   TLS-6  the placeholders contradicted each other on screen — `expired: false`
 *          alongside `validityStatus: 'expired'`.
 *   TLS-2  when SNI differs from the host, the pane never said which name the
 *          certificate was actually validated against.
 *
 * The fourth test is the lock in the OTHER direction: hiding too much would turn
 * a working inspection into an empty pane, and no assertion about a bug being
 * absent can catch that.
 */
import * as React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { TlsCertificateInfo, TlsInspectResult } from '../../src/renderer/types'

import ResultPane from '../../src/renderer/components/tools/tls/ResultPane'

const noop = () => {}

const leaf: TlsCertificateInfo = {
  subjectDN: 'CN=leaf.example.com, O=Acme',
  issuerDN: 'CN=Acme Root',
  serialNumber: '01',
  version: 3,
  sigAlgName: 'sha256WithRSAEncryption',
  notBefore: '2024-01-01T00:00:00Z',
  notAfter: '2027-01-01T00:00:00Z',
  publicKeyAlgorithm: 'RSA',
  keySize: 2048,
  sha1Fingerprint: 'AA:BB',
  sha256Fingerprint: 'DE:AD:BE:EF:00:11',
  subjectAlternativeNames: ['leaf.example.com'],
  pem: '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
}

/**
 * A successful probe. Note the shape of a FAILED one below: the engine returns
 * the same object with `ok:false` and every certificate field left at its
 * placeholder, which is exactly why the pane cannot read them unconditionally.
 */
function probe(over: Partial<TlsInspectResult> = {}): TlsInspectResult {
  return {
    ok: true,
    host: 'example.com',
    port: 443,
    servername: 'example.com',
    protocol: 'TLSv1.3',
    cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
    alpnProtocol: 'h2',
    authorized: true,
    hostnameValid: true,
    chain: [leaf],
    selfSigned: false,
    expired: false,
    notYetValid: false,
    daysToExpiry: 180,
    validityStatus: 'valid',
    ...over,
  }
}

/** The placeholder-filled object a transport failure produces. */
function failedProbe(error: string): TlsInspectResult {
  return probe({
    ok: false,
    protocol: null,
    cipher: null,
    alpnProtocol: false,
    authorized: false,
    hostnameValid: false,
    chain: [],
    expired: false,
    daysToExpiry: 0,
    // The self-contradiction of TLS-6: `expired:false` next to 'expired'.
    validityStatus: 'expired',
    error,
  })
}

function renderPane(result: TlsInspectResult | null, error: string | null = null) {
  return render(
    <ResultPane result={result} error={error} onOpenCert={noop} onAddTrusted={noop} />,
  )
}

afterEach(cleanup)

/* ── TLS-1 / TLS-6: a probe that never arrived makes no claims ─────────────── */

describe('a failed probe reports the failure and nothing else (TLS-1, TLS-6)', () => {
  it('renders no certificate verdicts for a DNS failure', () => {
    renderPane(failedProbe('getaddrinfo ENOTFOUND nope.example'), 'getaddrinfo ENOTFOUND nope.example')

    expect(screen.getByText(/ENOTFOUND/)).toBeTruthy()
    // Every one of these used to render, describing a server never reached.
    expect(screen.queryByText(/Hostname mismatch/)).toBeNull()
    expect(screen.queryByText(/NOT independently validated/)).toBeNull()
    expect(screen.queryByText(/in 0 days/)).toBeNull()
  })

  it('renders no transport facts either', () => {
    renderPane(failedProbe('ECONNREFUSED'), 'ECONNREFUSED')
    expect(screen.queryByText('Protocol')).toBeNull()
  })
})

/* ── TLS-5: a handshake without a certificate is not a certificate ─────────── */

describe('a handshake with no presented chain yields no verdicts (TLS-5)', () => {
  it('shows the transport facts but no certificate badges', () => {
    renderPane(probe({ chain: [], authorized: false, hostnameValid: false }))

    // These are real — the handshake completed.
    expect(screen.getByText('Protocol')).toBeTruthy()
    expect(screen.getByText('TLSv1.3')).toBeTruthy()
    // These would be placeholders.
    expect(screen.queryByText(/Hostname mismatch/)).toBeNull()
    expect(screen.queryByText(/NOT independently validated/)).toBeNull()
  })
})

/* ── The regression lock in the other direction ────────────────────────────── */

describe('a real inspection still renders its verdicts', () => {
  it('shows trust, hostname and validity once a leaf was presented', () => {
    renderPane(probe())

    expect(screen.getByText(/Trusted by system store/)).toBeTruthy()
    expect(screen.getByText(/Hostname matches/)).toBeTruthy()
    expect(screen.getByText(/in 180 days/)).toBeTruthy()
    expect(screen.getByText('Protocol')).toBeTruthy()
  })

  it('flags an untrusted self-signed certificate', () => {
    renderPane(
      probe({
        authorized: false,
        authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        selfSigned: true,
      }),
    )

    expect(screen.getByText(/NOT independently validated/)).toBeTruthy()
    expect(screen.getByText(/Self-signed/)).toBeTruthy()
    expect(screen.getByText(/DEPTH_ZERO_SELF_SIGNED_CERT/)).toBeTruthy()
  })
})

/* ── TLS-2: say which name was validated ───────────────────────────────────── */

describe('the hostname verdict names the identity it checked (TLS-2)', () => {
  it('reports the SNI name when it differs from the connected host', () => {
    renderPane(probe({ host: '10.0.0.7', servername: 'api.example.com' }))

    // Node validates against `servername`, so the badge must say so — otherwise
    // "Hostname matches" reads as a claim about 10.0.0.7, which was never checked.
    expect(screen.getByText(/Hostname matches \(api\.example\.com\)/)).toBeTruthy()
  })

  it('falls back to the host when no SNI was sent', () => {
    renderPane(probe({ servername: '', hostnameValid: false }))
    expect(screen.getByText(/Hostname mismatch \(example\.com\)/)).toBeTruthy()
  })
})
