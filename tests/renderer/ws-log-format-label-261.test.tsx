/**
 * Issue #261 — the WebSocket message log showed the lower-case format label
 * "json" (the raw `contentType` value). The badge only LOOKED upper-case
 * through CSS; the text itself, and the Info tooltip ("Type: json" /
 * "Tür: json"), were the raw value.
 *
 * CONTRACT:
 *   - `lib/realtime-format.ts` exports `messageFormatLabel(contentType, t)`
 *     = `t('rt.format.<contentType>')` (keys already exist: Text/Metin, JSON,
 *     XML, HTML, Binary/İkili, Base64, Hexadecimal/Onaltılık), the raw value
 *     upper-cased for an unknown type;
 *   - `RealtimeLogRow`'s badge span gets `data-testid="<prefix>-row-badge"`
 *     (`ws-row-badge`); WsMessageLog passes the label for `badge` and
 *     `typeLabel`, so the badge text AND the Info title use it;
 *   - Socket.IO / MQTT share the row: MQTT's `typeLabel={r.contentType}` has
 *     the same raw-value problem and should use the same helper.
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

import WsMessageLog from '../../src/renderer/components/protocols/WsMessageLog'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import * as realtimeFormat from '../../src/renderer/lib/realtime-format'
import { t } from '../../src/renderer/lib/i18n'
import { useLocale } from './helpers/default-locale-shim'

afterEach(() => {
  cleanup()
  useLocale('en')
  useWebSocketStore.setState({ messages: [] })
})

function show(): HTMLElement[] {
  useWebSocketStore.setState({
    messages: [
      { id: '1', direction: 'sent', content: '{"a":1}', contentType: 'json', timestamp: 1 },
      { id: '2', direction: 'received', content: 'hi', contentType: 'text', timestamp: 2 },
      { id: '3', direction: 'received', content: 'AP8=', contentType: 'binary', timestamp: 3 },
    ],
  })
  render(<WsMessageLog />)
  return screen.getAllByTestId('ws-message')
}

const badge = (row: HTMLElement): string =>
  within(row).getByTestId('ws-row-badge').textContent ?? ''
const info = (row: HTMLElement): string =>
  within(row).getByTestId('ws-row-info').getAttribute('title') ?? ''

describe('WebSocket message log format label', () => {
  it('EN: "JSON", "Text", "Binary" — in the badge text and in the Info tooltip', () => {
    useLocale('en')
    const [json, text, binary] = show()
    expect(badge(json)).toBe('JSON')
    expect(badge(text)).toBe('Text')
    expect(badge(binary)).toBe('Binary')
    expect(info(json)).toContain('Type: JSON')
    expect(info(json)).not.toContain('json')
    expect(info(text)).toContain('Type: Text')
  })

  it('TR: "JSON", "Metin", "İkili" — never the raw lower-case value', () => {
    useLocale('tr')
    const [json, text, binary] = show()
    expect(badge(json)).toBe('JSON')
    expect(badge(text)).toBe('Metin')
    expect(badge(binary)).toBe('İkili')
    expect(info(json)).toContain('Tür: JSON')
    expect(info(json)).not.toContain('json')
    expect(info(text)).toContain('Tür: Metin')
    expect(document.body.textContent).not.toMatch(/\bjson\b/)
  })

  it('messageFormatLabel maps the content type through rt.format.*', () => {
    const fn = (
      realtimeFormat as unknown as {
        messageFormatLabel?: (c: string, tr: (k: string) => string) => string
      }
    ).messageFormatLabel
    expect(fn, 'realtime-format.ts must export messageFormatLabel').toBeTypeOf('function')
    useLocale('tr')
    expect(fn!('json', t)).toBe('JSON')
    expect(fn!('text', t)).toBe('Metin')
    expect(fn!('hex', t)).toBe(t('rt.format.hex'))
    expect(fn!('weird', t)).toBe('WEIRD')
  })
})
