/**
 * JWKS-serve renderer half (#61 / Faz D1).
 *
 * Two things are pinned here:
 *
 *  1. `src/renderer/lib/jwks-serve.ts` — the EXACT rows D1-1 mandates (one
 *     ordinary GET/exact endpoint + one ordinary 200/json/always response,
 *     created through the EXISTING mock IPC), and the D1-3 base-path rule that
 *     the stored path is always post-strip while the URL a caller uses is
 *     base + path.
 *  2. `JwksFillButton` — that it is genuinely ADDITIVE: it writes into the SAME
 *     body field, does nothing until clicked, carries the existing keys along
 *     (rotation), and never retains the opaque source (whose password fields
 *     are write-only and must not outlive the one IPC payload).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

// Vitest's esbuild transform uses the classic JSX runtime → React must be global.
;(globalThis as unknown as { React: typeof React }).React = React

import {
  JWKS_WELL_KNOWN_PATH,
  isJwksEndpoint,
  jwksEndpointInput,
  jwksResponseInput,
  jwksServeUrl,
  parseJwksKeys,
  provisionJwksServe,
} from '../../src/renderer/lib/jwks-serve'
import JwksFillButton from '../../src/renderer/components/mock/JwksFillButton'
import type { MockEndpoint, MockResponse } from '../../src/renderer/types'

// ═══════════════════════════════════════════════════════════════════════════
// 1. D1-1 — the exact ordinary rows, no new primitive
// ═══════════════════════════════════════════════════════════════════════════

describe('jwks-serve row shapes (D1-1)', () => {
  it('the endpoint row is a plain GET/exact row at the well-known path', () => {
    expect(jwksEndpointInput('srv-1')).toEqual({
      serverId: 'srv-1',
      method: 'GET',
      path: '/.well-known/jwks.json',
      pathMode: 'exact',
    })
    expect(JWKS_WELL_KNOWN_PATH).toBe('/.well-known/jwks.json')
  })

  it('the response row is a plain 200 / json / always row carrying the static body', () => {
    const body = '{\n  "keys": []\n}'
    const input = jwksResponseInput('ep-1', body)
    expect(input.statusCode).toBe(200)
    expect(input.bodyType).toBe('json')
    expect(input.condition).toEqual({ type: 'always' })
    expect(input.body).toBe(body)
    // No script: a JWKS is STATIC (D1-2) — the sandbox could not build one.
    expect(input.script).toBe('')
    // body_type 'json' already sets application/json; an explicit header would
    // make this row differ from every hand-authored JSON response for nothing.
    expect(input.headers).toEqual([])
  })

  it('provisions through the caller-supplied (existing) create actions only', async () => {
    const createEndpoint = vi.fn(async () => ({ id: 'ep-1' }) as unknown as MockEndpoint)
    const createResponse = vi.fn(async () => ({ id: 'resp-1' }) as unknown as MockResponse)

    const out = await provisionJwksServe({
      serverId: 'srv-1',
      body: '{"keys":[]}',
      createEndpoint,
      createResponse,
    })

    expect(createEndpoint).toHaveBeenCalledWith(jwksEndpointInput('srv-1'))
    expect(createResponse).toHaveBeenCalledWith(jwksResponseInput('ep-1', '{"keys":[]}'))
    expect(out.endpoint.id).toBe('ep-1')
    expect(out.response.id).toBe('resp-1')
  })

  it('fails loud when the endpoint or the response could not be created', async () => {
    await expect(
      provisionJwksServe({
        serverId: 'srv-1',
        body: '{}',
        createEndpoint: async () => null,
        createResponse: async () => ({ id: 'r' }) as unknown as MockResponse,
      }),
    ).rejects.toThrow(/endpoint/i)

    await expect(
      provisionJwksServe({
        serverId: 'srv-1',
        body: '{}',
        createEndpoint: async () => ({ id: 'ep' }) as unknown as MockEndpoint,
        createResponse: async () => null,
      }),
    ).rejects.toThrow(/response/i)
  })

  it('recognises a JWKS endpoint regardless of a trailing slash', () => {
    expect(isJwksEndpoint({ method: 'GET', path: '/.well-known/jwks.json' })).toBe(true)
    expect(isJwksEndpoint({ method: 'GET', path: '/.well-known/jwks.json/' })).toBe(true)
    expect(isJwksEndpoint({ method: 'POST', path: '/.well-known/jwks.json' })).toBe(false)
    expect(isJwksEndpoint({ method: 'GET', path: '/keys' })).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. D1-3 — effective URL is base + stored (post-strip) path
// ═══════════════════════════════════════════════════════════════════════════

describe('jwksServeUrl (D1-3)', () => {
  it('an empty base path yields exactly the canonical well-known URL', () => {
    expect(jwksServeUrl({ host: '127.0.0.1', port: 3001, basePath: '' })).toBe(
      'http://127.0.0.1:3001/.well-known/jwks.json',
    )
  })

  it('a base path is prepended — the stored path stays post-strip', () => {
    expect(jwksServeUrl({ host: '127.0.0.1', port: 3001, basePath: '/auth' })).toBe(
      'http://127.0.0.1:3001/auth/.well-known/jwks.json',
    )
    expect(jwksServeUrl({ host: '127.0.0.1', port: 3001, basePath: 'auth/' })).toBe(
      'http://127.0.0.1:3001/auth/.well-known/jwks.json',
    )
  })

  it('0.0.0.0 is a bind address — the URL uses a dialable host', () => {
    expect(jwksServeUrl({ host: '0.0.0.0', port: 8080, basePath: '' })).toBe(
      'http://127.0.0.1:8080/.well-known/jwks.json',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. parseJwksKeys — forgiving, so a non-JWKS body never blocks a fill
// ═══════════════════════════════════════════════════════════════════════════

describe('parseJwksKeys', () => {
  it('returns the keys of a JWKS body', () => {
    expect(parseJwksKeys('{"keys":[{"kty":"RSA","n":"a","e":"AQAB"}]}')).toEqual([
      { kty: 'RSA', n: 'a', e: 'AQAB' },
    ])
  })

  it('returns [] for an empty, non-JSON, or non-JWKS body', () => {
    expect(parseJwksKeys('')).toEqual([])
    expect(parseJwksKeys('not json')).toEqual([])
    expect(parseJwksKeys('{"ok":true}')).toEqual([])
    expect(parseJwksKeys('{"keys":"nope"}')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. JwksFillButton — ADDITIVE and leak-free
// ═══════════════════════════════════════════════════════════════════════════

const LIB = {
  id: 'lib-1',
  name: 'Prod Keystore',
  type: 'PKCS12',
  alias_count: 1,
  remembered: false,
}
const ALIASES = [{ alias: 'signing', entryType: 'KEY', hasPrivateKey: true }]

const BUILT_BODY =
  '{\n  "keys": [\n    {\n      "e": "AQAB",\n      "kty": "RSA",\n      "n": "AAAA"\n    }\n  ]\n}'

const build = vi.fn(async () => ({
  success: true,
  data: { body: BUILT_BODY, kids: ['kid1'], count: 1 },
}))
const libraryList = vi.fn(async () => ({ success: true, data: [LIB] }))
const libraryOpen = vi.fn(async () => ({
  success: true,
  data: { sessionId: 'sess-1', meta: { type: 'PKCS12', aliasCount: 1, aliases: ALIASES } },
}))
const aliasDetail = vi.fn(async () => ({ success: true, data: { alias: 'signing', chain: [] } }))
const closeSession = vi.fn(async () => ({ success: true, data: true }))

function installBridge(): void {
  const g = globalThis as unknown as { window: { api: Record<string, unknown> } }
  if (!g.window) g.window = { api: {} }
  g.window.api = {
    ...(g.window.api ?? {}),
    keystore: { libraryList, libraryOpen, aliasDetail, closeSession },
    jwks: { build },
  }
}

/** Drive the picker to a selection. */
async function pickKey(): Promise<void> {
  fireEvent.click(await screen.findByText('Prod Keystore'))
  fireEvent.change(screen.getByLabelText('Store password'), { target: { value: 'storepw' } })
  fireEvent.click(screen.getByText('Open keystore'))
  fireEvent.click(await screen.findByText('signing'))
  fireEvent.click(screen.getByText('Use this key'))
}

beforeEach(() => {
  build.mockClear()
  libraryList.mockClear()
  libraryOpen.mockClear()
  installBridge()
})
afterEach(() => cleanup())

describe('JwksFillButton — additive', () => {
  it('does NOTHING until clicked — a hand-authored body is untouched on mount', () => {
    const onFill = vi.fn()
    render(<JwksFillButton body='{"hand":"authored"}' onFill={onFill} />)
    expect(onFill).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
    // The picker is not mounted open either.
    expect(screen.queryByTestId('key-material-picker')).toBeNull()
  })

  it('writes the built document into the SAME body field via onFill', async () => {
    const onFill = vi.fn()
    render(<JwksFillButton body="" onFill={onFill} />)
    fireEvent.click(screen.getByTestId('mock-jwks-fill'))
    await pickKey()
    await waitFor(() => expect(onFill).toHaveBeenCalledWith(BUILT_BODY))
  })

  it('carries the keys already in the body along, so a second pick ROTATES', async () => {
    const existing = '{"keys":[{"kty":"RSA","n":"OLD","e":"AQAB","kid":"old"}]}'
    render(<JwksFillButton body={existing} onFill={vi.fn()} />)
    fireEvent.click(screen.getByTestId('mock-jwks-fill'))
    await pickKey()
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const payload = build.mock.calls[0][0] as { sources: unknown[]; extraKeys: unknown[] }
    expect(payload.extraKeys).toEqual([{ kty: 'RSA', n: 'OLD', e: 'AQAB', kid: 'old' }])
    expect(payload.sources).toHaveLength(1)
  })

  it('sends an OPAQUE source (ids + write-only password) and no key bytes', async () => {
    render(<JwksFillButton body="" onFill={vi.fn()} />)
    fireEvent.click(screen.getByTestId('mock-jwks-fill'))
    await pickKey()
    await waitFor(() => expect(build).toHaveBeenCalledTimes(1))
    const payload = build.mock.calls[0][0] as { sources: Record<string, unknown>[] }
    expect(payload.sources[0]).toEqual({
      kind: 'keystore',
      keystoreId: 'lib-1',
      alias: 'signing',
      storePassword: 'storepw',
    })
    expect(JSON.stringify(payload)).not.toContain('BEGIN')
  })

  it('surfaces a build failure instead of writing a broken body', async () => {
    build.mockResolvedValueOnce({
      success: false,
      error: 'That key material holds no public key.',
    } as never)
    const onFill = vi.fn()
    render(<JwksFillButton body="" onFill={onFill} />)
    fireEvent.click(screen.getByTestId('mock-jwks-fill'))
    await pickKey()
    await screen.findByText('That key material holds no public key.')
    expect(onFill).not.toHaveBeenCalled()
  })
})
