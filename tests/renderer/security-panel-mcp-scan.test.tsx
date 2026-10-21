/**
 * Issue #229 — the MCP security scan lives in the MCP request tab (right pane,
 * Explorer | Security). Users looking for it on the left Security page did not
 * find it. The page now lists "MCP Security Scan" as a second door:
 *
 *   1. active tab is an MCP request → that tab's right pane switches to Security;
 *   2. else an MCP tab is open      → it is activated and switched to Security;
 *   3. else                         → a new MCP request tab opens on Security.
 *
 * The section is per tab (issue #76): only the tab the click targeted changes.
 * The row is rendered by the same component as its sibling tool rows, is found
 * by the panel's search, and is NOT a tool tab (Cmd+K's tool loop and the
 * Tools/Security partition stay untouched).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SecurityPanel from '../../src/renderer/components/sidebar/SecurityPanel'
import { openMcpSecurityScan } from '../../src/renderer/lib/open-mcp-security'
import {
  SECURITY_ACTIONS,
  SECURITY_TOOLS,
  TOOL_CATALOG,
} from '../../src/renderer/lib/tools-catalog'
import {
  MCP_EXPLORER_SECTION,
  MCP_SECURITY_SECTION,
  useMcpStore,
} from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import type { Tab } from '../../src/renderer/types'

function tab(id: string, protocol: Tab['protocol']): Tab {
  return { id, name: id, protocol, url: '', isDirty: false, isLoading: false } as Tab
}

/** Open `tabs` with `activeId` active, the MCP live slice on it (like Workbench does). */
function seed(tabs: Tab[], activeId: string | null): void {
  useTabsStore.setState({ tabs, activeTabId: activeId })
  useMcpStore.setState({
    _tabStates: new Map(),
    _currentTabId: null,
    section: MCP_EXPLORER_SECTION,
  })
  // Give every MCP tab a cached slice, then land on the active one.
  for (const t of tabs) if (t.protocol === 'mcp') useMcpStore.getState().switchToTab(t.id)
  if (activeId) useMcpStore.getState().switchToTab(activeId)
}

function sectionOf(tabId: string): string | undefined {
  const s = useMcpStore.getState()
  return s._currentTabId === tabId ? s.section : s._tabStates.get(tabId)?.section
}

beforeEach(() => {
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
  seed([], null)
})

afterEach(() => cleanup())

describe('openMcpSecurityScan — the three click cases', () => {
  it('case 1: the active tab is an MCP request → its right pane switches to Security', () => {
    seed([tab('mcp-a', 'mcp'), tab('mcp-b', 'mcp')], 'mcp-a')
    openMcpSecurityScan()
    const tabs = useTabsStore.getState()
    expect(tabs.activeTabId).toBe('mcp-a')
    expect(tabs.tabs).toHaveLength(2)
    expect(useMcpStore.getState()._currentTabId).toBe('mcp-a')
    expect(sectionOf('mcp-a')).toBe(MCP_SECURITY_SECTION)
    // Issue #76: the other MCP tab keeps its own section.
    expect(sectionOf('mcp-b')).toBe(MCP_EXPLORER_SECTION)
    useMcpStore.getState().switchToTab('mcp-b')
    expect(useMcpStore.getState().section).toBe(MCP_EXPLORER_SECTION)
    useMcpStore.getState().switchToTab('mcp-a')
    expect(useMcpStore.getState().section).toBe(MCP_SECURITY_SECTION)
  })

  it('case 2: another tab is active but an MCP tab is open → it is activated on Security', () => {
    seed([tab('mcp-a', 'mcp'), tab('http-1', 'http'), tab('mock-1', 'mockMcpServer')], 'http-1')
    openMcpSecurityScan()
    const tabs = useTabsStore.getState()
    expect(tabs.activeTabId).toBe('mcp-a')
    expect(tabs.tabs).toHaveLength(3)
    expect(useMcpStore.getState()._currentTabId).toBe('mcp-a')
    expect(useMcpStore.getState().section).toBe(MCP_SECURITY_SECTION)
  })

  it('case 2: with several MCP tabs open, the last one in the strip is picked', () => {
    seed([tab('mcp-a', 'mcp'), tab('mcp-b', 'mcp'), tab('http-1', 'http')], 'http-1')
    openMcpSecurityScan()
    expect(useTabsStore.getState().activeTabId).toBe('mcp-b')
    expect(sectionOf('mcp-b')).toBe(MCP_SECURITY_SECTION)
    expect(sectionOf('mcp-a')).toBe(MCP_EXPLORER_SECTION)
  })

  it('case 3: no MCP tab is open → a new MCP request tab opens on Security', () => {
    seed([tab('http-1', 'http'), tab('mock-1', 'mockMcpServer')], 'http-1')
    openMcpSecurityScan()
    const tabs = useTabsStore.getState()
    expect(tabs.tabs).toHaveLength(3)
    const opened = tabs.tabs.find((t) => t.id === tabs.activeTabId)
    expect(opened?.protocol).toBe('mcp')
    expect(opened?.name).toBe('MCP')
    expect(opened?.isDirty).toBeFalsy()
    expect(useMcpStore.getState()._currentTabId).toBe(tabs.activeTabId)
    expect(useMcpStore.getState().section).toBe(MCP_SECURITY_SECTION)
  })

  it('case 3 with no tabs at all', () => {
    openMcpSecurityScan()
    const tabs = useTabsStore.getState()
    expect(tabs.tabs).toHaveLength(1)
    expect(tabs.tabs[0].protocol).toBe('mcp')
    expect(useMcpStore.getState().section).toBe(MCP_SECURITY_SECTION)
  })
})

describe('SecurityPanel — the MCP Security Scan row', () => {
  it('renders the row and clicking it runs the action (case 3 end to end)', () => {
    render(<SecurityPanel />)
    const row = screen.getByTestId('security-tool-mcp-scan')
    expect(row).toHaveTextContent('MCP Security Scan')
    fireEvent.click(row)
    const tabs = useTabsStore.getState()
    expect(tabs.tabs.find((t) => t.id === tabs.activeTabId)?.protocol).toBe('mcp')
    expect(useMcpStore.getState().section).toBe(MCP_SECURITY_SECTION)
    // Not a tool tab: nothing opened with a `tools.*` protocol.
    expect(tabs.tabs.some((t) => String(t.protocol).startsWith('tools.'))).toBe(false)
  })

  it('is rendered exactly like its sibling tool rows', () => {
    render(<SecurityPanel />)
    const action = screen.getByTestId('security-tool-mcp-scan')
    const sibling = screen.getByTestId('security-tool-tools.jwt')
    expect(action.tagName).toBe(sibling.tagName)
    expect(action.className).toBe(sibling.className)
    expect(action.getAttribute('style')).toBe(sibling.getAttribute('style'))
    const [aBox, sBox] = [action.firstElementChild, sibling.firstElementChild] as HTMLElement[]
    expect(aBox.className).toBe(sBox.className)
    expect(aBox.style.width).toBe(sBox.style.width)
    expect(aBox.style.height).toBe(sBox.style.height)
    const [aSvg, sSvg] = [aBox.querySelector('svg'), sBox.querySelector('svg')]
    expect(aSvg?.getAttribute('width')).toBe(sSvg?.getAttribute('width'))
    expect(aSvg?.getAttribute('stroke-width')).toBe(sSvg?.getAttribute('stroke-width'))
    const [aLabel, sLabel] = [action.lastElementChild, sibling.lastElementChild] as HTMLElement[]
    expect(aLabel.getAttribute('style')).toBe(sLabel.getAttribute('style'))
    // The one-line hint is the row's tooltip.
    expect(action).toHaveAttribute('title', expect.stringMatching(/prompt injection/i))
    // Listed after the tools, under the same "Tools" heading.
    const rows = screen.getAllByTestId(/^security-tool-/)
    expect(rows).toHaveLength(SECURITY_TOOLS.length + SECURITY_ACTIONS.length)
    expect(rows[rows.length - 1]).toBe(action)
  })

  it('is found by the panel search, and filtered out by an unrelated query', () => {
    render(<SecurityPanel />)
    const search = screen.getByLabelText(/^Search/)
    fireEvent.change(search, { target: { value: 'scan' } })
    expect(screen.getByTestId('security-tool-mcp-scan')).toBeInTheDocument()
    expect(screen.queryByTestId('security-tool-tools.jwt')).toBeNull()
    fireEvent.change(search, { target: { value: 'MCP' } })
    expect(screen.getByTestId('security-tool-mcp-scan')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'keystore' } })
    expect(screen.queryByTestId('security-tool-mcp-scan')).toBeNull()
    expect(screen.getByTestId('security-tool-tools.keystore')).toBeInTheDocument()
  })

  it('is found by its Turkish label in TR', () => {
    useUIStore.setState({ locale: 'tr' })
    setLocale('tr')
    render(<SecurityPanel />)
    const row = screen.getByTestId('security-tool-mcp-scan')
    expect(row).toHaveTextContent('MCP Güvenlik Taraması')
    fireEvent.change(screen.getByLabelText(/^Ara/), { target: { value: 'tarama' } })
    expect(screen.getByTestId('security-tool-mcp-scan')).toBeInTheDocument()
  })

  it('is highlighted only while the active MCP tab shows Security', () => {
    seed([tab('mcp-a', 'mcp'), tab('http-1', 'http')], 'mcp-a')
    render(<SecurityPanel />)
    const row = screen.getByTestId('security-tool-mcp-scan')
    expect(row).not.toHaveAttribute('aria-current')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-current', 'page')
    // Back to Explorer in the editor → no longer current.
    act(() => useMcpStore.getState().setSection(MCP_EXPLORER_SECTION))
    expect(row).not.toHaveAttribute('aria-current')
  })

  it('stays out of the tool catalog (no empty tool tab, no Cmd+K "Open tool")', () => {
    for (const a of SECURITY_ACTIONS) {
      expect(TOOL_CATALOG.some((t) => (t.protocol as string) === a.id)).toBe(false)
    }
    expect(SECURITY_ACTIONS.map((a) => a.id)).toEqual(['mcp-scan'])
  })
})
