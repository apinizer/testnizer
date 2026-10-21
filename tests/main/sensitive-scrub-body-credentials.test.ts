/**
 * Canary scan follow-up (release 1.6.0) — credentials the request carried in
 * its BODY are value-scrubbed from the rest of the row / entry / step.
 *
 * Before: `collectCredentialValues` collected credential-named headers, query
 * params, auth fields and URL userinfo only. A body `{"client_secret":"…"}`
 * was masked by NAME on the request side, but an echo server returning the
 * value under a neutral name (`Body:[…]`, `{"echo":"…"}`) put it back in the
 * History `response_snapshot`, the Console response body and the Runner
 * result / export in clear text.
 *
 * Pure: no DB, no electron.
 */
import { describe, expect, it } from 'vitest'
import {
  HISTORY_MASK,
  NAME_ONLY,
  collectCredentialValues,
  maskBodyText,
  maskConsoleEntry,
  maskHistoryRow,
  maskRunResult,
} from '../../src/main/lib/sensitive-scrub'
import type { EndpointRunResult } from '../../src/shared/runner-types'

const CANARY = 'CANARY-body-588a9c43-732c'
const DEEP = 'CANARY-deep-1f2e3d4c-5b6a'
const FORM = 'CANARY-form+val/ue=42xyz'

describe('collectCredentialValues — request body', () => {
  it('a JSON body text: credential-named string leaves at any depth', () => {
    const out = collectCredentialValues({
      body: JSON.stringify({ client_secret: CANARY, nested: { auth: { password: DEEP } } }),
    })
    expect(out).toContain(CANARY)
    expect(out).toContain(DEEP)
  })

  it('a RequestBody record: `content` JSON, `urlEncoded` / `formData` pairs by name', () => {
    expect(
      collectCredentialValues({ body: { type: 'json', content: `{"client_secret":"${CANARY}"}` } }),
    ).toContain(CANARY)
    expect(
      collectCredentialValues({
        body: {
          type: 'x-www-form-urlencoded',
          urlEncoded: [
            { key: 'grant_type', value: 'client_credentials', enabled: true },
            { key: 'client_secret', value: CANARY, enabled: true },
          ],
        },
      }),
    ).toEqual([CANARY])
    expect(
      collectCredentialValues({
        body: { type: 'form-data', formData: [{ key: 'password', value: DEEP }] },
      }),
    ).toContain(DEEP)
  })

  it('a JSON `{ key | name, value }` pair: the pair name decides', () => {
    const out = collectCredentialValues({
      body: JSON.stringify([
        { name: 'api_key', value: CANARY },
        { key: 'page', value: 'x-long-plain-value' },
      ]),
    })
    expect(out).toEqual([CANARY])
  })

  it('JSON-in-JSON: a string field that is itself a JSON object', () => {
    const inner = JSON.stringify({ refresh_token: DEEP })
    expect(collectCredentialValues({ requestBody: JSON.stringify({ data: inner }) })).toContain(
      DEEP,
    )
  })

  it('a urlencoded body text: raw and decoded forms', () => {
    const enc = encodeURIComponent(FORM)
    const out = collectCredentialValues({
      requestBody: `grant_type=client_credentials&client_secret=${enc}`,
    })
    expect(out).toContain(enc)
    expect(out).toContain(FORM)
    expect(out).not.toContain('client_credentials')
  })

  it('never collects short values, common words, templates or masks; non-credential names stay', () => {
    const out = collectCredentialValues({
      body: JSON.stringify({
        password: 'short',
        token: 'Bearer',
        secret: 'true',
        client_secret: '{{clientSecret}}',
        api_key: HISTORY_MASK,
        keyword: 'not-a-credential-value',
        author: 'someone-long-name',
      }),
    })
    expect(out).toEqual([])
  })

  it('`configured` (the {{var}} template) is skipped', () => {
    expect(
      collectCredentialValues({ configured: { body: `{"client_secret":"${CANARY}"}` } }),
    ).toEqual([])
  })
})

describe('the body credential is scrubbed from the echo (History / Console / Runner)', () => {
  it('History row: request body client_secret echoed under a neutral name → absent', () => {
    const row = maskHistoryRow(
      {
        url: 'https://echo.test/token',
        request_snapshot: JSON.stringify({
          method: 'POST',
          body: { type: 'json', content: `{"client_secret":"${CANARY}"}` },
        }),
        response_snapshot: JSON.stringify({
          status: 200,
          body: `Body:[${CANARY}]`,
          headers: { 'x-echo': CANARY },
        }),
      },
      NAME_ONLY,
    )
    const text = JSON.stringify(row)
    expect(text).not.toContain(CANARY)
    expect(JSON.parse(row.response_snapshot!).body).toBe(`Body:[${HISTORY_MASK}]`)
  })

  it('History row: form body variant', () => {
    const row = maskHistoryRow(
      {
        url: 'https://echo.test/token',
        request_snapshot: JSON.stringify({
          body: {
            type: 'x-www-form-urlencoded',
            urlEncoded: [{ key: 'client_secret', value: FORM, enabled: true }],
          },
        }),
        response_snapshot: JSON.stringify({ body: `{"echo":"${FORM}"}` }),
      },
      NAME_ONLY,
    )
    expect(JSON.stringify(row)).not.toContain(FORM)
  })

  it('Console entry: requestBody credential echoed in responseBody → absent', () => {
    const out = maskConsoleEntry(
      {
        url: 'https://echo.test/token',
        details: {
          requestBody: `{"client_secret":"${CANARY}"}`,
          responseBody: `{"echo":"${CANARY}"}`,
        },
      },
      NAME_ONLY,
    )
    expect(JSON.stringify(out)).not.toContain(CANARY)
    expect(out.details?.responseBody).toBe(`{"echo":"${HISTORY_MASK}"}`)
  })

  it('Console entry: form body variant', () => {
    const enc = encodeURIComponent(FORM)
    const out = maskConsoleEntry(
      {
        details: {
          requestBody: `grant_type=client_credentials&client_secret=${enc}`,
          responseBody: `got ${FORM}`,
        },
      },
      NAME_ONLY,
    )
    expect(JSON.stringify(out)).not.toContain(FORM)
    expect(JSON.stringify(out)).not.toContain(enc)
  })

  it('Runner result (recordStep + HTML/JSON export funnel): body echo → absent', () => {
    const r = {
      endpointId: 'e1',
      name: 'token',
      method: 'POST',
      url: 'https://echo.test/token',
      status: 200,
      duration: 1,
      assertions: [{ name: `echo is ${CANARY}`, passed: true, actual: CANARY }],
      requestBody: `{"client_secret":"${CANARY}"}`,
      responseBody: `Body:[${CANARY}]`,
    } as unknown as EndpointRunResult
    const out = maskRunResult(r, NAME_ONLY)
    expect(JSON.stringify(out)).not.toContain(CANARY)
    expect(out.responseBody).toBe(`Body:[${HISTORY_MASK}]`)
  })
})

describe('XML / SOAP bodies (WS-Security)', () => {
  const PW = 'CANARY-WSSE-pw-1f2e3d4c-5b6a'
  const KEY = 'CANARY-apikey-attr-9a8b7c6d'
  const CDATA = 'CANARY-cdata-<&>-secret-42'
  const ENVELOPE =
    '<soapenv:Envelope xmlns:wsse="urn:wsse"><soapenv:Header><wsse:Security><wsse:UsernameToken>' +
    '<wsse:Username>bob-the-user</wsse:Username>' +
    `<wsse:Password Type="urn:x#PasswordText">${PW}</wsse:Password>` +
    '<wsse:Nonce>bm9uY2Utbm90LWEtc2VjcmV0</wsse:Nonce>' +
    '</wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body>' +
    `<Login ApiKey="${KEY}" mode='plain-attribute-value'>` +
    `<client_secret><![CDATA[${CDATA}]]></client_secret>` +
    '<Password>short</Password><Token>{{token}}</Token><Secret>true</Secret>' +
    '</Login></soapenv:Body></soapenv:Envelope>'

  it('collects credential-named elements (any prefix), CDATA and attributes — nothing else', () => {
    const out = collectCredentialValues({ envelope: ENVELOPE })
    expect(out).toEqual(expect.arrayContaining([PW, KEY, CDATA]))
    for (const v of [
      'bob-the-user',
      'bm9uY2Utbm90LWEtc2VjcmV0',
      'urn:x#PasswordText',
      'plain-attribute-value',
      'short',
      '{{token}}',
      'true',
    ]) {
      expect(out).not.toContain(v)
    }
  })

  it('an entity-escaped value: the raw and the decoded form', () => {
    const out = collectCredentialValues({
      requestBody: '<a><password>p&amp;ss&lt;word&gt;42</password></a>',
    })
    expect(out).toEqual(expect.arrayContaining(['p&amp;ss&lt;word&gt;42', 'p&ss<word>42']))
  })

  it('a RequestBody record with XML content', () => {
    expect(
      collectCredentialValues({ body: { type: 'xml', content: `<x><ApiKey>${KEY}</ApiKey></x>` } }),
    ).toContain(KEY)
  })

  const echo = `<EchoResponse><Said>${PW}</Said><Key>${KEY}</Key><C>${CDATA}</C></EchoResponse>`

  it('History row: the envelope credential echoed in the reply → absent', () => {
    const row = maskHistoryRow(
      {
        url: 'https://soap.test/svc',
        request_snapshot: JSON.stringify({ envelope: ENVELOPE }),
        response_snapshot: JSON.stringify({ status: 200, body: echo }),
      },
      NAME_ONLY,
    )
    const text = JSON.stringify(row)
    for (const v of [PW, KEY, CDATA]) expect(text).not.toContain(v)
  })

  it('History row: a credential element in the SOAP REPLY alone is not collected (XML replies stay readable)', () => {
    const reply = '<GetUserResponse><Password>reply-only-password-1</Password></GetUserResponse>'
    const row = maskHistoryRow(
      {
        url: 'https://soap.test/svc',
        request_snapshot: '{}',
        response_snapshot: JSON.stringify({ body: reply }),
      },
      NAME_ONLY,
    )
    expect(JSON.parse(row.response_snapshot!).body).toBe(reply)
  })

  it('Console entry: requestBody envelope echoed in responseBody → absent', () => {
    const out = maskConsoleEntry(
      { details: { requestBody: ENVELOPE, responseBody: echo } },
      NAME_ONLY,
    )
    const text = JSON.stringify(out)
    for (const v of [PW, KEY, CDATA]) expect(text).not.toContain(v)
  })

  it('Runner result: requestBody envelope echoed in responseBody → absent', () => {
    const r = {
      endpointId: 'e1',
      name: 'soap',
      method: 'POST',
      url: 'https://soap.test/svc',
      status: 200,
      duration: 1,
      assertions: [],
      requestBody: ENVELOPE,
      responseBody: echo,
    } as unknown as EndpointRunResult
    const text = JSON.stringify(maskRunResult(r, NAME_ONLY))
    for (const v of [PW, KEY, CDATA]) expect(text).not.toContain(v)
  })
})

describe('request-side XML name rule: CDATA leaves and attributes (any length)', () => {
  it('a credential-named CDATA leaf is masked by name, prefix ignored, wrapper kept', () => {
    expect(
      maskBodyText(
        '<wsse:Password Type="x"><![CDATA[abcd]]></wsse:Password><Username><![CDATA[bob]]></Username>',
        NAME_ONLY,
      ),
    ).toBe(
      `<wsse:Password Type="x"><![CDATA[${HISTORY_MASK}]]></wsse:Password><Username><![CDATA[bob]]></Username>`,
    )
  })

  it('credential-named attributes are masked by name, quote style kept, others untouched', () => {
    expect(
      maskBodyText(
        `<Login password="abcd" ApiKey='wxyz' wsse:token="t0k1" user="bob" xmlns:wsse="urn:x"/>`,
        NAME_ONLY,
      ),
    ).toBe(
      `<Login password="${HISTORY_MASK}" ApiKey='${HISTORY_MASK}' wsse:token="${HISTORY_MASK}" user="bob" xmlns:wsse="urn:x"/>`,
    )
  })

  it('template mode keeps a {{var}} reference in both forms', () => {
    const t = '<Login password="{{pw}}"><Secret><![CDATA[{{s}}]]></Secret></Login>'
    expect(maskBodyText(t, NAME_ONLY, 'template')).toBe(t)
  })

  it('History row, Console entry and Runner result: 4-char CDATA / attribute values absent', () => {
    const env =
      '<soapenv:Envelope><soapenv:Body><Login ApiKey="k9z1">' +
      '<wsse:Password><![CDATA[p4w2]]></wsse:Password></Login></soapenv:Body></soapenv:Envelope>'
    const row = maskHistoryRow(
      { url: 'https://soap.test/svc', request_snapshot: JSON.stringify({ envelope: env }) },
      NAME_ONLY,
    )
    const consoleOut = maskConsoleEntry({ details: { requestBody: env } }, NAME_ONLY)
    const runOut = maskRunResult(
      {
        endpointId: 'e1',
        name: 'soap',
        method: 'POST',
        url: 'https://soap.test/svc',
        status: 200,
        duration: 1,
        assertions: [],
        requestBody: env,
      } as unknown as EndpointRunResult,
      NAME_ONLY,
    )
    for (const text of [JSON.stringify(row), JSON.stringify(consoleOut), JSON.stringify(runOut)]) {
      expect(text).not.toContain('k9z1')
      expect(text).not.toContain('p4w2')
    }
  })
})
