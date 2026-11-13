/**
 * Tester findings 8 and 9 (1.6.0) — the Headers autocomplete took over Tab.
 *
 *  8. Typing the full name `Authorization` and pressing Tab turned the key into
 *     `Proxy-Authorization` and kept the caret in the key cell: the exact match
 *     is (deliberately) left out of the list, so the only suggestion left was
 *     `Proxy-Authorization`, preselected, and Tab accepted it.
 *  9. Tabbing into an empty value cell of `Content-Type` opened the value list
 *     with `application/json` preselected; a second Tab wrote it in.
 *
 * Rule (VS Code / Postman): the list opens with nothing selected. Tab and Enter
 * accept a suggestion only after the user picked one with the arrow keys; with
 * no pick, Tab leaves the text alone and moves focus on. Hovering a row with
 * the mouse is not a pick (the list can open under a resting pointer).
 *
 * The `{{` variable list is a different popup (VariableAutocompleteInput): the
 * user typed the trigger, so its first item stays preselected and Tab accepts.
 *
 * `@testing-library/user-event` is not installed: `fireEvent.keyDown` returns
 * `false` when the handler called preventDefault — "true" means the browser's
 * own Tab (focus to the next field) runs. Real focus movement is proven by
 * the e2e spec 68-header-autocomplete-tab.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react'
;(globalThis as unknown as { React: typeof React }).React = React

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import HeadersTab from '../../src/renderer/components/request/HeadersTab'
import KeyValueTable from '../../src/renderer/components/shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../src/renderer/lib/http-headers'
import type { KeyValuePair } from '../../src/renderer/types'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

type ApiStub = { app: { version: () => Promise<unknown> } }

beforeEach(() => {
  // jsdom has no layout; the {{ list scrolls its highlighted row into view.
  Element.prototype.scrollIntoView = () => {}
  ;(window as unknown as { api: ApiStub }).api = {
    app: { version: async () => ({ success: true, data: { version: '7.7.7' } }) },
  }
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({
    method: 'GET',
    url: 'https://api.example.com/users',
    headers: [{ id: 'h1', key: '', value: '', enabled: true }],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
  })
})
afterEach(() => cleanup())

function row(): HTMLElement {
  return screen.getByTestId('kv-row-0')
}
function keyInput(): HTMLInputElement {
  return within(row()).getByTestId('kv-key') as HTMLInputElement
}
function valueInput(): HTMLInputElement {
  return within(row()).getByTestId('kv-value').querySelector('input') as HTMLInputElement
}
function storedHeader(): { key: string; value: string } {
  const h = useRequestStore.getState().headers[0]
  return { key: h.key, value: h.value }
}

/** Types `text` one character at a time, like the keyboard does. */
function typeInto(input: HTMLInputElement, text: string): void {
  act(() => input.focus())
  for (let i = 1; i <= text.length; i++) {
    fireEvent.change(input, { target: { value: text.slice(0, i) } })
  }
}

/** Presses Tab; when the app does not take it over, moves focus like the browser. */
function pressTab(from: HTMLElement, next: HTMLElement): boolean {
  const browserDefault = fireEvent.keyDown(from, { key: 'Tab' })
  if (browserDefault) act(() => next.focus())
  return browserDefault
}

describe('Headers autocomplete — Tab does not rewrite what was typed (findings 8, 9)', () => {
  for (const name of ['Authorization', 'Accept', 'Cookie', 'Range']) {
    it(`finding 8: "${name}" + Tab keeps "${name}" and lets focus move on`, () => {
      render(<HeadersTab />)
      typeInto(keyInput(), name)
      // The list is open (longer names contain the typed one) — the repro.
      expect(screen.getByTestId('kv-autocomplete')).toBeInTheDocument()

      const browserDefault = pressTab(keyInput(), valueInput())
      expect(browserDefault).toBe(true)
      expect(keyInput()).toHaveValue(name)
      expect(storedHeader().key).toBe(name)
      expect(document.activeElement).toBe(valueInput())
    })
  }

  it('finding 8: Enter without a pick does not replace the key either', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'Authorization')
    fireEvent.keyDown(keyInput(), { key: 'Enter' })
    expect(storedHeader().key).toBe('Authorization')
  })

  it('finding 8: hovering a suggestion is not a pick — Tab still keeps the text', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'Authorization')
    const item = screen.getAllByTestId('kv-autocomplete-item')[0]
    fireEvent.mouseEnter(item)
    expect(pressTab(keyInput(), valueInput())).toBe(true)
    expect(storedHeader().key).toBe('Authorization')
  })

  it('finding 9: Tab through an empty Content-Type value leaves it empty', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'Content-Type')
    // The key list may be open; the tester pressed Escape.
    fireEvent.keyDown(keyInput(), { key: 'Escape' })
    pressTab(keyInput(), valueInput())
    // Focusing the empty value cell opens the value list — the repro.
    expect(screen.getByTestId('kv-autocomplete')).toBeInTheDocument()
    expect(screen.getAllByTestId('kv-autocomplete-item').map((n) => n.textContent)).toContain(
      'application/json',
    )

    const description = within(row()).getByPlaceholderText('Description')
    const browserDefault = pressTab(valueInput(), description)
    expect(browserDefault).toBe(true)
    expect(valueInput()).toHaveValue('')
    expect(storedHeader()).toEqual({ key: 'Content-Type', value: '' })
    expect(screen.queryByTestId('kv-autocomplete')).not.toBeInTheDocument()
  })

  it('finding 9: a Tab without a pick closes the key list (it does not follow focus)', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'X-Custom')
    // `X-Custom` has no value list, so nothing replaces the key popup on focus.
    typeInto(keyInput(), 'X-Re')
    expect(screen.getByTestId('kv-autocomplete')).toBeInTheDocument()
    pressTab(keyInput(), valueInput())
    expect(screen.queryByTestId('kv-autocomplete')).not.toBeInTheDocument()
    // ArrowDown + Enter in the value cell can no longer write into the key.
    fireEvent.keyDown(valueInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(valueInput(), { key: 'Enter' })
    expect(storedHeader().key).toBe('X-Re')
  })
})

describe('Headers autocomplete — an explicit pick is still accepted', () => {
  it('ArrowDown + Enter accepts the highlighted header name', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'cont')
    const first = screen.getAllByTestId('kv-autocomplete-item')[0].textContent
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    expect(fireEvent.keyDown(keyInput(), { key: 'Enter' })).toBe(false)
    expect(storedHeader().key).toBe(first)
    expect(screen.queryByTestId('kv-autocomplete')).not.toBeInTheDocument()
  })

  it('ArrowDown + Tab accepts the highlighted header name', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'Authorization')
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    expect(fireEvent.keyDown(keyInput(), { key: 'Tab' })).toBe(false)
    expect(storedHeader().key).toBe('Proxy-Authorization')
  })

  it('ArrowDown twice picks the second suggestion; ArrowUp goes back', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'cont')
    const items = screen.getAllByTestId('kv-autocomplete-item').map((n) => n.textContent)
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(keyInput(), { key: 'ArrowUp' })
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(keyInput(), { key: 'Enter' })
    expect(storedHeader().key).toBe(items[1])
  })

  it('a mouse click on a suggestion accepts it', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'cont')
    const item = screen
      .getAllByTestId('kv-autocomplete-item')
      .find((n) => n.textContent === 'Content-Type') as HTMLElement
    fireEvent.mouseDown(item)
    expect(storedHeader().key).toBe('Content-Type')
  })

  it('the value list accepts an arrow pick (Content-Type → application/json)', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'Content-Type')
    fireEvent.keyDown(keyInput(), { key: 'Escape' })
    pressTab(keyInput(), valueInput())
    typeInto(valueInput(), 'json')
    fireEvent.keyDown(valueInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(valueInput(), { key: 'Enter' })
    expect(storedHeader().value).toBe('application/json')
  })

  it('the {{ variable list still opens and Tab accepts its first item', () => {
    render(<HeadersTab />)
    typeInto(keyInput(), 'X-Trace')
    fireEvent.keyDown(keyInput(), { key: 'Escape' })
    typeInto(valueInput(), '{{$randomUU')
    expect(screen.getByTestId('var-autocomplete')).toBeInTheDocument()
    expect(fireEvent.keyDown(valueInput(), { key: 'Tab' })).toBe(false)
    expect(storedHeader().value).toBe('{{$randomUUID}}')
  })
})

/**
 * Every other header editor (SSE, GraphQL, MCP, AI Chat settings + tool
 * servers, WebSocket / Socket.IO / MQTT rows) renders the same KeyValueTable
 * with `keyAutocompleteEntries` and without `enableAutocomplete`. This is that
 * shape, outside the request store.
 */
function StatefulHeaderTable(): React.JSX.Element {
  const [rows, setRows] = React.useState<KeyValuePair[]>([
    { id: 'r1', key: '', value: '', enabled: true },
  ])
  return (
    <KeyValueTable
      rows={rows}
      onUpdate={(id, patch) =>
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      }
      onRemove={() => {}}
      onAdd={() => {}}
      keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
    />
  )
}

describe('the same rule in every header editor (single owner: KeyValueTable)', () => {
  it('key-only header table: "Authorization" + Tab stays, ArrowDown + Enter picks', () => {
    render(<StatefulHeaderTable />)
    typeInto(keyInput(), 'Authorization')
    expect(screen.getByTestId('kv-autocomplete')).toBeInTheDocument()
    expect(pressTab(keyInput(), valueInput())).toBe(true)
    expect(keyInput()).toHaveValue('Authorization')

    typeInto(keyInput(), 'Authorization')
    fireEvent.keyDown(keyInput(), { key: 'ArrowDown' })
    fireEvent.keyDown(keyInput(), { key: 'Enter' })
    expect(keyInput()).toHaveValue('Proxy-Authorization')
  })

  it('no other renderer file runs its own header suggestion list', () => {
    const root = resolve(__dirname, '../../src/renderer')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(name)) files.push(full)
      }
    }
    walk(root)
    const owners = files
      .filter((f) => /filterHeader(Value)?Suggestions\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f))
      .sort()
    expect(owners).toEqual(['components/shared/KeyValueTable.tsx', 'lib/http-headers.ts'])
  })
})
