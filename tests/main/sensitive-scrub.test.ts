/**
 * Issues #195 / #196 — the ONE main-side mask (`src/main/lib/sensitive-scrub.ts`)
 * every History row, Runner result / export and Console entry goes through.
 * Pure: no DB, no electron.
 */
import { describe, expect, it } from 'vitest'
import {
  HISTORY_MASK,
  MIN_SECRET_LENGTH,
  authSecretValues,
  createScrubber,
  loadSecretInventory,
  maskBodyText,
  maskConsoleEntry,
  maskHistoryRequestSnapshot,
  maskHistoryResponseSnapshot,
  maskHistoryRow,
  maskRunResult,
  maskUrlText,
} from '../../src/main/lib/sensitive-scrub'
import type { EndpointRunResult } from '../../src/shared/runner-types'

const SECRET = 's3cr3t-T0ken-value'
const scrub = createScrubber([SECRET])

describe('value scrub', () => {
  it('replaces a secret value anywhere, in raw, URL-encoded and JSON-escaped form', () => {
    const tricky = 'p@ss w/"quote"'
    const s = createScrubber([tricky])
    expect(s.text(`a ${tricky} b`)).toBe(`a ${HISTORY_MASK} b`)
    expect(s.text(`?q=${encodeURIComponent(tricky)}`)).toBe(`?q=${HISTORY_MASK}`)
    expect(s.text(JSON.stringify({ x: tricky }))).toBe(`{"x":"${HISTORY_MASK}"}`)
  })

  it(`ignores values shorter than ${MIN_SECRET_LENGTH} characters`, () => {
    const s = createScrubber(['true', '1', 'abc12'])
    expect(s.needles).toEqual([])
    expect(s.text('true 1 abc12')).toBe('true 1 abc12')
  })

  it('ignores non-strings', () => {
    expect(createScrubber([null, undefined, 42, {}]).needles).toEqual([])
  })
})

describe('name rule', () => {
  it('masks credential-named query params, keeps ordinary ones', () => {
    expect(
      maskUrlText('https://h/x?api_key=abc123xyz&page=2&keyword=cats', createScrubber([])),
    ).toBe(`https://h/x?api_key=${HISTORY_MASK}&page=2&keyword=cats`)
  })

  it('template mode keeps {{var}} references, masks literals', () => {
    const none = createScrubber([])
    expect(maskUrlText('https://h/?api_key={{key}}&token=lit', none, 'template')).toBe(
      `https://h/?api_key={{key}}&token=${HISTORY_MASK}`,
    )
  })

  it('masks credential-named JSON, XML and form fields in a body without reformatting', () => {
    const none = createScrubber([])
    expect(maskBodyText('{\n  "user": "bob",\n  "password": "hunter22"\n}', none)).toBe(
      `{\n  "user": "bob",\n  "password": "${HISTORY_MASK}"\n}`,
    )
    expect(
      maskBodyText(
        '<wsse:Username>bob</wsse:Username><wsse:Password Type="x">pw</wsse:Password>',
        none,
      ),
    ).toBe(
      `<wsse:Username>bob</wsse:Username><wsse:Password Type="x">${HISTORY_MASK}</wsse:Password>`,
    )
    expect(maskBodyText('grant_type=password&client_secret=abc&scope=read', none)).toBe(
      `grant_type=password&client_secret=${HISTORY_MASK}&scope=read`,
    )
  })

  it('auth secrets per type — including apiKey.value, which has no credential-looking name', () => {
    expect(
      authSecretValues({
        type: 'apikey',
        apiKey: { key: 'X-App', value: 'apikeyvalue', in: 'header' },
        bearer: { token: 'bearer-tok' },
        basic: { username: 'u', password: 'pw-basic' },
        oauth2: { tokenUrl: 'https://as/token', clientSecret: 'cs', token: 'at' },
      }).sort(),
    ).toEqual(['apikeyvalue', 'at', 'bearer-tok', 'cs', 'pw-basic'].sort())
  })
})

describe('History snapshot', () => {
  const snapshot = JSON.stringify({
    method: 'POST',
    url: `https://api.test/items?api_key=${SECRET}&page=1`,
    params: [{ key: 'api_key', value: SECRET, enabled: true }],
    headers: [
      { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
      { key: 'X-API-Key', value: 'literal-key-123', enabled: true },
      { key: 'Accept', value: 'application/json', enabled: true },
    ],
    body: { type: 'json', content: `{"note":"contains ${SECRET}"}` },
    auth: { type: 'bearer', bearer: { token: SECRET } },
    configured: {
      method: 'POST',
      url: 'https://api.test/items?api_key={{secret}}&page=1',
      params: [{ key: 'api_key', value: '{{secret}}', enabled: true }],
      headers: [
        { key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
        { key: 'X-API-Key', value: 'literal-key-123', enabled: true },
      ],
      body: { type: 'json', content: '{"note":"contains {{secret}}"}' },
      auth: { type: 'bearer', bearer: { token: '{{secret}}' } },
    },
  })

  it('the sent copy holds no secret and no literal credential', () => {
    const out = maskHistoryRequestSnapshot(snapshot, scrub)
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('literal-key-123')
    const parsed = JSON.parse(out)
    expect(parsed.headers[2].value).toBe('application/json')
    expect(parsed.url).toBe(`https://api.test/items?api_key=${HISTORY_MASK}&page=1`)
  })

  it('the template keeps every {{var}} reference so re-send resolves it again', () => {
    const parsed = JSON.parse(maskHistoryRequestSnapshot(snapshot, scrub))
    expect(parsed.configured.url).toBe('https://api.test/items?api_key={{secret}}&page=1')
    expect(parsed.configured.headers[0].value).toBe('Bearer {{secret}}')
    expect(parsed.configured.auth.bearer.token).toBe('{{secret}}')
    expect(parsed.configured.params[0].value).toBe('{{secret}}')
    // A literal credential has no variable to resolve — it is masked.
    expect(parsed.configured.headers[1].value).toBe(HISTORY_MASK)
  })

  it('template body: one rule with headers — a literal credential field is masked, {{var}} kept', () => {
    const parsed = JSON.parse(
      maskHistoryRequestSnapshot(
        JSON.stringify({
          configured: {
            body: {
              type: 'json',
              content: '{"username":"bob","password":"hunter22","apiKey":"{{key}}"}',
            },
          },
        }),
        createScrubber([]),
      ),
    )
    expect(parsed.configured.body.content).toBe(
      `{"username":"bob","password":"${HISTORY_MASK}","apiKey":"{{key}}"}`,
    )
  })

  it('response headers by name, response body by value', () => {
    const out = maskHistoryResponseSnapshot(
      JSON.stringify({
        status: 200,
        headers: { 'set-cookie': 'sid=abcdef', 'content-type': 'application/json' },
        body: `{"echo":"Bearer ${SECRET}","token_type":"bearer"}`,
      }),
      scrub,
    )!
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('sid=abcdef')
    expect(JSON.parse(out).headers['content-type']).toBe('application/json')
    expect(JSON.parse(out).body).toContain('"token_type":"bearer"')
  })

  it('an unparseable snapshot is value-scrubbed as text', () => {
    expect(maskHistoryRequestSnapshot(`not json ${SECRET}`, scrub)).toBe(`not json ${HISTORY_MASK}`)
  })
})

describe('Console entry + Runner result', () => {
  it('masks every surface of a Console entry', () => {
    const e = maskConsoleEntry(
      {
        url: `https://h/?api_key=${SECRET}`,
        message: `GET https://h/?token=abc123 → 200`,
        details: {
          requestHeaders: { Authorization: `Bearer ${SECRET}`, 'X-API-Key': 'lit' },
          requestBody: `{"password":"pw","q":"${SECRET}"}`,
          responseHeaders: { 'Set-Cookie': 'sid=1' },
          responseBody: `echo ${SECRET}`,
          error: { message: `failed with ${SECRET}` },
        },
      },
      scrub,
    )
    const text = JSON.stringify(e)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('abc123')
    expect(e.details?.requestHeaders?.['X-API-Key']).toBe(HISTORY_MASK)
    expect(e.details?.responseHeaders?.['Set-Cookie']).toBe(HISTORY_MASK)
  })

  it('masks script console lines on a renderer-built entry', () => {
    const e = maskConsoleEntry(
      { scriptLogs: [{ level: 'log', message: `token is ${SECRET}`, timestamp: 1 }] },
      scrub,
    )
    expect(e.scriptLogs?.[0].message).toBe(`token is ${HISTORY_MASK}`)
  })

  it('masks a Runner step result', () => {
    const r: EndpointRunResult = {
      endpointId: 'e',
      endpointName: 'n',
      method: 'GET',
      url: `https://h/?api_key=${SECRET}`,
      status: 200,
      statusText: 'OK',
      duration: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      assertions: [{ name: 'body has token', passed: true, actual: SECRET }],
      requestHeaders: { 'x-api-key': 'literal-key-123' },
      requestBody: `{"v":"${SECRET}"}`,
      responseBody: `{"echo":"${SECRET}"}`,
      consoleLogs: [{ level: 'log', message: `token is ${SECRET}`, timestamp: 1 }],
    }
    const out = JSON.stringify(maskRunResult(r, scrub))
    expect(out).not.toContain(SECRET)
    expect(out).not.toContain('literal-key-123')
  })
})

describe('loadSecretInventory', () => {
  it('reads value + initial_value of secret rows, and never throws', () => {
    const db = {
      prepare: () => ({
        all: () => [{ key: 'token', value: 'cur-value-1', initial_value: 'init-value-1' }],
      }),
    }
    const inv = loadSecretInventory(db)
    expect(inv.values).toEqual(['cur-value-1', 'init-value-1'])
    expect([...inv.keys]).toEqual(['token'])
    const broken = {
      prepare: () => {
        throw new Error('no such table')
      },
    }
    expect(loadSecretInventory(broken).values).toEqual([])
    expect(loadSecretInventory(null).values).toEqual([])
  })
})

describe('over-masking guard (issues #195 / #196)', () => {
  it('`X-Token-Type: Bearer` does not turn every "Bearer" in the row into dots', () => {
    const m = maskHistoryRow(
      {
        url: 'https://h/x',
        request_snapshot: JSON.stringify({ headers: { 'X-Token-Type': 'Bearer' } }),
        response_snapshot: JSON.stringify({ body: '{"token_type":"Bearer","scheme":"Basic"}' }),
      },
      createScrubber([]),
    )
    expect(JSON.parse(m.response_snapshot!).body).toBe('{"token_type":"Bearer","scheme":"Basic"}')
  })

  it('a real 20-char token sent by name is still scrubbed from the echoed response', () => {
    const tok = 'abcdefghij0123456789'
    const m = maskHistoryRow(
      {
        url: 'https://h/x',
        request_snapshot: JSON.stringify({ headers: { 'X-Api-Token': tok } }),
        response_snapshot: JSON.stringify({ body: `{"echo":"${tok}"}` }),
      },
      createScrubber([]),
    )
    expect(m.response_snapshot).not.toContain(tok)
  })

  it('values collected by name need 8+ chars; secret-variable values keep the 6-char rule', () => {
    const m = maskHistoryRow(
      {
        url: 'https://h/x',
        request_snapshot: JSON.stringify({ headers: { 'X-Session-Mode': 'shared1' } }),
        response_snapshot: JSON.stringify({ body: 'mode shared1 / sixchr' }),
      },
      createScrubber(['sixchr']),
    )
    expect(JSON.parse(m.response_snapshot!).body).toBe(`mode shared1 / ${HISTORY_MASK}`)
  })

  it('scheme words and JSON literals are never value needles, whatever the case', () => {
    expect(createScrubber(['Bearer', 'NEGOTIATE', 'Digest', 'Token']).needles).toEqual([])
  })
})
