/**
 * 1.6.0 screen review — JWT Debugger.
 *
 * G-02: a green "Valid JWT" badge showed as soon as a token DECODED, before any
 * signature check — it read as "this token is trustworthy". The footer now says
 * what is known: a neutral "Decoded" + a muted "Signature not verified" until a
 * verification (secret/key OR JWKS) gives a verdict. The verdict badges stay.
 *
 * G-03: the Tools atoms carried light-theme hex (`#0066cc`, `#1a7a4a`,
 * `#b35a00`, `#cc2200`) and tinted badges by appending an alpha suffix to the
 * hex — unreadable in the dark theme. One palette (`components/tools/palette.ts`)
 * maps every tone to `globals.css` tokens; the shared atoms use it.
 */
import * as React from 'react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
import JwtTool from '../../src/renderer/components/tools/JwtTool'
import { Badge, colorizeJson } from '../../src/renderer/components/tools/jwt/atoms'
import { useLocale } from './helpers/default-locale-shim'
;(globalThis as unknown as { React: typeof React }).React = React

beforeEach(() => {
  mockWindowApi()
})
afterEach(() => {
  cleanup()
  useLocale('en')
})

describe('G-02 — decoding is not a signature verdict', () => {
  it('shows "Decoded" + "Signature not verified" for a decoded, unchecked token', () => {
    render(<JwtTool />)
    expect(screen.queryByText('Valid JWT')).toBeNull()
    expect(screen.getByTestId('jwt-decoded-badge')).toHaveTextContent('Decoded')
    expect(screen.getByTestId('jwt-signature-unverified')).toHaveTextContent(
      'Signature not verified',
    )
  })

  it('replaces "Signature not verified" with the verdict once verified', async () => {
    render(<JwtTool />)
    fireEvent.click(screen.getByRole('button', { name: /verify signature/i }))
    await waitFor(() => expect(screen.getAllByText('Signature verified').length).toBeGreaterThan(0))
    expect(screen.queryByTestId('jwt-signature-unverified')).toBeNull()
  })

  it('is translated in Turkish', () => {
    useLocale('tr')
    render(<JwtTool />)
    expect(screen.getByTestId('jwt-decoded-badge')).toHaveTextContent('Çözüldü')
    expect(screen.getByTestId('jwt-signature-unverified')).toHaveTextContent('İmza doğrulanmadı')
  })

  it('the decoded badge is neutral, not the success tone', () => {
    render(<JwtTool />)
    const style = screen.getByTestId('jwt-decoded-badge').getAttribute('style') ?? ''
    expect(style).not.toContain('--green')
    expect(style).toContain('var(--muted)')
  })
})

describe('G-03 — Tools atoms use theme tokens, not light-theme hex', () => {
  const span = (container: HTMLElement, text: string): HTMLElement => {
    const el = Array.from(container.querySelectorAll('span')).find((s) => s.textContent === text)
    if (!el) throw new Error(`no span "${text}"`)
    return el
  }

  it('colorizeJson colours keys / strings / numbers / booleans / null with --json-* tokens', () => {
    const { container } = render(
      <div>{colorizeJson('{"k": "s", "n": 12, "b": true, "z": null}')}</div>,
    )
    expect(span(container, '"k"').getAttribute('style')).toContain('var(--json-key)')
    expect(span(container, '"s"').getAttribute('style')).toContain('var(--json-string)')
    expect(span(container, '12').getAttribute('style')).toContain('var(--json-number)')
    expect(span(container, 'true').getAttribute('style')).toContain('var(--json-bool)')
    expect(span(container, 'null').getAttribute('style')).toContain('var(--json-null)')
  })

  it('Badge tones resolve to token triples (fg + bg + border)', () => {
    render(<Badge tone="danger">boom</Badge>)
    const style = screen.getByText('boom').getAttribute('style') ?? ''
    expect(style).toContain('var(--mb-delete-fg)')
    expect(style).toContain('var(--mb-delete-bg)')
    expect(style).toContain('var(--mb-delete-br)')
  })

  it('no shared Tools atom / palette module carries the old light-theme hex', () => {
    const root = join(__dirname, '../../src/renderer/components/tools')
    const files = [
      'ToolShell.tsx',
      'JwtTool.tsx',
      'palette.ts',
      'tls/atoms.tsx',
      'jwk/shared.ts',
      'jwk/atoms.tsx',
      'saml/VerifyReport.tsx',
      'keystore/AliasTable.tsx',
      ...readdirSync(join(root, 'jwt')).map((f) => `jwt/${f}`),
    ]
    const palette =
      /#(0066cc|1a7a4a|b35a00|cc2200|7c1fa6|0a7a5a|fff4e0|e8f9f1|fff0f0|e8f4ff|eeecfe|5b52d4)\b/i
    const offenders = files.filter((f) => palette.test(readFileSync(join(root, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
