/**
 * 1.6.0 screen review G-18 — the MCP OAuth Client ID / Scope fields and the
 * MQTT Client ID field carried their explanation in the placeholder
 * ("Empty = dynamic client registration", "Client ID (random when empty)"), and
 * a normal-width field cut it off mid-word. The placeholder is now a short
 * example / name; the explanation is a wrapping helper line under the field,
 * linked with aria-describedby, in the Socket.IO token-hint style
 * (`m-0 text-[11px] text-[var(--muted)]`). EN and TR.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import McpOAuthSection from '../../src/renderer/components/protocols/mcp/McpOAuthSection'
import MqttConnectionBar from '../../src/renderer/components/protocols/mqtt/MqttConnectionBar'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'

const useLocale = (l: 'en' | 'tr'): void => {
  useUIStore.setState({ locale: l })
  setLocale(l)
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-g18')
  useMcpStore.setState({ transport: 'http', url: 'http://srv.test/mcp' })
})

afterEach(() => {
  cleanup()
  useLocale('en')
})

/** The field's helper line: present, wrapping, sibling style. */
function helperOf(input: HTMLElement): HTMLElement {
  const id = input.getAttribute('aria-describedby')
  expect(id, 'aria-describedby').toBeTruthy()
  const hint = document.getElementById(id as string) as HTMLElement
  expect(hint, 'helper element').toBeTruthy()
  const cls = hint.className.split(/\s+/)
  for (const c of ['m-0', 'text-[11px]', 'text-[var(--muted)]']) expect(cls, c).toContain(c)
  for (const c of ['truncate', 'whitespace-nowrap']) expect(cls, c).not.toContain(c)
  return hint
}

/** A placeholder is a name or an example, never an explanation. */
function shortPlaceholder(input: HTMLElement): string {
  const ph = input.getAttribute('placeholder') ?? ''
  expect(ph.length).toBeGreaterThan(0)
  expect(ph.length, ph).toBeLessThanOrEqual(24)
  expect(ph, ph).not.toMatch(/=|\(|empty|boş/i)
  return ph
}

const CASES = {
  en: {
    clientId: /dynamic client registration/i,
    scope: /scopes the server advertises/i,
    mqtt: /random client ID/i,
  },
  tr: {
    clientId: /dinamik istemci kaydı/i,
    scope: /sunucunun bildirdiği kapsamlar/i,
    mqtt: /rastgele bir istemci kimliği/i,
  },
} as const

for (const locale of ['en', 'tr'] as const) {
  describe(`G-18 helper text under the field (${locale})`, () => {
    it('MCP OAuth Client ID and Scope', () => {
      useLocale(locale)
      render(React.createElement(McpOAuthSection, { embedded: true }))
      const clientId = screen.getByTestId('mcp-oauth-client-id')
      const scope = screen.getByTestId('mcp-oauth-scope')
      shortPlaceholder(clientId)
      shortPlaceholder(scope)
      expect(helperOf(clientId).textContent).toMatch(CASES[locale].clientId)
      expect(helperOf(scope).textContent).toMatch(CASES[locale].scope)
      // The field grid aligns its columns at the top when a helper wraps.
      const grid = clientId.closest('.grid') as HTMLElement
      expect(grid.className).toMatch(/\bitems-start\b/)
    })

    it('MQTT Client ID keeps its name as the placeholder', () => {
      useLocale(locale)
      render(React.createElement(MqttConnectionBar))
      const input = screen.getByTestId('mqtt-client-id')
      expect(shortPlaceholder(input)).toBe(locale === 'tr' ? 'İstemci kimliği' : 'Client ID')
      expect(helperOf(input).textContent).toMatch(CASES[locale].mqtt)
    })
  })
}
