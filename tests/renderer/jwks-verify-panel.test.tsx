/**
 * The JWKS verify panel, asserted through the DOM.
 *
 * Every case here is a security-reporting bug — the panel told the user
 * something untrue about a token:
 *
 *   JWT-1  a failed FETCH was written into the verification verdict, so an
 *          unreachable IdP rendered "Signature invalid: fetch failed" next to
 *          the Verify button. The endpoint was down; the token was never judged.
 *   JWT-2  Load had no busy signal (one shared flag with Verify), and a
 *          successful Load wiped the previous verdict.
 *   JWT-3  the algorithm allowlist was seeded with `useState(algorithm)`, which
 *          reads the prop ONCE. Paste a token signed with a different alg and
 *          verification silently kept pinning the previous one.
 *
 * The bridge is mocked: this file is about what the panel does with an answer,
 * not about reaching an identity provider.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const fetchJwksViaMain = vi.fn()
const verifyInMain = vi.fn()

vi.mock('../../src/renderer/lib/tools/jose-bridge', () => ({
  fetchJwksViaMain: (...a: unknown[]) => fetchJwksViaMain(...a),
  verifyInMain: (...a: unknown[]) => verifyInMain(...a),
}))

import JwksVerifyPanel from '../../src/renderer/components/tools/jwt/JwksVerifyPanel'

const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig'
const URL = 'https://idp.example.test/.well-known/jwks.json'

/** Fills the URL field and presses Load. */
async function load(url = URL) {
  fireEvent.change(screen.getByLabelText(/JWKS endpoint/i), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
}

beforeEach(() => {
  fetchJwksViaMain.mockReset()
  verifyInMain.mockReset()
})
afterEach(cleanup)

/* ── JWT-1: a dead endpoint is not a verdict on the token ───────────────────── */

describe('a failed key-set fetch is reported as a fetch failure (JWT-1)', () => {
  it('renders the error beside Load and NOT as a signature verdict', async () => {
    fetchJwksViaMain.mockResolvedValue({ ok: false, error: 'getaddrinfo ENOTFOUND idp' })
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    await load()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not load the key set')
    expect(alert.textContent).toContain('ENOTFOUND')
    // The bug: this same text used to appear as "Signature invalid: …".
    expect(screen.queryByText(/Signature invalid/)).toBeNull()
    // And nothing was verified, so no claim about the signature was made at all.
    expect(screen.queryByText(/Signature verified/)).toBeNull()
    expect(verifyInMain).not.toHaveBeenCalled()
  })

  it('reports a successful load with the key count', async () => {
    fetchJwksViaMain.mockResolvedValue({
      ok: true,
      value: { keys: [{ kid: 'a' }, { kid: 'b' }] },
    })
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    await load()

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Keys fetched')
    expect(status.textContent).toContain('2')
    expect(status.textContent).toContain('a, b')
  })
})

/* ── JWT-2: Load and Verify are separate actions ────────────────────────────── */

describe('Load reports its own progress and leaves the verdict alone (JWT-2)', () => {
  it('shows a busy label on the Load button while fetching', async () => {
    let release: (v: unknown) => void = () => {}
    fetchJwksViaMain.mockReturnValue(new Promise((r) => (release = r)))
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    await load()

    // The bug: Load's label never changed, so a slow IdP looked like a dead button.
    expect(await screen.findByRole('button', { name: 'Loading…' })).toBeTruthy()
    release({ ok: true, value: { keys: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load' })).toBeTruthy())
  })

  it('keeps an existing verification verdict across a later Load', async () => {
    verifyInMain.mockResolvedValue({ ok: true, value: { header: { kid: 'k1' } } })
    fetchJwksViaMain.mockResolvedValue({ ok: true, value: { keys: [{ kid: 'k1' }] } })
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    fireEvent.change(screen.getByLabelText(/JWKS endpoint/i), { target: { value: URL } })
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }))
    await screen.findByText(/Signature verified/)

    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await screen.findByRole('status')

    // The verdict describes the TOKEN, which Load did not touch.
    expect(screen.getByText(/Signature verified/)).toBeTruthy()
  })

  it('drops a stale "keys fetched" line when the URL changes', async () => {
    fetchJwksViaMain.mockResolvedValue({ ok: true, value: { keys: [{ kid: 'k1' }] } })
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    await load()
    await screen.findByRole('status')

    fireEvent.change(screen.getByLabelText(/JWKS endpoint/i), {
      target: { value: 'https://other.example.test/jwks.json' },
    })

    // "Keys fetched (1)" would now describe an endpoint that was never loaded.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })
})

/* ── JWT-3: the pin follows the token ──────────────────────────────────────── */

describe('the algorithm allowlist tracks the token header (JWT-3)', () => {
  it('re-seeds when the decoded alg changes', async () => {
    const { rerender } = render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)
    const algs = screen.getByLabelText(/Allowed algorithms/i) as HTMLInputElement
    expect(algs.value).toBe('RS256')

    // A new token, signed with a different algorithm.
    rerender(<JwksVerifyPanel token="other.token.sig" algorithm="ES256" />)

    // The bug: `useState(algorithm)` read the prop once, so this stayed "RS256"
    // and verification kept enforcing a pin the user had no way to see a reason for.
    await waitFor(() => expect((algs as HTMLInputElement).value).toBe('ES256'))
  })

  it('sends the allowlist explicitly so main never derives it', async () => {
    verifyInMain.mockResolvedValue({ ok: true, value: { header: {} } })
    render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)

    fireEvent.change(screen.getByLabelText(/JWKS endpoint/i), { target: { value: URL } })
    fireEvent.change(screen.getByLabelText(/Allowed algorithms/i), {
      target: { value: 'RS256, PS256' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Verify/i }))

    await waitFor(() => expect(verifyInMain).toHaveBeenCalled())
    // This allowlist is what refuses an alg:'HS256' forgery signed with the
    // public key from the very JWKS being trusted.
    expect(verifyInMain.mock.calls[0][0]).toMatchObject({
      algorithms: ['RS256', 'PS256'],
      jwksUri: URL,
      token: TOKEN,
    })
  })

  it('lets the user override the seeded value until the token moves again', async () => {
    const { rerender } = render(<JwksVerifyPanel token={TOKEN} algorithm="RS256" />)
    const algs = screen.getByLabelText(/Allowed algorithms/i) as HTMLInputElement

    fireEvent.change(algs, { target: { value: 'RS512' } })
    expect(algs.value).toBe('RS512')

    // Same alg on a re-render: the user's edit must survive.
    rerender(<JwksVerifyPanel token="different.token.sig" algorithm="RS256" />)
    expect(algs.value).toBe('RS512')
  })
})
