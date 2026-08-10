/**
 * Stale verdicts — the class, not the instance.
 *
 * Testers reported one symptom: on the JWK tool, converting key A and then
 * pasting key B left A's PEM next to B's card. Chasing it turned up the same
 * shape in six security tools, and there the leftover is a JUDGEMENT: change the
 * signed XML and SAML still says "Valid"; paste another token and the JWT panel
 * still says "Signature verified"; inspect another host and TLS still says
 * "Trusted".
 *
 * That is worse than a stale artifact. A tool whose whole purpose is to answer
 * "can I trust this?" must never show the answer for a different input, because
 * the answer looks exactly the same either way.
 *
 * Each case here follows one script: produce a verdict → change the input →
 * assert the verdict is GONE.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="monaco"
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

import { mockWindowApi } from './screens/_mount'
import JwkTool from '../../src/renderer/components/tools/JwkTool'
import JwtTool from '../../src/renderer/components/tools/JwtTool'
import TlsInspectorTool from '../../src/renderer/components/tools/TlsInspectorTool'
;(globalThis as unknown as { React: typeof React }).React = React

/** A second, structurally valid EC JWK — different from the tool's sample. */
const OTHER_JWK = JSON.stringify(
  {
    kty: 'EC',
    crv: 'P-256',
    x: 'MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4',
    y: '4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM',
    alg: 'ES256',
  },
  null,
  2,
)

beforeEach(() => {
  mockWindowApi()
})
afterEach(() => cleanup())

describe('JWK tool — a PEM must not outlive the key it came from', () => {
  it('drops the converted PEM when the JWK is edited', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText(/JWK → PEM|JWK to PEM/i))

    const box = screen.getByLabelText(/JWK/i, { selector: 'textarea' })
    fireEvent.click(screen.getByRole('button', { name: /convert to pem/i }))
    await waitFor(() => expect(screen.getByText(/BEGIN PUBLIC KEY/)).toBeInTheDocument())

    // Same tool, different key — the PEM on screen is now about nothing.
    fireEvent.change(box, { target: { value: OTHER_JWK } })
    expect(screen.queryByText(/BEGIN PUBLIC KEY/)).toBeNull()
  })

  it('says out loud that a JWK is valid (Validate had no visible effect)', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText(/JWK → PEM|JWK to PEM/i))

    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/valid/i))
  })

  it('drops the verdict when the JWK is edited', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText(/JWK → PEM|JWK to PEM/i))
    const box = screen.getByLabelText(/JWK/i, { selector: 'textarea' })

    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    fireEvent.change(box, { target: { value: '{ not json' } })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('JWT tool — a signature verdict must not outlive its token', () => {
  it('drops "verified" when a different token is pasted', async () => {
    render(<JwtTool />)
    // The tool ships with a sample HS256 token and its matching secret, so the
    // happy path needs no fixtures.
    fireEvent.click(screen.getByRole('button', { name: /verify signature/i }))
    // The badge reads "Signature verified"; `getAllBy` because the wrapper and
    // the span both carry the text.
    await waitFor(() => expect(screen.getAllByText('Signature verified').length).toBeGreaterThan(0))

    const tokenBox = screen.getAllByTestId('monaco')[0]
    fireEvent.change(tokenBox, { target: { value: 'header.payload.signature' } })

    expect(screen.queryByText('Signature verified')).toBeNull()
  })
})

/** A successful inspection with a valid, trusted leaf. */
const RESULT_BASE = {
  ok: true,
  host: 'a.example.com',
  port: 443,
  servername: 'a.example.com',
  protocol: 'TLSv1.3',
  cipher: 'TLS_AES_256_GCM_SHA384',
  alpnProtocol: false,
  authorized: true,
  hostnameValid: true,
  selfSigned: false,
  expired: false,
  notYetValid: false,
  daysToExpiry: 90,
  validityStatus: 'valid',
  chain: [
    {
      subjectDN: 'CN=a.example.com',
      issuerDN: 'CN=Test CA',
      serialNumber: '01',
      version: 3,
      sigAlgName: 'sha256WithRSAEncryption',
      notBefore: '2026-01-01T00:00:00Z',
      notAfter: '2027-01-01T00:00:00Z',
      publicKeyAlgorithm: 'RSA',
      keySize: 2048,
      sha1Fingerprint: 'aa:bb',
      sha256Fingerprint: 'cc:dd',
      subjectAlternativeNames: ['DNS:a.example.com'],
      pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    },
  ],
}

describe('TLS inspector — a trust verdict must not outlive its host', () => {
  it('drops the previous host’s chain and badges when the host is changed', async () => {
    mockWindowApi({
      tls: { inspect: () => Promise.resolve({ success: true, data: RESULT_BASE }) },
    })
    render(<TlsInspectorTool />)

    const host = screen.getByLabelText(/host/i)
    fireEvent.change(host, { target: { value: 'a.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }))
    await waitFor(() => expect(screen.getByText(/CN=a\.example\.com/)).toBeInTheDocument())

    // Typing a new host means the verdict on screen belongs to the old one.
    fireEvent.change(host, { target: { value: 'b.example.com' } })
    expect(screen.queryByText(/CN=a\.example\.com/)).toBeNull()
  })
})

describe('TLS inspector — placeholders must not be read as findings', () => {
  /** A transport failure: the engine fills every field with a placeholder. */
  const FAILED = {
    ok: false,
    error: 'getaddrinfo ENOTFOUND bu-yok-xyz.invalid',
    host: 'bu-yok-xyz.invalid',
    port: 443,
    servername: 'bu-yok-xyz.invalid',
    protocol: null,
    cipher: null,
    alpnProtocol: false,
    authorized: false,
    hostnameValid: false,
    selfSigned: false,
    expired: false,
    notYetValid: false,
    daysToExpiry: 0,
    validityStatus: 'expired',
    chain: [],
  }

  it('shows the error alone when the connection never happened', async () => {
    mockWindowApi({ tls: { inspect: () => Promise.resolve({ success: true, data: FAILED }) } })
    render(<TlsInspectorTool />)
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'bu-yok-xyz.invalid' } })
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }))

    await waitFor(() => expect(screen.getByText(/ENOTFOUND/)).toBeInTheDocument())
    // `baseResult` sets hostnameValid:false and validityStatus:'expired' before
    // it knows anything; those are defaults, not verdicts about a certificate
    // the server never sent.
    expect(screen.queryByText(/hostname mismatch/i)).toBeNull()
    expect(screen.queryByText(/^expired$/i)).toBeNull()
    expect(screen.queryByText(/not independently validated/i)).toBeNull()
    expect(screen.queryByText(/in 0 days/i)).toBeNull()
  })

  it('STILL shows the verdicts for a certificate that is genuinely bad', async () => {
    // The regression lock for the fix above: an untrusted/expired/mismatched
    // certificate comes back with ok:true, so hiding on `ok` must not hide these.
    const BAD = {
      ...RESULT_BASE,
      authorized: false,
      hostnameValid: false,
      expired: true,
      daysToExpiry: -5,
      validityStatus: 'expired',
    }
    mockWindowApi({ tls: { inspect: () => Promise.resolve({ success: true, data: BAD }) } })
    render(<TlsInspectorTool />)
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'a.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }))

    await waitFor(() => expect(screen.getByText(/CN=a\.example\.com/)).toBeInTheDocument())
    expect(screen.getByText(/hostname mismatch/i)).toBeInTheDocument()
    expect(screen.getByText(/not independently validated/i)).toBeInTheDocument()
  })

  it('names which host the certificate was validated against when SNI differs', async () => {
    const SNI = { ...RESULT_BASE, host: 'docs.apinizer.com', servername: 'example.com' }
    mockWindowApi({ tls: { inspect: () => Promise.resolve({ success: true, data: SNI }) } })
    render(<TlsInspectorTool />)
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: 'docs.apinizer.com' } })
    fireEvent.click(screen.getByRole('button', { name: /^inspect$/i }))

    await waitFor(() => expect(screen.getByText(/SNI: example\.com/)).toBeInTheDocument())
    expect(screen.getByText(/validated against the SNI name/i)).toBeInTheDocument()
    expect(screen.getByText(/hostname matches \(example\.com\)/i)).toBeInTheDocument()
  })
})
