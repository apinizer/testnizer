/**
 * src/shared/script/require.ts (sandboxRequire + scriptGlobals) and
 * src/shared/script/base64.ts (base64Encode/Decode).
 */
import { describe, it, expect as vi } from 'vitest'
import { sandboxRequire, scriptGlobals } from '../../../src/shared/script/require'
import { base64Encode, base64Decode } from '../../../src/shared/script/base64'

describe('sandboxRequire — each library resolves & smoke-works', () => {
  it('lodash', () => {
    const _ = sandboxRequire('lodash') as typeof import('lodash')
    vi(_.chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })
  it('moment', () => {
    const moment = sandboxRequire('moment') as typeof import('moment')
    vi(moment().isValid()).toBe(true)
  })
  it('uuid.v4', () => {
    const uuid = sandboxRequire('uuid') as typeof import('uuid')
    const id = uuid.v4()
    vi(typeof id).toBe('string')
    vi(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
  it('crypto-js', () => {
    const CryptoJS = sandboxRequire('crypto-js') as typeof import('crypto-js')
    vi(CryptoJS.SHA256('x').toString()).toHaveLength(64)
  })
  it('cheerio', () => {
    const cheerio = sandboxRequire('cheerio') as typeof import('cheerio')
    vi(cheerio.load('<p>x</p>')('p').text()).toBe('x')
  })
  it('ajv', () => {
    const Ajv = sandboxRequire('ajv') as typeof import('ajv').default
    const validate = new Ajv().compile({ type: 'string' })
    vi(validate('hi')).toBe(true)
    vi(validate(5)).toBe(false)
  })
  it('tv4', () => {
    const tv4 = sandboxRequire('tv4') as typeof import('tv4')
    vi(tv4.validate('x', { type: 'string' })).toBe(true)
    vi(tv4.validate(5, { type: 'string' })).toBe(false)
  })
  it('xml2js', () => {
    const xml2js = sandboxRequire('xml2js')
    vi(xml2js).toBeTruthy()
    vi(typeof (xml2js as { parseString: unknown }).parseString).toBe('function')
  })
  it('csv-parse/lib/sync (Postman v4 path)', () => {
    const parse = sandboxRequire('csv-parse/lib/sync') as (s: string, o: object) => unknown
    vi(parse('a,b\n1,2', { columns: true })).toEqual([{ a: '1', b: '2' }])
  })
  it('csv-parse/sync (v5 path) exposes { parse }', () => {
    const mod = sandboxRequire('csv-parse/sync') as { parse: (s: string, o: object) => unknown }
    vi(mod.parse('a,b\n1,2', { columns: true })).toEqual([{ a: '1', b: '2' }])
  })
  it('postman-collection has Url & Header', () => {
    const pc = sandboxRequire('postman-collection') as { Url: unknown; Header: unknown }
    vi(typeof pc.Url).toBe('function')
    vi(typeof pc.Header).toBe('function')
  })
  it('chai resolves', () => {
    const chai = sandboxRequire('chai') as { expect: unknown }
    vi(typeof chai.expect).toBe('function')
  })
  it('unknown module name throws a helpful error', () => {
    vi(() => sandboxRequire('definitely-not-a-real-module')).toThrow(/Cannot find module/)
    vi(() => sandboxRequire('definitely-not-a-real-module')).toThrow(/Supported:/)
  })
})

describe('scriptGlobals', () => {
  it('exposes CryptoJS, _, atob, btoa', () => {
    vi(scriptGlobals.CryptoJS).toBeTruthy()
    vi(scriptGlobals._).toBeTruthy()
    vi(typeof scriptGlobals.atob).toBe('function')
    vi(typeof scriptGlobals.btoa).toBe('function')
  })
  it('atob/btoa round-trip a UTF-8 string', () => {
    const original = 'héllo→世界'
    const encoded = scriptGlobals.btoa(original)
    vi(scriptGlobals.atob(encoded)).toBe(original)
  })
  it('_ is the same lodash sandboxRequire returns', () => {
    vi(scriptGlobals._).toBe(sandboxRequire('lodash'))
  })
})

describe('base64Encode / base64Decode', () => {
  it('ASCII round-trip', () => {
    const s = 'Hello, World!'
    vi(base64Decode(base64Encode(s))).toBe(s)
  })
  it('UTF-8 round-trip (multibyte)', () => {
    const s = 'héllo→世界 — Ωμέγα'
    vi(base64Decode(base64Encode(s))).toBe(s)
  })
  it('encodes to a known value (matches Node Buffer)', () => {
    vi(base64Encode('Testnizer')).toBe(Buffer.from('Testnizer', 'utf-8').toString('base64'))
  })
})
