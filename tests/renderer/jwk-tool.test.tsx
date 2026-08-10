/**
 * Tools → JWK (#61) renderer wiring.
 *
 * Two invariants are pinned here, both of them about what the tool is ALLOWED to
 * do rather than what it displays:
 *
 *  1. ADDITIVE — pasting is the default and the only path that runs on its own.
 *     Converting a pasted PEM must touch NO IPC channel: the whole conversion is
 *     `lib/tools/jwk.ts` running in this window on the user's own text.
 *
 *  2. NO-LEAK — a keystore-backed selection yields the PUBLIC half only. Main
 *     already guarantees this (`jwks:build` reads `publicJwk` and re-strips), so
 *     the hostile-main case here is deliberate: even if that guarantee regressed
 *     upstream, no private member may reach the DOM. It also proves the payload
 *     that goes OUT carries an opaque source and no key bytes.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const toastSuccess = vi.fn()
const toastInfo = vi.fn()
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

import JwkTool from '../../src/renderer/components/tools/JwkTool'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

const CERT_PEM = readFileSync(resolve(__dirname, '../fixtures/certs/client.crt'), 'utf8')

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12',
  alias_count: 1,
  size_bytes: 2048,
  created_at: 1,
  updated_at: 1,
  remembered: true, // remembered → no store-password prompt in the picker
}

/** What a well-behaved main returns: public members only. */
const PUBLIC_JWK = {
  e: 'AQAB',
  kid: 'BjEqM0hJ1z1t7SLcAxRIWLGtQmZmDPFPGdCPPGCGCJk',
  kty: 'RSA',
  n: 'sXchDaQebHnPiGvyDOAT4saGEUetSyo9MKLOoWFsueri23bOdgWp4Dy1WlUzewbgBHod5pcM9H95GQRV3JDXboIRROSBigeC5yjU1hGzHHyXss8UDprecbAYxknTcQkhslANGRUZmdTOQ5qTRsLAt6BTYuyvVRdhS8exSZEy_c4gs_7svlJmRy_9_MJTLDGwUxUqmDF7GdImWSSuLDLdyAgLLcTLJ2mkVJVs-VVAwaAaBQPwj3iBSFbBhJq5NoNzYIxHkzUXKe7iYyRlBcLcE2YKa2K_TmR8x5o_Vr0AJ2NUTvGSHDLA2ZzOaTGx7g0GtjqQfrM4-8yTBRZWnCcNQBQ',
}

/** A deliberately hostile response — main must never produce this. */
const PRIVATE_JWK = {
  ...PUBLIC_JWK,
  d: 'LEAKED-PRIVATE-EXPONENT',
  p: 'LEAKED-P',
  q: 'LEAKED-Q',
  dp: 'LEAKED-DP',
  dq: 'LEAKED-DQ',
  qi: 'LEAKED-QI',
}

const jwksBuild = vi.fn(async () => ({
  success: true,
  data: { body: JSON.stringify({ keys: [PUBLIC_JWK] }, null, 2), kids: [PUBLIC_JWK.kid], count: 1 },
}))
const libraryList = vi.fn(async () => ({ success: true, data: [LIB] }))
const libraryOpen = vi.fn(async () => ({
  success: true,
  data: {
    sessionId: 'sess-1',
    meta: {
      type: 'PKCS12',
      aliasCount: 1,
      aliases: [{ alias: 'client1', entryType: 'KEY', hasPrivateKey: true }],
    },
  },
}))
const aliasDetail = vi.fn(async () => ({ success: true, data: { chain: [] } }))
const closeSession = vi.fn(async () => ({ success: true, data: true }))

function installBridge(): void {
  const g = globalThis as unknown as { window: { api: Record<string, unknown> } }
  g.window.api = {
    jwks: { build: jwksBuild },
    keystore: { libraryList, libraryOpen, aliasDetail, closeSession },
  }
}

/** keystore → alias → confirm (the store password is remembered here). */
async function selectAlias(): Promise<void> {
  fireEvent.click(screen.getByText('Use from keystore / Security'))
  fireEvent.click(await screen.findByText('Prod Keystore'))
  fireEvent.click(await screen.findByText('client1'))
  fireEvent.click(screen.getByText('Use this key'))
}

beforeEach(() => {
  vi.clearAllMocks()
  installBridge()
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } })
})

afterEach(() => cleanup())

describe('ADDITIVE — pasting is the default path', () => {
  it('converts a pasted certificate with NO IPC call at all', async () => {
    render(<JwkTool />)

    fireEvent.change(screen.getByLabelText('PEM — certificate, public key or PKCS#8 private key'), {
      target: { value: CERT_PEM },
    })
    fireEvent.click(screen.getByText('Convert to JWK'))

    // The JWK renders, marked PUBLIC…
    const card = await screen.findByTestId('jwk-card-public')
    expect(card).toHaveTextContent('"kty": "RSA"')
    expect(card).toHaveTextContent('kid (RFC 7638 thumbprint)')
    // …and nothing left the window.
    expect(jwksBuild).not.toHaveBeenCalled()
    expect(libraryList).not.toHaveBeenCalled()
  })

  it('reports an unreadable PEM instead of guessing', async () => {
    render(<JwkTool />)

    fireEvent.change(screen.getByLabelText('PEM — certificate, public key or PKCS#8 private key'), {
      target: { value: '-----BEGIN RSA PRIVATE KEY-----\nAA\n-----END RSA PRIVATE KEY-----' },
    })
    fireEvent.click(screen.getByText('Convert to JWK'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/pkcs8/)
    expect(jwksBuild).not.toHaveBeenCalled()
  })

  it('generates a key pair locally — the private half is framed as private', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText('Generate'))
    fireEvent.click(screen.getByText('Generate key pair'))

    const priv = await screen.findByTestId('jwk-card-private')
    expect(priv).toHaveTextContent('Private key material — never publish this.')
    expect(screen.getByTestId('jwk-card-public')).toHaveTextContent('Public JWK')
    expect(jwksBuild).not.toHaveBeenCalled()
  })
})

describe('NO-LEAK — a keystore-backed selection stays public', () => {
  it('sends an opaque source and renders only the public half', async () => {
    render(<JwkTool />)
    await selectAlias()

    await waitFor(() => expect(jwksBuild).toHaveBeenCalledTimes(1))
    // What goes OUT is ids only — no PEM, no key bytes.
    const payload = jwksBuild.mock.calls[0][0] as { sources: unknown[] }
    expect(payload.sources).toEqual([{ kind: 'keystore', keystoreId: 'lib-1', alias: 'client1' }])
    expect(JSON.stringify(payload)).not.toContain('BEGIN')

    const card = await screen.findByTestId('jwk-card-public')
    expect(card).toHaveTextContent('Public half only — resolved in the main process.')
    expect(screen.queryByTestId('jwk-card-private')).toBeNull()
  })

  it('never renders a private member even if main returned one', async () => {
    jwksBuild.mockResolvedValueOnce({
      success: true,
      data: {
        body: JSON.stringify({ keys: [PRIVATE_JWK] }, null, 2),
        kids: [PRIVATE_JWK.kid],
        count: 1,
      },
    })
    render(<JwkTool />)
    await selectAlias()

    const card = await screen.findByTestId('jwk-card-public')
    for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(card).not.toHaveTextContent(`"${member}"`)
    }
    expect(document.body.textContent).not.toContain('LEAKED')
    // The public half survived the strip.
    expect(card).toHaveTextContent('"kty": "RSA"')
    expect(screen.queryByTestId('jwk-card-private')).toBeNull()
  })

  it('surfaces a resolver failure instead of silently showing nothing', async () => {
    jwksBuild.mockResolvedValueOnce({
      success: false,
      error: "Keystore store password required — remember-password is off for 'Prod Keystore'.",
    } as never)
    render(<JwkTool />)
    await selectAlias()

    expect(await screen.findByRole('alert')).toHaveTextContent(/store password required/i)
  })
})

describe('JWK Set — the copy affordance publishes the PUBLIC set only', () => {
  it('strips private members, refuses oct keys and copies the sanitized document', async () => {
    render(<JwkTool />)

    fireEvent.click(screen.getByText(/^JWK Set/))
    fireEvent.change(screen.getByLabelText('JWK or JWK Set'), {
      target: {
        value: JSON.stringify({ keys: [PRIVATE_JWK, { kty: 'oct', k: 'c2hhcmVkLXNlY3JldA' }] }),
      },
    })
    fireEvent.click(screen.getByText('Add to set'))

    const body = await screen.findByTestId('jwks-body')
    await waitFor(() => expect(body.textContent).toContain('"kty": "RSA"'))
    expect(body.textContent).not.toContain('LEAKED')
    expect(body.textContent).not.toContain('c2hhcmVkLXNlY3JldA')
    expect(screen.getByText('1 key(s) in the published set')).toBeInTheDocument()
    expect(
      screen.getByText('1 symmetric key(s) left out — a shared secret has no public half'),
    ).toBeInTheDocument()
    expect(screen.getByText('A JOSE verifier accepts this set')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Copy public JWKS'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copied).not.toContain('LEAKED')
    expect(copied).not.toContain('"d"')
    expect(JSON.parse(copied).keys).toHaveLength(1)
  })
})


/* ── JWK-4: adding to the set says so, and says when it changed nothing ────── */

describe('adding a key to the set reports what happened (JWK-4)', () => {
  const KEY = {
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
    y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
    alg: 'ES256',
  }

  function addOnce(value: unknown) {
    fireEvent.change(screen.getByLabelText('JWK or JWK Set'), {
      target: { value: JSON.stringify(value) },
    })
    fireEvent.click(screen.getByText('Add to set'))
  }

  it('confirms the addition — the button used to append in silence', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText(/^JWK Set/))

    addOnce(KEY)

    // "Add to set" is pressed from tabs that do not show the set, so without
    // this the screen did not change at all.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(String(toastSuccess.mock.calls[0][0])).toMatch(/added to the key set/i)
  })

  it('recognises the same key instead of duplicating it in a JWKS', async () => {
    render(<JwkTool />)
    fireEvent.click(screen.getByText(/^JWK Set/))

    addOnce(KEY)
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    // Same key, fields in a different order — key order carries no meaning in a
    // JWK, so this is one key, not two.
    addOnce({ alg: KEY.alg, y: KEY.y, x: KEY.x, crv: KEY.crv, kty: KEY.kty })

    await waitFor(() => expect(toastInfo).toHaveBeenCalled())
    expect(String(toastInfo.mock.calls[0][0])).toMatch(/already in the set/i)
    // The tab counter is the visible proof that nothing was appended.
    expect(screen.getByText(/^JWK Set \(1\)/)).toBeInTheDocument()
  })
})
