/**
 * Issue #247 (follow-up) —
 *   - the MCP URL / stdio command line shows the restart hint while it holds
 *     a literal credential (`--token …`, `?api_key=…`, `user:pass@`);
 *   - no Turkish string shows a translated placeholder: `{{değişken}}` typed
 *     as shown resolves nothing, the example is the literal `{{variable}}`.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import McpConnectionBar from '../../src/renderer/components/protocols/mcp/McpConnectionBar'

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

describe('MCP URL / command line restart hint', () => {
  const cases: Array<[string, 'http' | 'stdio', string, boolean]> = [
    ['http URL with ?api_key=', 'http', 'https://mcp.test/mcp?api_key=K1', true],
    ['http URL with user:pass@', 'http', 'https://u:p@mcp.test/mcp', true],
    ['http URL with {{var}} only', 'http', 'https://mcp.test/mcp?api_key={{key}}', false],
    ['stdio --token', 'stdio', 'npx -y srv --token abc', true],
    ['stdio without credentials', 'stdio', 'npx -y srv --port 1', false],
  ]
  for (const [name, transport, url, shown] of cases) {
    it(`${name}: ${shown ? 'shown' : 'hidden'}`, () => {
      useMcpStore.setState({ transport, url, connectionState: 'disconnected' })
      render(React.createElement(McpConnectionBar))
      const hint = screen.queryByTestId('mcp-url-restart-hint')
      if (shown) expect(hint?.textContent).toMatch(/not kept after a restart/)
      else expect(hint).toBeNull()
    })
  }
})

describe('Turkish strings keep the literal {{variable}} syntax', () => {
  it('no translated placeholder anywhere in the dictionary', () => {
    const src = readFileSync(resolve(__dirname, '../../src/renderer/lib/i18n.ts'), 'utf8')
    expect(src).not.toContain('{{değişken}}')
  })

  it('the AI Chat hints say {{variable}} in Turkish', () => {
    setLocale('tr')
    for (const key of [
      'aiChat.inputHint',
      'aiChat.headersHint',
      'aiChat.headersSessionOnly',
      'aiChat.keyStoredHint',
      'aiChat.tools.sessionOnly',
    ]) {
      expect(t(key), key).toContain('{{variable}}')
    }
  })
})
