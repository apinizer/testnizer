/**
 * Issue #261 — the SSE tab tooltip "Server-Sent Events" was hard-coded in
 * lib/protocol-chip.ts.
 *
 * CONTRACT:
 *   - i18n key `protocolChip.name.sse` (EN "Server-Sent Events", TR a Turkish
 *     phrase that differs from it);
 *   - `lib/protocol-chip.ts` exports `protocolChipName(protocol): string | null`
 *     — the localized full name (SSE via the key, every other protocol keeps
 *     its proper name: MCP, WebSocket, Socket.IO, MQTT, GraphQL, gRPC,
 *     AI Chat), evaluated at CALL time; `protocolChip(...).name` may stay as
 *     the English fallback;
 *   - `ProtocolChip` (title attribute; subscribes to the locale so a switch
 *     updates it) and `CodegenUnavailable` (title text) use it.
 */
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import ProtocolChip from '../../src/renderer/components/shared/ProtocolChip'
import CodegenUnavailable from '../../src/renderer/components/shared/CodegenUnavailable'
import * as chipLib from '../../src/renderer/lib/protocol-chip'
import { t } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'

afterEach(() => {
  cleanup()
  useLocale('en')
})

const EN = 'Server-Sent Events'

describe('SSE chip tooltip', () => {
  it('the key exists in both languages and the TR text is not the English phrase', () => {
    useLocale('en')
    expect(t('protocolChip.name.sse')).toBe(EN)
    useLocale('tr')
    const tr = t('protocolChip.name.sse')
    expect(tr).not.toBe('protocolChip.name.sse')
    expect(tr).not.toBe(EN)
    expect(tr).not.toMatch(/Server|Sent|Events/)
  })

  it('TR: ProtocolChip title is Turkish; EN unchanged; follows a locale switch', () => {
    useLocale('en')
    render(<ProtocolChip protocol="sse" />)
    expect(screen.getByTestId('protocol-chip').getAttribute('title')).toBe(EN)
    act(() => useLocale('tr'))
    const title = screen.getByTestId('protocol-chip').getAttribute('title')
    expect(title).toBe(t('protocolChip.name.sse'))
    expect(title).not.toBe(EN)
  })

  it('TR: the tab chip (title variant) is localized as well', () => {
    useLocale('tr')
    render(<ProtocolChip protocol="sse" title="Events" />)
    expect(screen.getByTestId('protocol-chip').getAttribute('title')).not.toBe(EN)
  })

  it('protocolChipName: localized for SSE, proper names untouched, null when not a chip', () => {
    const fn = (chipLib as unknown as { protocolChipName?: (p: string) => string | null })
      .protocolChipName
    expect(fn, 'protocol-chip.ts must export protocolChipName').toBeTypeOf('function')
    useLocale('tr')
    expect(fn!('sse')).toBe(t('protocolChip.name.sse'))
    expect(fn!('websocket')).toBe('WebSocket')
    expect(fn!('graphql')).toBe('GraphQL')
    expect(fn!('http')).toBeNull()
    useLocale('en')
    expect(fn!('sse')).toBe(EN)
  })

  it('Generate Code on an SSE tab names the protocol in the UI language', () => {
    useLocale('tr')
    render(<CodegenUnavailable protocol="sse" />)
    const text = screen.getByTestId('codegen-unavailable').textContent ?? ''
    expect(text).not.toContain(EN)
    expect(text).toContain(t('protocolChip.name.sse'))
    cleanup()
    useLocale('en')
    render(<CodegenUnavailable protocol="sse" />)
    expect(screen.getByTestId('codegen-unavailable').textContent).toContain(EN)
  })
})
