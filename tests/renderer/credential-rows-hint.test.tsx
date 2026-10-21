/**
 * Issues #244 / #247 — the restart hint under the key/value editors (HTTP
 * Headers / Params / form fields, WS / SSE / MCP headers, GraphQL headers,
 * gRPC metadata): before, it showed only under the Auth tabs, so an unsaved
 * draft's credential header value silently came back empty after a restart.
 * Shown only while a credential-named row holds a literal value.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { KeyValuePair } from '../../src/renderer/types'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import HeadersTab from '../../src/renderer/components/request/HeadersTab'
import ParamsTab from '../../src/renderer/components/request/ParamsTab'
import McpHeadersSection from '../../src/renderer/components/protocols/mcp/McpHeadersSection'
import CredentialRowsHint from '../../src/renderer/components/shared/CredentialRowsHint'

const kv = (key: string, value: string, extra: Partial<KeyValuePair> = {}): KeyValuePair => ({
  id: `${key}-id`,
  key,
  value,
  enabled: true,
  ...extra,
})

afterEach(() => {
  cleanup()
  useUIStore.setState({ locale: 'en' })
  setLocale('en')
})

describe('credential rows restart hint', () => {
  it('HTTP Headers: shown for a literal credential header, not for {{var}} or plain rows', () => {
    useRequestStore.setState({ headers: [kv('Accept', 'json'), kv('X-Api-Key', '{{key}}')] })
    const { rerender } = render(React.createElement(HeadersTab))
    expect(screen.queryByTestId('headers-credential-restart-hint')).toBeNull()

    useRequestStore.setState({ headers: [kv('Authorization', 'Bearer abc')] })
    rerender(React.createElement(HeadersTab))
    expect(screen.getByTestId('headers-credential-restart-hint').textContent).toMatch(
      /not kept after a restart unless the request is saved/,
    )
  })

  it('HTTP Params: the argument rule (api_key yes, author no)', () => {
    useRequestStore.setState({ params: [kv('author', 'bob')] })
    const { rerender } = render(React.createElement(ParamsTab))
    expect(screen.queryByTestId('params-credential-restart-hint')).toBeNull()
    useRequestStore.setState({ params: [kv('api_key', 'K1')] })
    rerender(React.createElement(ParamsTab))
    expect(screen.getByTestId('params-credential-restart-hint')).toBeTruthy()
  })

  it('MCP headers section', () => {
    useMcpStore.setState({ customHeaders: [kv('X-Gateway-Key', 'g1')] })
    render(React.createElement(McpHeadersSection))
    expect(screen.getByTestId('mcp-headers-restart-hint')).toBeTruthy()
  })

  it('a form-data file row is never a credential; an env URL value is', () => {
    const { rerender } = render(
      React.createElement(CredentialRowsHint, {
        rows: [kv('key', 'upload.bin', { type: 'file' })],
        testId: 'h',
      }),
    )
    expect(screen.queryByTestId('h')).toBeNull()
    rerender(
      React.createElement(CredentialRowsHint, {
        rows: [kv('DATABASE_URL', 'postgres://u:p@db/x')],
        testId: 'h',
        isCredentialValue: (v: string) => v.includes(':p@'),
      }),
    )
    expect(screen.getByTestId('h')).toBeTruthy()
  })

  it('TR: the example is the literal {{variable}} syntax', () => {
    useUIStore.setState({ locale: 'tr' })
    setLocale('tr')
    useRequestStore.setState({ headers: [kv('Authorization', 'Bearer abc')] })
    render(React.createElement(HeadersTab))
    const text = screen.getByTestId('headers-credential-restart-hint').textContent ?? ''
    expect(text).toMatch(/istek kaydedilmedikçe yeniden başlatmadan sonra korunmaz/)
    expect(text).toContain('{{variable}}')
    expect(text).not.toContain('{{değişken}}')
  })
})
