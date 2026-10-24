/**
 * Issue #278 — pasting a cURL command into the HTTP URL bar fills the request
 * (method, URL + params, headers, body, auth, settings) through the shared
 * parser (issue #279), marks the tab dirty and shows a toast with Undo and
 * the parser's notes. A plain URL / any non-cURL text pastes as before; other
 * protocols' URL bars are untouched; pasted credentials never reach
 * localStorage (issue #244 rule).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Toaster } from 'sonner'
import UrlBar from '../../src/renderer/components/layout/UrlBar'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { applyCurlPaste } from '../../src/renderer/lib/curl-paste'
import type { Tab } from '../../src/renderer/types'

const PASS = 'LITERAL-pasted-pass-278'
const TOKEN = 'LITERAL-pasted-token-278'

const BASH = [
  `curl 'https://api.example.com/v1/users?page=2' \\`,
  `  -X POST \\`,
  `  -H 'Content-Type: application/json' \\`,
  `  -H 'X-Trace: it'\\''s' \\`,
  `  -u 'alice:${PASS}' \\`,
  `  -k -L -m 7 \\`,
  `  --data-raw '{"name":"Ada","tags":["a","b"]}'`,
].join('\n')

const POWERSHELL = [
  "curl.exe 'https://api.example.com/v1/items' `",
  '  -X PUT `',
  `  -H 'Authorization: Bearer ${TOKEN}' \``,
  "  -H 'X-Note: it''s' `",
  `  -d '{\\"id\\":7}' \``,
  '  --frobnicate',
].join('\n')

function activate(tab: Partial<Tab> = {}): void {
  useTabsStore.setState({
    tabs: [
      {
        id: 'tab-1',
        name: 'Req',
        method: 'GET',
        url: '',
        protocol: 'http',
        isDirty: false,
        ...tab,
      } as Tab,
    ],
    activeTabId: 'tab-1',
  })
  useRequestStore.getState().switchToTab('tab-1')
  useRequestStore.setState({
    method: 'GET',
    url: 'https://old.test/keep?x=1',
    params: [{ id: 'p1', key: 'x', value: '1', enabled: true }],
    headers: [{ id: 'h1', key: 'X-Old', value: 'yes', enabled: true }],
    body: { type: 'none' },
    auth: { type: 'inherit' },
    followRedirects: true,
    maxRedirects: 5,
    sslVerification: true,
    requestTimeout: null,
  })
  useTabsStore.getState().markDirty('tab-1', false)
}

function paste(text: string): boolean {
  const input = screen.getByTestId('url-input')
  return fireEvent.paste(input, { clipboardData: { getData: () => text } })
}

function allStorage(): string {
  const out: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  return out.join('\n')
}

const tab1 = (): Tab => useTabsStore.getState().tabs[0]

beforeEach(() => {
  window.localStorage.clear()
  useUIStore.getState().setLocale('en')
  activate()
  render(
    <>
      <Toaster />
      <UrlBar />
    </>,
  )
})
afterEach(() => {
  cleanup()
  useUIStore.getState().setLocale('en')
})

describe('URL bar cURL paste (issue #278)', () => {
  it('a multi-line bash cURL fills method, URL + params, headers, body, auth and settings', async () => {
    const notPrevented = paste(BASH)
    expect(notPrevented).toBe(false)
    const s = useRequestStore.getState()
    expect(s.method).toBe('POST')
    expect(s.url).toBe('https://api.example.com/v1/users?page=2')
    expect(s.params.map((p) => [p.key, p.value])).toEqual([['page', '2']])
    expect(s.headers.map((h) => `${h.key}: ${h.value}`)).toEqual([
      'Content-Type: application/json',
      "X-Trace: it's",
    ])
    expect(s.body).toEqual({ type: 'json', content: '{"name":"Ada","tags":["a","b"]}' })
    expect(s.auth).toEqual({ type: 'basic', basic: { username: 'alice', password: PASS } })
    expect(s.sslVerification).toBe(false)
    expect(s.followRedirects).toBe(true)
    expect(s.requestTimeout).toBe(7000)
    expect(tab1().isDirty).toBe(true)
    expect(tab1().method).toBe('POST')
    const toastEl = await screen.findByTestId('curl-paste-toast')
    expect(toastEl).toHaveAttribute('data-dialect', 'bash')
    expect(toastEl).toHaveTextContent('Request filled from a bash cURL command')
    expect(screen.queryByTestId('curl-paste-warnings')).toBeNull()
  })

  it('a PowerShell curl.exe command parses too and lists the parser notes', async () => {
    paste(POWERSHELL)
    const s = useRequestStore.getState()
    expect(s.method).toBe('PUT')
    expect(s.url).toBe('https://api.example.com/v1/items')
    expect(s.headers.map((h) => `${h.key}: ${h.value}`)).toEqual([
      `Authorization: Bearer ${TOKEN}`,
      "X-Note: it's",
    ])
    expect(s.body).toEqual({ type: 'json', content: '{"id":7}' })
    // No auth flag but an Authorization header → No Auth (the header stays a
    // header; inheriting would add a second auth header).
    expect(s.auth).toEqual({ type: 'none' })
    const toastEl = await screen.findByTestId('curl-paste-toast')
    expect(toastEl).toHaveAttribute('data-dialect', 'powershell')
    const notes = screen.getAllByTestId('curl-paste-warning')
    expect(notes.map((n) => n.getAttribute('data-code'))).toEqual(['unknown-flag'])
    expect(notes[0]).toHaveTextContent('Unknown option --frobnicate was ignored')
  })

  it('no auth flag and no credential header → Inherit, so folder / project auth still applies', () => {
    useRequestStore.setState({ auth: { type: 'bearer', bearer: { token: 'old' } } })
    paste(`curl -H 'Accept: application/json' -H 'X-Trace: 1' https://api.example.com/plain`)
    expect(useRequestStore.getState().auth).toEqual({ type: 'inherit' })
  })

  it('a credential header that is not Authorization (X-API-Key, Cookie) also means No Auth', () => {
    paste(`curl -H 'X-API-Key: k-278' https://api.example.com/k`)
    expect(useRequestStore.getState().auth).toEqual({ type: 'none' })
    paste(`curl -b 'session=abc' https://api.example.com/c`)
    expect(useRequestStore.getState().auth).toEqual({ type: 'none' })
  })

  it('an explicit auth flag maps to its type even next to a credential header', () => {
    paste(`curl --oauth2-bearer tok-278 -H 'X-API-Key: k' https://api.example.com/b`)
    expect(useRequestStore.getState().auth).toEqual({
      type: 'bearer',
      bearer: { token: 'tok-278' },
    })
    paste(`curl -u bob:pw --digest https://api.example.com/d`)
    expect(useRequestStore.getState().auth).toEqual({
      type: 'digest',
      digest: { username: 'bob', password: 'pw' },
    })
  })

  it('Undo restores the previous request, its tab method and its clean state', async () => {
    useRequestStore.setState({ withheldCredentials: ['auth.basic.password'] })
    paste(BASH)
    // The replaced request's withheld markers must not refill the pasted one on Ctrl+S.
    expect(useRequestStore.getState().withheldCredentials).toEqual([])
    fireEvent.click(await screen.findByTestId('curl-paste-undo'))
    expect(useRequestStore.getState().withheldCredentials).toEqual(['auth.basic.password'])
    const s = useRequestStore.getState()
    expect(s.method).toBe('GET')
    expect(s.url).toBe('https://old.test/keep?x=1')
    expect(s.headers.map((h) => h.key)).toEqual(['X-Old'])
    expect(s.auth).toEqual({ type: 'inherit' })
    expect(s.sslVerification).toBe(true)
    expect(tab1().isDirty).toBe(false)
    expect(tab1().method).toBe('GET')
    await waitFor(() => expect(screen.queryByTestId('curl-paste-toast')).toBeNull())
  })

  it('a second paste replaces the first toast (no stale Undo); ✕ dismisses it', async () => {
    paste(BASH)
    await screen.findByTestId('curl-paste-toast')
    paste(POWERSHELL)
    await waitFor(() =>
      expect(screen.getByTestId('curl-paste-toast')).toHaveAttribute('data-dialect', 'powershell'),
    )
    expect(screen.getAllByTestId('curl-paste-toast')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('curl-paste-close'))
    await waitFor(() => expect(screen.queryByTestId('curl-paste-toast')).toBeNull())
    // Dismissing is not undoing.
    expect(useRequestStore.getState().method).toBe('PUT')
  })

  it('a plain URL (and any non-cURL text) pastes normally — nothing is replaced', () => {
    expect(paste('https://api.example.com/plain?q=1')).toBe(true)
    expect(paste('curl is a nice word')).toBe(true)
    const s = useRequestStore.getState()
    expect(s.url).toBe('https://old.test/keep?x=1')
    expect(s.method).toBe('GET')
    expect(tab1().isDirty).toBe(false)
    expect(screen.queryByTestId('curl-paste-toast')).toBeNull()
  })

  it('a cURL command without a URL is refused with an error, the request kept', async () => {
    expect(paste('curl -X POST -H "A: b"')).toBe(false)
    expect(useRequestStore.getState().url).toBe('https://old.test/keep?x=1')
    expect(await screen.findByText('The pasted cURL command has no URL')).toBeInTheDocument()
  })

  it('other protocols keep their plain paste (the store is not touched)', () => {
    act(() => {
      useTabsStore.setState({
        tabs: [{ ...tab1(), protocol: 'websocket' } as Tab],
        activeTabId: 'tab-1',
      })
    })
    expect(paste(BASH)).toBe(true)
    expect(useRequestStore.getState().url).toBe('https://old.test/keep?x=1')
    expect(applyCurlPaste(BASH).status).toBe('ignored')
  })

  it('pasted credentials stay in memory but never reach localStorage', () => {
    paste(BASH)
    paste(POWERSHELL)
    const stored = allStorage()
    expect(stored).not.toContain(PASS)
    expect(stored).not.toContain(TOKEN)
    expect(stored).toContain('api.example.com')
    expect(useRequestStore.getState().headers[0].value).toBe(`Bearer ${TOKEN}`)
  })

  it('the toast and notes follow the UI language (Turkish)', async () => {
    act(() => useUIStore.getState().setLocale('tr'))
    paste(POWERSHELL)
    const toastEl = await screen.findByTestId('curl-paste-toast')
    expect(toastEl).toHaveTextContent('İstek PowerShell cURL komutundan dolduruldu')
    expect(screen.getByTestId('curl-paste-undo')).toHaveTextContent('Geri al')
    expect(screen.getByTestId('curl-paste-warning')).toHaveTextContent(
      'Bilinmeyen --frobnicate seçeneği yok sayıldı',
    )
  })
})
