/**
 * Review follow-ups to issues #195 / #196 on the ONE main-side mask
 * (`src/main/lib/sensitive-scrub.ts`). Pure: no DB, no electron.
 *
 * Fail-before (each case):
 *  - the name rule only reached top-level string fields of known containers,
 *    so GraphQL `variables`, nested SOAP `params`, a WebSocket composer, a
 *    Socket.IO emit payload and gRPC `messages` kept `password` / `token`;
 *  - response bodies were only value-scrubbed, so an OAuth token endpoint's
 *    `access_token` / `refresh_token` reply was stored verbatim;
 *  - `maskUrlText` had no userinfo rule — `https://u:p@{{host}}` (which
 *    `stripUrlCredentials` cannot parse) kept `u:p@`;
 *  - Console `statusText` was never masked.
 */
import { describe, expect, it } from 'vitest'
import {
  HISTORY_MASK,
  NAME_ONLY,
  createScrubber,
  maskBodyText,
  maskConsoleEntry,
  maskHistoryRow,
  maskJsonBody,
  maskResponseBodyText,
  maskRunResult,
  maskUrlText,
} from '../../src/main/lib/sensitive-scrub'
import type { EndpointRunResult } from '../../src/shared/runner-types'
import { historyTabUrl } from '../../src/renderer/lib/history-restore'

const PW = 'hunter2-pw'
const TOKEN = 'ws-composer-token-77'

function rowText(request: unknown, response?: unknown, url = 'https://api.test/x'): string {
  const m = maskHistoryRow(
    {
      url,
      request_snapshot: JSON.stringify(request),
      response_snapshot: response === undefined ? undefined : JSON.stringify(response),
    },
    NAME_ONLY,
  )
  return JSON.stringify(m)
}

describe('name rule reaches nested / body-like fields (issue #195)', () => {
  it('GraphQL variables as a JSON string — flat field and configured.meta', () => {
    const variables = `{\n  "input": {\n    "email": "a@b.c",\n    "password": "${PW}"\n  }\n}`
    const text = rowText({
      url: 'https://api.test/graphql',
      query: 'mutation Login($input: LoginInput!) { login(input: $input) { ok } }',
      variables,
      configured: { url: 'https://api.test/graphql', meta: { graphql: { variables } } },
    })
    expect(text).not.toContain(PW)
    expect(text).toContain('a@b.c')
  })

  it('GraphQL variables as an object', () => {
    const text = rowText({ variables: { password: PW, user: 'alice' } })
    expect(text).not.toContain(PW)
    expect(text).toContain('alice')
  })

  it('template mode keeps a {{var}} reference in configured variables, masks a literal', () => {
    const m = maskHistoryRow(
      {
        url: 'https://api.test/graphql',
        request_snapshot: JSON.stringify({
          configured: {
            meta: {
              graphql: { variables: '{"password":"{{pw}}","token":"literal-tok-12345"}' },
            },
          },
        }),
      },
      NAME_ONLY,
    )
    const snap = JSON.parse(m.request_snapshot)
    const vars = JSON.parse(snap.configured.meta.graphql.variables)
    expect(vars.password).toBe('{{pw}}')
    expect(vars.token).toBe(HISTORY_MASK)
  })

  it('SOAP params: nested Credentials.Password', () => {
    const text = rowText({
      endpointUrl: 'https://soap.test/svc',
      params: { Login: { Credentials: { Username: 'bob', Password: PW } } },
    })
    expect(text).not.toContain(PW)
    expect(text).toContain('bob')
  })

  it('WebSocket composerContent and Socket.IO emitPayload (configured, literal)', () => {
    const text = rowText({
      url: 'wss://ws.test',
      configured: {
        url: 'wss://ws.test',
        meta: {
          websocket: { composerContent: `{\n  "type": "auth",\n  "token": "${TOKEN}"\n}` },
          socketio: { emitPayload: `{"auth":{"apiKey":"${TOKEN}"}}` },
        },
      },
    })
    expect(text).not.toContain(TOKEN)
  })

  it('gRPC messages (JSON strings in an array) and any payload', () => {
    const text = rowText({
      messages: [`{"secret":"${TOKEN}"}`, '{"n":1}'],
      payload: { session: TOKEN },
    })
    expect(text).not.toContain(TOKEN)
  })

  it('a JSON string anywhere keeps its formatting when only in-place masking was needed', () => {
    const pretty = `{\n    "user": "x",\n    "password": "${PW}"\n}`
    expect(maskBodyText(pretty, NAME_ONLY)).toBe(
      `{\n    "user": "x",\n    "password": "${HISTORY_MASK}"\n}`,
    )
  })

  it('a credential inside an escaped JSON-in-JSON string is masked (re-serialised)', () => {
    const inner = JSON.stringify({ token: TOKEN })
    const outer = JSON.stringify({ frame: inner }, null, 2)
    const out = maskBodyText(outer, NAME_ONLY)
    expect(out).not.toContain(TOKEN)
    expect(JSON.parse(JSON.parse(out).frame).token).toBe(HISTORY_MASK)
    expect(out).toContain('\n  "frame"') // indentation kept
  })

  it('maskJsonBody: objects, arrays, nested JSON strings; non-credential values kept', () => {
    const out = maskJsonBody(
      { a: [{ password: PW }, 'plain'], b: `{"refresh_token":"${TOKEN}"}`, keyword: 'k' },
      NAME_ONLY,
    ) as Record<string, unknown>
    expect(JSON.stringify(out)).not.toContain(PW)
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    expect(out.keyword).toBe('k')
  })

  it('token_type: "Bearer" is not a credential value', () => {
    expect(maskBodyText('{"token_type":"Bearer"}', NAME_ONLY)).toBe('{"token_type":"Bearer"}')
  })
})

describe('response bodies in persisted sinks (issue #195)', () => {
  const tokenReply = {
    access_token: 'at-123456789',
    refresh_token: 'rt-987654321',
    id_token: 'idt-55555555',
    token_type: 'Bearer',
    expires_in: 3600,
  }

  it('History response_snapshot: OAuth token reply is masked', () => {
    const text = rowText(
      { url: 'https://as.test/token' },
      {
        status: 200,
        body: JSON.stringify(tokenReply),
      },
    )
    expect(text).not.toContain('at-123456789')
    expect(text).not.toContain('rt-987654321')
    expect(text).not.toContain('idt-55555555')
    expect(text).toContain('3600')
  })

  it('urlencoded response body', () => {
    const out = maskResponseBodyText(
      'access_token=at-123456789&token_type=bearer&client_secret=cs-0000000',
      NAME_ONLY,
    )
    expect(out).not.toContain('at-123456789')
    expect(out).not.toContain('cs-0000000')
    expect(out).toContain('token_type=bearer')
  })

  it('Runner responseBody is masked', () => {
    const r = maskRunResult(
      {
        endpointId: 'e',
        name: 'n',
        method: 'POST',
        url: 'https://as.test/token',
        status: 200,
        statusText: 'OK',
        duration: 1,
        size: 1,
        assertions: [],
        responseBody: JSON.stringify(tokenReply),
      } as unknown as EndpointRunResult,
      NAME_ONLY,
    )
    expect(r.responseBody).not.toContain('at-123456789')
  })

  it('Console responseBody and message are masked; statusText too (issue #196)', () => {
    const scrub = createScrubber(['provider-key-abcdef'])
    const e = maskConsoleEntry(
      {
        url: 'https://as.test/token',
        statusText: 'Invalid API key provider-key-abcdef',
        message: `WS ← {"token":"${TOKEN}"}`,
        details: { responseBody: JSON.stringify(tokenReply) },
      },
      scrub,
    )
    expect(e.statusText).not.toContain('provider-key-abcdef')
    expect(e.message).not.toContain(TOKEN)
    expect(e.details?.responseBody).not.toContain('at-123456789')
  })
})

describe('URL userinfo (issue #195)', () => {
  it('sent: user:pass@ is masked, also on a templated host stripUrlCredentials cannot parse', () => {
    expect(maskUrlText('https://admin:s3cret-pw@{{host}}/x', NAME_ONLY)).not.toContain('s3cret-pw')
    expect(maskUrlText('https://admin:s3cret-pw@api.test/x', NAME_ONLY)).toBe(
      `https://${HISTORY_MASK}@api.test/x`,
    )
  })

  it('template: {{var}} userinfo kept, a literal masked', () => {
    expect(maskUrlText('https://{{user}}:{{pass}}@api.test/x', NAME_ONLY, 'template')).toBe(
      'https://{{user}}:{{pass}}@api.test/x',
    )
    expect(maskUrlText('https://admin:lit-pw-1@{{host}}/x', NAME_ONLY, 'template')).toBe(
      `https://${HISTORY_MASK}@{{host}}/x`,
    )
  })

  it('does not touch a path or query @', () => {
    expect(maskUrlText('https://api.test/@me?email=a@b.c', NAME_ONLY)).toBe(
      'https://api.test/@me?email=a@b.c',
    )
  })

  it('History row: url, flat url and configured.url all masked; the password is scrubbed from an echo', () => {
    const text = rowText(
      {
        url: 'https://admin:s3cret-pw@{{host}}/x',
        configured: { url: 'https://admin:s3cret-pw@{{host}}/x' },
      },
      { status: 200, body: 'echo s3cret-pw' },
      'https://admin:s3cret-pw@{{host}}/x',
    )
    expect(text).not.toContain('s3cret-pw')
  })

  it('Console url + Runner url masked', () => {
    const e = maskConsoleEntry({ url: 'https://u:pw-123456@h.test/' }, NAME_ONLY)
    expect(e.url).not.toContain('pw-123456')
    const r = maskRunResult(
      { url: 'https://u:pw-123456@h.test/', assertions: [] } as unknown as EndpointRunResult,
      NAME_ONLY,
    )
    expect(r.url).not.toContain('pw-123456')
  })
})

describe('named pairs inside JSON payloads', () => {
  it('[{key, value}]: the name stays, a credential-named value is masked', () => {
    const body = JSON.stringify([
      { key: 'Authorization', value: 'Bearer pair-secret-123456' },
      { key: 'Accept', value: 'application/json' },
    ])
    const out = JSON.parse(maskBodyText(body, NAME_ONLY))
    expect(out[0]).toEqual({ key: 'Authorization', value: HISTORY_MASK })
    expect(out[1]).toEqual({ key: 'Accept', value: 'application/json' })
  })

  it('a param list keeps its names (SOAP / HTTP params as [{key,value}])', () => {
    const m = maskHistoryRow(
      {
        url: 'https://x',
        request_snapshot: JSON.stringify({
          params: [{ key: 'api_key', value: 'param-secret-12345', enabled: true }],
        }),
      },
      NAME_ONLY,
    )
    expect(JSON.parse(m.request_snapshot).params[0]).toEqual({
      key: 'api_key',
      value: HISTORY_MASK,
      enabled: true,
    })
  })

  it('a lone "key" field is still masked', () => {
    expect(maskBodyText('{"key":"sk-live-0000000"}', NAME_ONLY)).not.toContain('sk-live')
  })
})

describe('a lone "key" field without a structural pass', () => {
  it('templated configured body (not valid JSON) — literal "key" masked in template mode', () => {
    const m = maskHistoryRow(
      {
        url: 'https://x',
        request_snapshot: JSON.stringify({
          configured: { body: { type: 'json', content: '{"key":"sk-live-123456","n":{{n}}}' } },
        }),
      },
      NAME_ONLY,
    )
    const content = JSON.parse(m.request_snapshot).configured.body.content as string
    expect(content).not.toContain('sk-live-123456')
    expect(content).toContain('{{n}}')
  })

  it('invalid JSON text', () => {
    expect(maskBodyText('{"key":"sk-live-123456", oops', NAME_ONLY)).not.toContain('sk-live')
  })
})

describe('history restore of a masked userinfo', () => {
  it('reopens as a URL without userinfo, not https://@host', () => {
    expect(
      historyTabUrl({ url: `https://${HISTORY_MASK}@{{host}}/x`, request_snapshot: '{}' } as never),
    ).toBe('https://{{host}}/x')
  })
})
