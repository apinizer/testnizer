/// <reference types="react" />
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Suppress "React is not defined" — the renderer tsconfig uses
// jsx: react-jsx, but vitest's transform here does not. Make the
// runtime React reference live on globalThis so JSX can compile.
;(globalThis as unknown as { React: typeof React }).React = React
import CookieTab from '../../src/renderer/components/response/CookieTab'
import { useResponseStore } from '../../src/renderer/stores/response.store'
import type { ApiResponse } from '../../src/renderer/types'

// A JWT-like unbroken token (~300 chars) — the issue #105 repro: without
// wrapping classes it paints over the Domain/Path/Flags columns.
const LONG_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE5MTYyMzkwMjIsImlzcyI6Imh0dHBzOi8vYXV0aC5leGFtcGxlLmNvbSIsImF1ZCI6InRlc3RuaXplciIsInNjb3BlIjoib3BlbmlkIHByb2ZpbGUgZW1haWwifQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5cSflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'

function seedResponse(): void {
  const response: ApiResponse = {
    requestId: 'r1',
    protocol: 'http',
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '',
    timing: { total: 1 },
    cookies: [
      {
        name: 'access_token',
        value: LONG_JWT,
        domain: 'auth.example.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
      { name: 'sid', value: 'abc', domain: 'example.com', path: '/' },
    ],
  }
  useResponseStore.setState({ response, isLoading: false })
}

describe('CookieTab — long value stays inside its cell (issue #105)', () => {
  beforeEach(() => {
    seedResponse()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the full cookie value (copyable via selection)', () => {
    render(<CookieTab />)
    expect(screen.getByText(LONG_JWT)).toBeTruthy()
  })

  it('value cell carries wrapping classes so a JWT cannot overflow neighbours', () => {
    render(<CookieTab />)
    const valueCell = screen.getByText(LONG_JWT)
    expect(valueCell.className).toContain('break-all')
    expect(valueCell.className).toContain('min-w-0')
  })

  it('every cell in a row is shrinkable (min-w-0) and rows top-align on wrap', () => {
    render(<CookieTab />)
    const row = screen.getByText(LONG_JWT).parentElement
    expect(row).toBeTruthy()
    expect(row!.className).toContain('items-start')
    const cells = Array.from(row!.children)
    expect(cells.length).toBeGreaterThanOrEqual(5)
    for (const cell of cells) {
      expect((cell as HTMLElement).className).toContain('min-w-0')
    }
  })

  it('header and rows share the same grid template so columns stay aligned', () => {
    const { container } = render(<CookieTab />)
    const grids = Array.from(container.querySelectorAll('[class*="grid-cols-"]')) as HTMLElement[]
    // header + 2 rows
    expect(grids.length).toBe(3)
    const template = (el: HTMLElement): string =>
      (el.className.match(/grid-cols-\S+/) ?? [''])[0]
    const headerTemplate = template(grids[0])
    expect(headerTemplate).not.toBe('')
    for (const grid of grids.slice(1)) {
      expect(template(grid)).toBe(headerTemplate)
    }
  })
})
