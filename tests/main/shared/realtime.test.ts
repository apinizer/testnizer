/**
 * `src/shared/realtime.ts` (issues #282 / #283): the binary codecs main and
 * the renderer both use, the hexdump view, and the settings reader that makes
 * an old saved request connect with the pre-settings behaviour.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIO_SETTINGS,
  DEFAULT_WS_SETTINGS,
  bytesFromBase64,
  bytesFromHex,
  bytesToBase64,
  hexdump,
  maxPayloadBytes,
  readSioSettings,
  readWsSettings,
  utf8Length,
} from '../../../src/shared/realtime'

describe('binary codecs', () => {
  it('hex: separators and 0x allowed, odd / non-hex refused', () => {
    expect(bytesFromHex('de:ad 0xbe,ef')).toEqual({
      ok: true,
      bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    })
    expect(bytesFromHex('abc').ok).toBe(false)
    expect(bytesFromHex('zz').ok).toBe(false)
  })

  it('base64: standard and URL-safe, padding optional, garbage refused; round-trips', () => {
    for (const b of [
      new Uint8Array([]),
      new Uint8Array([1]),
      new Uint8Array([1, 2]),
      new Uint8Array([0, 255, 128, 7]),
    ]) {
      const enc = bytesToBase64(b)
      expect(enc).toBe(Buffer.from(b).toString('base64'))
      expect(bytesFromBase64(enc)).toEqual({ ok: true, bytes: b })
    }
    expect(bytesFromBase64('-_8')).toEqual({ ok: true, bytes: new Uint8Array([0xfb, 0xff]) })
    expect(bytesFromBase64('a').ok).toBe(false)
    expect(bytesFromBase64('ab$c').ok).toBe(false)
  })

  it('hexdump: offset, two hex columns, printable ASCII', () => {
    const line = hexdump(new TextEncoder().encode('Hello, WebSocket!'))
    expect(line.split('\n')[0]).toBe(
      '00000000  48 65 6c 6c 6f 2c 20 57  65 62 53 6f 63 6b 65 74  |Hello, WebSocket|',
    )
    expect(line.split('\n')[1]).toMatch(/^00000010  21/)
  })

  it('utf8Length counts bytes, not UTF-16 units', () => {
    expect(utf8Length('aç😀')).toBe(1 + 2 + 4)
  })
})

describe('settings readers', () => {
  it('missing settings = the behaviour before settings existed', () => {
    expect(readWsSettings(undefined)).toEqual(DEFAULT_WS_SETTINGS)
    expect(readSioSettings(null)).toEqual(DEFAULT_SIO_SETTINGS)
    expect(maxPayloadBytes(DEFAULT_WS_SETTINGS.maxPayload)).toBe(100 * 1024 * 1024)
    expect(maxPayloadBytes(0)).toBe(0)
  })

  it('clamps out-of-range and junk values', () => {
    expect(
      readWsSettings({ retryCount: -3, handshakeTimeout: 'x', maxPayload: 1e9 }),
    ).toMatchObject({
      retryCount: 0,
      handshakeTimeout: DEFAULT_WS_SETTINGS.handshakeTimeout,
      maxPayload: 4096,
    })
    expect(
      readSioSettings({ version: '9', transport: 'carrier-pigeon', path: '  ' }),
    ).toMatchObject({
      version: '4',
      transport: 'auto',
      path: '/socket.io',
    })
  })
})
