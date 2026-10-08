/**
 * Issue #142 — the "Security" section of the MCP editor: registered as an
 * extra right-pane tab, the opt-in (default off), the disclaimer, Scan /
 * Cancel while running, progress, the grade badge, category accordions with
 * finding rows and expandable evidence, and "Save HTML report…" going
 * through the export + save-file bridges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import McpEditor from '../../src/renderer/components/protocols/McpEditor'
import McpSecuritySection from '../../src/renderer/components/protocols/mcp/McpSecuritySection'
import { MCP_EXTRA_SECTIONS } from '../../src/renderer/components/protocols/mcp/sections'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { McpSecurityFinding, McpSecurityReport } from '../../src/renderer/types/mcp'

const CORS: McpSecurityFinding = {
  id: 'cors.cors_wildcard_with_credentials',
  category: 'cors',
  title: 'CORS policy',
  severity: 'high',
  status: 'fail',
  detail: 'Wildcard origin with credentials.',
  recommendation: 'Send no CORS headers.',
  refs: ['https://fetch.spec.whatwg.org/#http-cors-protocol'],
  evidence: {
    request: {
      method: 'OPTIONS',
      url: 'http://srv.test/mcp',
      headers: { authorization: 'Bearer ••••', origin: 'https://evil.example' },
    },
    response: { status: 204, headers: { 'access-control-allow-origin': '*' } },
  },
}

const HTTPS: McpSecurityFinding = {
  id: 'transport.https',
  category: 'transport',
  title: 'HTTPS',
  severity: 'info',
  status: 'info',
  detail: 'Plain HTTP on a loopback address.',
}

const REPORT: McpSecurityReport = {
  id: 'r1',
  startedAt: 1,
  finishedAt: 2,
  target: { url: 'http://srv.test/mcp', transport: 'http', host: 'srv.test', scheme: 'http' },
  grade: 'C',
  score: 72,
  categories: [
    { id: 'transport', title: 'Transport security', score: 100, findings: [HTTPS] },
    { id: 'cors', title: 'CORS', score: 85, findings: [CORS] },
  ],
  summary: { pass: 0, warn: 0, fail: 1, info: 1, skipped: 0 },
  serverInfo: { name: 'srv', version: '1.0.0', protocolVersion: '2025-11-25', capabilities: {} },
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab('tab-security-ui')
})

afterEach(() => cleanup())

describe('registration', () => {
  it('the Security section is an extra MCP editor tab', () => {
    expect(MCP_EXTRA_SECTIONS.map((s) => s.id)).toContain('security')
    render(<McpEditor />)
    fireEvent.click(screen.getByTestId('mcp-section-security'))
    expect(screen.getByTestId('mcp-security-tab')).toBeInTheDocument()
    expect(useMcpStore.getState().section).toBe('security')
  })
})

describe('McpSecuritySection', () => {
  it('shows the target and disclaimer; the rate-limit opt-in defaults to off and writes the store', () => {
    const startSecurityScan = vi.fn(async () => {})
    useMcpStore.setState({ url: 'http://srv.test/mcp', startSecurityScan })
    render(<McpSecuritySection />)
    expect(screen.getByTestId('mcp-security-target')).toHaveTextContent('http://srv.test/mcp')
    expect(screen.getByTestId('mcp-security-disclaimer')).toHaveTextContent(
      'Scan only servers you are authorized to test',
    )
    const optin = screen.getByTestId('mcp-security-ratelimit-optin')
    expect(optin).not.toBeChecked()
    // Issue #152: one "active probes" opt-in — the rate-limit burst and the tool calls.
    expect(optin.closest('label')).toHaveTextContent(
      'Include active probes (rate-limit burst ~30 requests + calling argument-free tools annotated read-only, or unannotated tools whose name does not look like a write — never destructive ones — to test requestState tampering) — authorized servers only',
    )
    fireEvent.click(optin)
    expect(useMcpStore.getState().securityRateLimitProbe).toBe(true)
    fireEvent.click(screen.getByTestId('mcp-security-scan'))
    expect(startSecurityScan).toHaveBeenCalledTimes(1)
  })

  it('Scan is disabled while running (Cancel + progress shown) and without a URL', () => {
    const cancelSecurityScan = vi.fn(async () => {})
    useMcpStore.setState({
      url: 'http://srv.test/mcp',
      securityRunning: true,
      securityScanId: 'scan-1',
      securityProgress: { done: 3, total: 29, current: 'TLS version and certificate' },
      securityFindings: [HTTPS],
      cancelSecurityScan,
    })
    const { unmount } = render(<McpSecuritySection />)
    expect(screen.getByTestId('mcp-security-scan')).toBeDisabled()
    expect(screen.getByTestId('mcp-security-ratelimit-optin')).toBeDisabled()
    expect(screen.getByTestId('mcp-security-progress')).toHaveTextContent('3 / 29 checks')
    // Streamed findings render before the report exists.
    expect(screen.getByTestId('mcp-security-finding-transport.https')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mcp-security-cancel'))
    expect(cancelSecurityScan).toHaveBeenCalledTimes(1)
    unmount()

    useMcpStore.setState({ url: '', securityRunning: false })
    render(<McpSecuritySection />)
    expect(screen.getByTestId('mcp-security-scan')).toBeDisabled()
    expect(screen.queryByTestId('mcp-security-cancel')).toBeNull()
  })

  it('stdio shows a hint instead of the scanner', () => {
    useMcpStore.setState({ transport: 'stdio', url: 'node s.js' })
    render(<McpSecuritySection />)
    expect(screen.queryByTestId('mcp-security-scan')).toBeNull()
    expect(screen.getByTestId('mcp-security-tab')).toHaveTextContent(/HTTP and SSE/)
  })

  it('renders the grade badge, categories and finding rows with expandable evidence', () => {
    useMcpStore.setState({ url: 'http://srv.test/mcp', securityReport: REPORT })
    render(<McpSecuritySection />)
    const grade = screen.getByTestId('mcp-security-grade')
    expect(grade).toHaveTextContent('C')
    expect(grade).toHaveAttribute('data-grade', 'C')
    expect(screen.getByTestId('mcp-security-summary')).toHaveTextContent('72/100')
    expect(screen.getByTestId('mcp-security-category-cors')).toHaveTextContent('1 failed')

    const row = screen.getByTestId('mcp-security-finding-cors.cors_wildcard_with_credentials')
    expect(row).toHaveAttribute('data-status', 'fail')
    expect(row).toHaveTextContent('CORS policy')
    expect(row).toHaveTextContent('high')
    expect(row).toHaveTextContent('Wildcard origin with credentials.')
    fireEvent.click(within(row).getByRole('button'))
    const details = screen.getByTestId(
      'mcp-security-finding-cors.cors_wildcard_with_credentials-details',
    )
    expect(details).toHaveTextContent('Send no CORS headers.')
    expect(details).toHaveTextContent('OPTIONS http://srv.test/mcp')
    expect(details).toHaveTextContent('authorization: Bearer ••••')
    expect(details).toHaveTextContent('access-control-allow-origin: *')
    expect(within(details).getByRole('link')).toHaveAttribute(
      'href',
      'https://fetch.spec.whatwg.org/#http-cors-protocol',
    )
    // An info row has no severity chip.
    expect(screen.getByTestId('mcp-security-finding-transport.https')).not.toHaveTextContent('high')
  })

  // Issue #152 — the summary names the protocol era the scan ran on.
  it('shows the protocol era line only when the report carries one', () => {
    useMcpStore.setState({ url: 'http://srv.test/mcp', securityReport: REPORT })
    const view = render(<McpSecuritySection />)
    expect(screen.queryByTestId('mcp-security-era')).toBeNull()
    view.unmount()
    useMcpStore.setState({
      securityReport: {
        ...REPORT,
        serverInfo: {
          ...REPORT.serverInfo!,
          protocolVersion: '2026-07-28',
          era: 'modern',
          supportedVersions: ['2026-07-28'],
        },
      },
    })
    render(<McpSecuritySection />)
    const era = screen.getByTestId('mcp-security-era')
    expect(era).toHaveAttribute('data-era', 'modern')
    expect(era).toHaveTextContent('Era: 2026-07-28 (modern)')
  })

  it('"Save HTML report…" renders through main and writes with the save-file bridge', async () => {
    const securityExportHtml = vi.fn(async () => ({
      success: true,
      data: { html: '<!DOCTYPE html><title>r</title>' },
    }))
    const saveFile = vi.fn(async () => ({ success: true, data: '/tmp/r.html' }))
    ;(window as unknown as { api: unknown }).api = {
      mcp: { securityExportHtml },
      importExport: { saveFile },
    }
    useMcpStore.setState({ url: 'http://srv.test/mcp', securityReport: REPORT })
    render(<McpSecuritySection />)
    fireEvent.click(screen.getByTestId('mcp-security-export'))
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    expect(securityExportHtml).toHaveBeenCalledWith(REPORT)
    const [html, name] = saveFile.mock.calls[0] as unknown as [string, string]
    expect(html).toContain('<!DOCTYPE html>')
    expect(name).toMatch(/^mcp-security-srv\.test-\d{8}-\d{4}\.html$/)
    await waitFor(() =>
      expect(screen.getByTestId('mcp-security-export-note')).toHaveTextContent('/tmp/r.html'),
    )
  })
})
