/**
 * src/shared/script/response.ts — createPmResponse: the full Postman response
 * surface plus the to.be.* / to.have.* assertion set, including to.not.*.
 */
import { describe, it, expect as vi } from 'vitest'
import { createPmResponse } from '../../../src/shared/script/response'
import type { NormalizedResponse } from '../../../src/shared/script/types'

function throws(fn: () => void): void {
  vi(fn).toThrow()
}
function passes(fn: () => void): void {
  vi(fn).not.toThrow()
}

const base: Omit<NormalizedResponse, 'code' | 'statusText' | 'body'> = {
  headers: {},
  cookies: [],
  responseTime: 10,
  responseSize: 0,
}

const r200: NormalizedResponse = {
  code: 200,
  statusText: 'OK',
  headers: { 'Content-Type': 'application/json', 'X-Trace': 'zzz' },
  body: '{"id":1,"name":"Ada","nested":{"deep":true},"list":[10,20]}',
  cookies: [
    { name: 'sid', value: 'abc' },
    { name: 'theme', value: 'dark' },
  ],
  responseTime: 42,
  responseSize: 60,
}
const r404: NormalizedResponse = { ...base, code: 404, statusText: 'Not Found', body: 'not found' }
const r500: NormalizedResponse = {
  ...base,
  code: 500,
  statusText: 'Internal Server Error',
  body: 'oops',
}
const r204: NormalizedResponse = { ...base, code: 204, statusText: 'No Content', body: '' }
const r401: NormalizedResponse = {
  ...base,
  code: 401,
  statusText: 'Unauthorized',
  body: '{"err":"no"}',
}
const rText: NormalizedResponse = {
  ...base,
  code: 200,
  statusText: 'OK',
  headers: { 'content-type': 'text/plain' },
  body: 'plain text body',
}

describe('createPmResponse — scalar surface (200 JSON)', () => {
  const res = createPmResponse(r200)
  it('code / status / reason', () => {
    vi(res.code).toBe(200)
    vi(res.status).toBe('OK')
    vi(res.reason()).toBe('OK')
  })
  it('text / body', () => {
    vi(res.text()).toBe(r200.body)
    vi(res.body).toBe(r200.body)
  })
  it('json / json reviver', () => {
    vi((res.json() as { id: number }).id).toBe(1)
    const upper = res.json((k, v) => (k === 'name' ? String(v).toUpperCase() : v)) as {
      name: string
    }
    vi(upper.name).toBe('ADA')
  })
  it('responseTime / responseSize', () => {
    vi(res.responseTime).toBe(42)
    vi(res.responseSize).toBe(60)
  })
  it('dataURI', () => {
    const uri = res.dataURI()
    vi(uri.startsWith('data:application/json;base64,')).toBe(true)
    // round-trip the base64 payload back to the original body
    const b64 = uri.split('base64,')[1]
    vi(Buffer.from(b64, 'base64').toString('utf-8')).toBe(r200.body)
  })
  it('size() body/header/total', () => {
    const s = res.size()
    vi(s.body).toBe(60)
    vi(s.total).toBe(s.body + s.header)
    vi(s.header).toBeGreaterThan(0)
  })
})

describe('createPmResponse — jsonp', () => {
  it('parses a callback-wrapped JSON payload', () => {
    const res = createPmResponse({ ...base, code: 200, statusText: 'OK', body: 'cb({"x":42})' })
    vi((res.jsonp() as { x: number }).x).toBe(42)
  })
  it('falls back to plain JSON when no wrapper', () => {
    const res = createPmResponse({ ...base, code: 200, statusText: 'OK', body: '{"y":7}' })
    vi((res.jsonp() as { y: number }).y).toBe(7)
  })
})

describe('createPmResponse — headers (case-insensitive)', () => {
  const res = createPmResponse(r200)
  it('get / has are case-insensitive', () => {
    vi(res.headers.get('content-type')).toBe('application/json')
    vi(res.headers.get('CONTENT-TYPE')).toBe('application/json')
    vi(res.headers.has('x-trace')).toBe(true)
    vi(res.headers.has('missing')).toBe(false)
    vi(res.headers.get('missing')).toBeUndefined()
  })
  it('all / toObject preserve original casing', () => {
    const all = res.headers.all()
    vi(all).toContainEqual({ key: 'Content-Type', value: 'application/json' })
    vi(res.headers.toObject()['X-Trace']).toBe('zzz')
  })
})

describe('createPmResponse — cookies', () => {
  const res = createPmResponse(r200)
  it('get / has / toObject', () => {
    vi(res.cookies.get('sid')).toBe('abc')
    vi(res.cookies.get('SID')).toBe('abc') // case-insensitive
    vi(res.cookies.has('theme')).toBe(true)
    vi(res.cookies.has('nope')).toBe(false)
    vi(res.cookies.get('nope')).toBeUndefined()
    vi(res.cookies.toObject()).toEqual({ sid: 'abc', theme: 'dark' })
  })
})

describe('createPmResponse — non-JSON body', () => {
  const res = createPmResponse(rText)
  it('text body present, json() throws', () => {
    vi(res.text()).toBe('plain text body')
    throws(() => res.json())
  })
  it('dataURI uses the actual content-type header', () => {
    vi(res.dataURI().startsWith('data:text/plain;base64,')).toBe(true)
  })
})

describe('to.have.status', () => {
  it('numeric form', () => {
    passes(() => createPmResponse(r200).to.have.status(200))
    throws(() => createPmResponse(r200).to.have.status(201))
  })
  it('reason form', () => {
    passes(() => createPmResponse(r200).to.have.status('OK'))
    throws(() => createPmResponse(r200).to.have.status('Created'))
  })
})

describe('to.have.statusCode / statusReason / statusCodeClass', () => {
  it('statusCode', () => {
    passes(() => createPmResponse(r404).to.have.statusCode(404))
    throws(() => createPmResponse(r404).to.have.statusCode(200))
  })
  it('statusReason', () => {
    passes(() => createPmResponse(r404).to.have.statusReason('Not Found'))
    throws(() => createPmResponse(r404).to.have.statusReason('OK'))
  })
  it('statusCodeClass', () => {
    passes(() => createPmResponse(r404).to.have.statusCodeClass(4))
    passes(() => createPmResponse(r200).to.have.statusCodeClass(2))
    throws(() => createPmResponse(r404).to.have.statusCodeClass(2))
  })
})

describe('to.have.header', () => {
  const res = createPmResponse(r200)
  it('presence-only', () => {
    passes(() => res.to.have.header('Content-Type'))
    passes(() => res.to.have.header('content-type')) // case-insensitive
    throws(() => res.to.have.header('Missing'))
  })
  it('with value', () => {
    passes(() => res.to.have.header('Content-Type', 'application/json'))
    throws(() => res.to.have.header('Content-Type', 'text/plain'))
  })
})

describe('to.have.body', () => {
  it('presence', () => {
    passes(() => createPmResponse(r200).to.have.body())
    throws(() => createPmResponse(r204).to.have.body())
  })
  it('exact string', () => {
    passes(() => createPmResponse(rText).to.have.body('plain text body'))
    throws(() => createPmResponse(rText).to.have.body('nope'))
  })
  it('regex', () => {
    passes(() => createPmResponse(rText).to.have.body(/plain/))
    throws(() => createPmResponse(rText).to.have.body(/\d{4}/))
  })
})

describe('to.have.jsonBody', () => {
  const res = createPmResponse(r200)
  it('no-arg (valid JSON passes, invalid throws)', () => {
    passes(() => res.to.have.jsonBody())
    throws(() => createPmResponse(rText).to.have.jsonBody())
  })
  it('path-only presence', () => {
    passes(() => res.to.have.jsonBody('id'))
    passes(() => res.to.have.jsonBody('$.nested.deep'))
    passes(() => res.to.have.jsonBody('list[1]'))
    throws(() => res.to.have.jsonBody('missing.path'))
  })
  it('path + value', () => {
    passes(() => res.to.have.jsonBody('id', 1))
    passes(() => res.to.have.jsonBody('nested.deep', true))
    passes(() => res.to.have.jsonBody('list[0]', 10))
    throws(() => res.to.have.jsonBody('id', 999))
  })
  it('full-object deep equal', () => {
    passes(() =>
      res.to.have.jsonBody({ id: 1, name: 'Ada', nested: { deep: true }, list: [10, 20] }),
    )
    throws(() => res.to.have.jsonBody({ id: 2 }))
  })
})

describe('to.have.jsonSchema', () => {
  const res = createPmResponse(r200)
  it('valid schema passes', () => {
    passes(() =>
      res.to.have.jsonSchema({
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
        required: ['id', 'name'],
      }),
    )
  })
  it('invalid schema throws', () => {
    throws(() =>
      res.to.have.jsonSchema({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      }),
    )
  })
  it('non-JSON body throws under schema validation', () => {
    throws(() => createPmResponse(rText).to.have.jsonSchema({ type: 'object' }))
  })
})

describe('to.have.responseTime / responseSize chains', () => {
  const res = createPmResponse(r200) // responseTime 42, size 60
  it('responseTime below/above/within', () => {
    passes(() => res.to.have.responseTime.below(100))
    passes(() => res.to.have.responseTime.above(10))
    passes(() => res.to.have.responseTime.within(10, 100))
    throws(() => res.to.have.responseTime.below(10))
  })
  it('responseSize below/above/within', () => {
    passes(() => res.to.have.responseSize.below(100))
    passes(() => res.to.have.responseSize.above(10))
    throws(() => res.to.have.responseSize.above(100))
  })
})

describe('to.be.* status class', () => {
  it('info / success / redirection / clientError / serverError / error', () => {
    passes(
      () => createPmResponse({ ...base, code: 100, statusText: 'Continue', body: '' }).to.be.info,
    )
    passes(() => createPmResponse(r200).to.be.success)
    passes(
      () =>
        createPmResponse({ ...base, code: 301, statusText: 'Moved Permanently', body: '' }).to.be
          .redirection,
    )
    passes(() => createPmResponse(r404).to.be.clientError)
    passes(() => createPmResponse(r500).to.be.serverError)
    passes(() => createPmResponse(r404).to.be.error)
    passes(() => createPmResponse(r500).to.be.error)
    throws(() => createPmResponse(r200).to.be.error)
    throws(() => createPmResponse(r200).to.be.clientError)
  })
})

describe('to.be.* named codes', () => {
  it('ok / accepted / withoutContent', () => {
    passes(() => createPmResponse(r200).to.be.ok)
    passes(
      () =>
        createPmResponse({ ...base, code: 202, statusText: 'Accepted', body: '' }).to.be.accepted,
    )
    passes(() => createPmResponse(r204).to.be.withoutContent)
    throws(() => createPmResponse(r404).to.be.ok)
  })
  it('badRequest / unauthorized / unauthorised / forbidden / notFound / notAcceptable / rateLimited', () => {
    passes(
      () =>
        createPmResponse({ ...base, code: 400, statusText: 'Bad Request', body: '' }).to.be
          .badRequest,
    )
    passes(() => createPmResponse(r401).to.be.unauthorized)
    passes(() => createPmResponse(r401).to.be.unauthorised)
    passes(
      () =>
        createPmResponse({ ...base, code: 403, statusText: 'Forbidden', body: '' }).to.be.forbidden,
    )
    passes(() => createPmResponse(r404).to.be.notFound)
    passes(
      () =>
        createPmResponse({ ...base, code: 406, statusText: 'Not Acceptable', body: '' }).to.be
          .notAcceptable,
    )
    passes(
      () =>
        createPmResponse({ ...base, code: 429, statusText: 'Too Many Requests', body: '' }).to.be
          .rateLimited,
    )
    throws(() => createPmResponse(r200).to.be.notFound)
  })
  it('withBody / json', () => {
    passes(() => createPmResponse(r200).to.be.withBody)
    throws(() => createPmResponse(r204).to.be.withBody)
    passes(() => createPmResponse(r200).to.be.json)
    throws(() => createPmResponse(rText).to.be.json)
  })
})

describe('edge cases — jsonBody / body / reason', () => {
  it('jsonPath finds keys whose value is null or 0 (uses `in`, not truthiness)', () => {
    const res = createPmResponse({
      ...base,
      code: 200,
      statusText: 'OK',
      body: '{"a":null,"b":{"c":0}}',
    })
    passes(() => res.to.have.jsonBody('a')) // present even though value is null
    passes(() => res.to.have.jsonBody('b.c', 0)) // matches the falsy 0 value
  })
  it("jsonPath does NOT support bracket-string notation $['key'] (dot/index only)", () => {
    const res = createPmResponse({ ...base, code: 200, statusText: 'OK', body: '{"a":1}' })
    passes(() => res.to.have.jsonBody('a')) // dot form works
    passes(() => res.to.have.jsonBody('$.a')) // leading $. stripped
    throws(() => res.to.have.jsonBody("$['a']")) // bracket-string unsupported by design
  })
  it('body(exactString) is a strict equality, not a substring/contains check', () => {
    const res = createPmResponse({ ...base, code: 200, statusText: 'OK', body: 'hello world' })
    passes(() => res.to.have.body('hello world'))
    throws(() => res.to.have.body('hello')) // substring is NOT a match
    throws(() => res.to.have.body('')) // empty string only matches an empty body
  })
  it('reason() falls back to the canonical phrase when statusText is empty', () => {
    const res = createPmResponse({ ...base, code: 200, statusText: '', body: '' })
    vi(res.reason()).toBe('OK')
    // status(reason) also accepts the canonical phrase via the REASON fallback
    passes(() => res.to.have.status('OK'))
  })
  it('to.not.have.jsonBody() passes when the body is not valid JSON', () => {
    const res = createPmResponse({ ...base, code: 200, statusText: 'OK', body: 'not json' })
    passes(() => res.to.not.have.jsonBody())
  })
})

describe('to.not.* (passes when condition false, throws when true)', () => {
  const res = createPmResponse(r200)
  it('not.have.status', () => {
    passes(() => res.to.not.have.status(404))
    throws(() => res.to.not.have.status(200))
  })
  it('not.have.statusCode / header', () => {
    passes(() => res.to.not.have.statusCode(500))
    throws(() => res.to.not.have.statusCode(200))
    passes(() => res.to.not.have.header('Missing'))
    throws(() => res.to.not.have.header('Content-Type'))
  })
  it('not.have.jsonBody path/value', () => {
    passes(() => res.to.not.have.jsonBody('missing.path'))
    throws(() => res.to.not.have.jsonBody('id'))
    passes(() => res.to.not.have.jsonBody('id', 999))
    throws(() => res.to.not.have.jsonBody('id', 1))
  })
  it('not.be.* class + named', () => {
    passes(() => res.to.not.be.error)
    throws(() => res.to.not.be.success)
    passes(() => res.to.not.be.notFound)
    throws(() => res.to.not.be.ok)
  })
})
