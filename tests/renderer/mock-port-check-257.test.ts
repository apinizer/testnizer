/**
 * Issue #257 (item: Mock port field validates as you type) — the pure rule.
 *
 * CONTRACT — new module `src/renderer/components/mock/mock-port.ts`:
 *
 *   export const PRIVILEGED_PORT_BELOW = 1024
 *   export type PortCheck =
 *     | { ok: true; port: number; privileged: boolean }
 *     | { ok: false; reason: 'empty' | 'notNumber' | 'range' }
 *   export function checkMockPort(raw: string): PortCheck
 *
 * Rules: the input is trimmed; empty/blank -> 'empty'; anything that is not
 * ASCII digits only (letters, '-', '+', '.', exponent, full-width digits) ->
 * 'notNumber'; digits that parse to 0 or > 65535 -> 'range'; leading zeros are
 * fine ('08080' -> 8080); privileged = port < 1024.
 *
 * Red now: the module does not exist (the dialog validates only on submit).
 */
import { describe, expect, it } from 'vitest'
import { checkMockPort, PRIVILEGED_PORT_BELOW } from '../../src/renderer/components/mock/mock-port'

describe('checkMockPort', () => {
  it('accepts a normal port', () => {
    expect(checkMockPort('3001')).toEqual({ ok: true, port: 3001, privileged: false })
  })

  it('trims whitespace', () => {
    expect(checkMockPort(' 80 ')).toEqual({ ok: true, port: 80, privileged: true })
  })

  it('accepts leading zeros as the number they spell', () => {
    expect(checkMockPort('08080')).toEqual({ ok: true, port: 8080, privileged: false })
  })

  it('boundaries: 1 and 65535 are valid, 0 and 65536 are a range error', () => {
    expect(checkMockPort('1')).toMatchObject({ ok: true, port: 1 })
    expect(checkMockPort('65535')).toMatchObject({ ok: true, port: 65535 })
    expect(checkMockPort('0')).toEqual({ ok: false, reason: 'range' })
    expect(checkMockPort('65536')).toEqual({ ok: false, reason: 'range' })
    expect(checkMockPort('99999999999999999999')).toEqual({ ok: false, reason: 'range' })
  })

  it('privileged exactly below 1024', () => {
    expect(PRIVILEGED_PORT_BELOW).toBe(1024)
    expect(checkMockPort('1023')).toMatchObject({ ok: true, privileged: true })
    expect(checkMockPort('1024')).toMatchObject({ ok: true, privileged: false })
  })

  it('empty or blank', () => {
    expect(checkMockPort('')).toEqual({ ok: false, reason: 'empty' })
    expect(checkMockPort('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('not a number', () => {
    for (const raw of ['abc', '30a0', '-1', '+80', '3000.5', '1e3', '0x50', '８０８０', '80 80']) {
      expect(checkMockPort(raw), raw).toEqual({ ok: false, reason: 'notNumber' })
    }
  })
})
