/**
 * Issue #167 — MCP screens speak the user's language, not the spec's: "Run"
 * instead of "Invoke", "MCP 2026-07-28" / "MCP 2025 (classic)" instead of
 * eras and "legacy", spec terms (server/discover, initialize,
 * subscriptions/listen, -32022) only in tooltips. EN and TR move together.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import McpConnectionBar from '../../src/renderer/components/protocols/mcp/McpConnectionBar'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-wording')
})

afterEach(() => {
  cleanup()
  setLocale('en')
})

function both(key: string): { en: string; tr: string } {
  setLocale('en')
  const en = t(key)
  setLocale('tr')
  const tr = t(key)
  setLocale('en')
  return { en, tr }
}

describe('plain-language strings (EN + TR)', () => {
  it('the primary tool action is Run', () => {
    expect(both('mcp.tool.invoke')).toEqual({ en: 'Run', tr: 'Çalıştır' })
    expect(both('mcp.tool.invoking')).toEqual({ en: 'Running…', tr: 'Çalıştırılıyor…' })
  })

  it('protocol choices name MCP versions, never eras', () => {
    expect(both('mcp.protocol.auto')).toEqual({
      en: 'Auto (recommended)',
      tr: 'Otomatik (önerilen)',
    })
    expect(both('mcp.protocol.modern').en).toBe('MCP 2026-07-28')
    expect(both('mcp.protocol.legacy')).toEqual({
      en: 'MCP 2025 (classic)',
      tr: 'MCP 2025 (klasik)',
    })
    expect(both('mcp.protocol.pin').en).toBe('MCP {version}')
    for (const key of ['mcp.protocol.auto', 'mcp.protocol.legacy', 'mcp.protocol.pinGroup']) {
      const { en, tr } = both(key)
      expect(en).not.toMatch(/legacy|initialize|server\/discover/i)
      expect(tr).not.toMatch(/eski|initialize|server\/discover/i)
    }
    // The spec terms live in the tooltip.
    expect(both('mcp.protocol.hint').en).toMatch(/server\/discover/)
  })

  it('input card, error label and connect hint', () => {
    expect(both('mcp.input.title').en).toBe('The server needs your input')
    expect(both('mcp.input.round').en).toBe('step {n}')
    expect(both('mcp.input.round').tr).toBe('{n}. adım')
    expect(both('mcp.input.stateOnly').en).toBe(
      'The server asked to continue — press Submit to resume the call.',
    )
    expect(both('mcp.input.unsupportedRequest').en).toBe(
      "Testnizer can't answer this kind of request; Submit will decline it.",
    )
    expect(both('mcp.result.isError').en).toBe('The tool returned an error')
    expect(both('mcp.result.isError').tr).not.toMatch(/isError/)
    expect(both('mcp.connectHint').en).toBe('Enter a server URL or command and press Connect')
  })

  it('tool annotation badges have plain-language tooltips', () => {
    for (const k of ['readOnly', 'destructive', 'idempotent', 'openWorld']) {
      const { en, tr } = both(`mcp.tool.${k}Hint`)
      expect(en).not.toBe(`mcp.tool.${k}Hint`)
      expect(tr).not.toBe(`mcp.tool.${k}Hint`)
      expect(en).not.toMatch(/Hint\b|annotation/)
    }
  })

  it('Mock MCP: "2025 clients" with Allow / Refuse, no error code in the visible hint', () => {
    expect(both('mockMcp.general.legacyMode')).toEqual({
      en: '2025 clients',
      tr: '2025 istemcileri',
    })
    expect(both('mockMcp.general.legacyStateless').en).toBe('Allow (stateless)')
    expect(both('mockMcp.general.legacyReject').en).toBe('Refuse')
    const reject = both('mockMcp.general.legacyRejectHint')
    expect(reject.en).not.toMatch(/-32022/)
    expect(reject.tr).not.toMatch(/-32022/)
    expect(both('mockMcp.general.legacyRejectTooltip').en).toMatch(/-32022/)
    expect(both('mockMcp.general.cacheTtlHint').en).not.toMatch(/ttlMs|cacheScope/)
    expect(both('mockMcp.eras.modern').en).toBe('MCP 2026-07-28')
    expect(both('mockMcp.eras.legacy').en).toBe('MCP 2025')
    expect(both('mockMcp.elicit.hint').en).not.toMatch(/input_required/)
    expect(both('mockMcp.error.kind.isError').en).not.toMatch(/isError/)
  })
})

describe('connection bar badge', () => {
  it('a 2025 server is "MCP 2025-11-25" — never "(legacy)"; data-era still tells them apart', () => {
    useMcpStore.setState({
      connectionState: 'connected',
      protocolVersion: '2025-11-25',
      era: 'legacy',
      serverName: 'srv',
    })
    render(<McpConnectionBar />)
    const badge = screen.getByTestId('mcp-protocol-version')
    expect(badge.textContent).toBe('MCP 2025-11-25')
    expect(badge).toHaveAttribute('data-era', 'legacy')
    // The tooltip explains how the connection was made, in spec terms.
    expect(badge.getAttribute('title')).toMatch(/initialize/)
  })

  it('the protocol select lists MCP versions', () => {
    render(<McpConnectionBar />)
    const select = screen.getByTestId('mcp-protocol') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels.slice(0, 3)).toEqual([
      'Auto (recommended)',
      'MCP 2025 (classic)',
      'MCP 2026-07-28',
    ])
    expect(labels).toContain('MCP 2025-11-25')
    expect(labels.join(' ')).not.toMatch(/Legacy|Pin /)
  })
})
