/**
 * Issue #221 (Faz 0, Ek C R02) — `{{lastUserMessage}}`, `{{lastToolResult}}`
 * and `{{model}}` in mock response templates, read from an OpenAI chat
 * completions / Anthropic messages request body. Additive: a template that
 * does not use them renders exactly as before.
 *
 * The helper is unit-tested; the wiring is proven through a real HTTP mock
 * server (`mockServerManager`, free loopback port) so `server.ts` is shown to
 * put the shortcuts into the context for every body type.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { llmRequestShortcuts, renderTemplate } from '../../src/main/mock/template'
import { mockServerManager, type MockServerDef } from '../../src/main/mock/server'
import type { MockBodyType } from '../../src/main/mock/types'

const OPENAI_BODY = {
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Be brief.' },
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: [{ type: 'text', text: 'What is 2+2?' }] },
  ],
}

/** Anthropic tool round trip: the last user message only carries the tool result. */
const ANTHROPIC_TOOL_BODY = {
  model: 'claude-mock-1',
  max_tokens: 256,
  system: 'Be brief.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Echo hello please' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'echo', input: { text: 'hello' } }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_1',
          content: [{ type: 'text', text: 'hello from echo' }],
        },
      ],
    },
  ],
}

describe('llmRequestShortcuts', () => {
  it('OpenAI: model + the last user text (string or text parts); no tool result', () => {
    expect(llmRequestShortcuts(OPENAI_BODY)).toEqual({
      model: 'gpt-4o-mini',
      lastUserMessage: 'What is 2+2?',
      lastToolResult: '',
    })
  })

  it('OpenAI: the latest role "tool" message is the tool result', () => {
    const body = {
      model: 'm',
      messages: [
        { role: 'user', content: 'call echo' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function' }] },
        { role: 'tool', tool_call_id: 'c0', content: 'older result' },
        { role: 'tool', tool_call_id: 'c1', content: 'echo: hi' },
      ],
    }
    expect(llmRequestShortcuts(body)).toEqual({
      model: 'm',
      lastUserMessage: 'call echo',
      lastToolResult: 'echo: hi',
    })
  })

  it('Anthropic: a tool_result-only user message is skipped for lastUserMessage', () => {
    expect(llmRequestShortcuts(ANTHROPIC_TOOL_BODY)).toEqual({
      model: 'claude-mock-1',
      lastUserMessage: 'Echo hello please',
      lastToolResult: 'hello from echo',
    })
  })

  it('Anthropic: string content and string tool_result content', () => {
    const body = {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'plain question' },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'raw' }] },
      ],
    }
    expect(llmRequestShortcuts(body)).toEqual({
      model: 'claude-x',
      lastUserMessage: 'plain question',
      lastToolResult: 'raw',
    })
  })

  it('a JSON body that arrived as text (no JSON content type) is parsed', () => {
    expect(llmRequestShortcuts(JSON.stringify(OPENAI_BODY)).lastUserMessage).toBe('What is 2+2?')
  })

  it('anything without that shape gives empty strings', () => {
    const empty = { model: '', lastUserMessage: '', lastToolResult: '' }
    for (const body of [
      null,
      undefined,
      '',
      'hello',
      '{not json',
      42,
      [],
      { messages: 'nope' },
      { model: 7, messages: [null, 1, { role: 'user', content: 5 }] },
    ]) {
      expect(llmRequestShortcuts(body)).toEqual(empty)
    }
  })
})

describe('renderTemplate with the shortcuts in the context', () => {
  const base = {
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      query: {},
      params: {},
      body: OPENAI_BODY,
      bodyText: JSON.stringify(OPENAI_BODY),
    },
  }

  it('renders the shortcuts', () => {
    const ctx = { ...base, ...llmRequestShortcuts(OPENAI_BODY) }
    expect(renderTemplate('You said: {{lastUserMessage}} ({{model}})', ctx)).toBe(
      'You said: What is 2+2? (gpt-4o-mini)',
    )
  })

  it('a template that does not use them renders byte-identically', () => {
    const tpl =
      '{"n": {{request.body.messages.length}}, "m": "{{request.body.model}}", "x": "{{nope}}"}'
    const withShortcuts = renderTemplate(tpl, { ...base, ...llmRequestShortcuts(OPENAI_BODY) })
    expect(withShortcuts).toBe(renderTemplate(tpl, base))
    expect(withShortcuts).toBe('{"n": 4, "m": "gpt-4o-mini", "x": ""}')
  })
})

// ─── Through the real mock server ────────────────────────────────

/** A free port, so the suite never depends on one being available. */
async function freePort(): Promise<number> {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function serverDef(port: number, routes: { path: string; bodyType: MockBodyType; body: string }[]) {
  const def: MockServerDef = {
    id: 'llm-ctx',
    name: 'LLM ctx',
    host: '127.0.0.1',
    port,
    basePath: '',
    cors: {
      enabled: false,
      allowOrigins: '*',
      allowMethods: '*',
      allowHeaders: '*',
      allowCredentials: false,
      maxAge: 0,
    },
    auth: { type: 'none' },
    failure: { enabled: false, probability: 0, mode: 'status' },
    rateLimit: { enabled: false, requestsPerWindow: 100, windowMs: 60000, scope: 'ip' },
    echoEnabled: false,
    proxyEnabled: false,
    proxyTarget: '',
    proxyRecord: false,
    endpoints: routes.map((r, i) => ({
      id: `ep-${i}`,
      method: 'POST',
      path: r.path,
      pathMode: 'exact',
      description: '',
      priority: 0,
      enabled: true,
      authOverride: null,
      schemaValidation: null,
      responses: [
        {
          id: `resp-${i}`,
          name: '',
          statusCode: 200,
          headers: [],
          bodyType: r.bodyType,
          body: r.body,
          delayMs: 0,
          condition: { type: 'always' },
          script: '',
          order: 0,
          enabled: true,
        },
      ],
    })),
  }
  return def
}

afterEach(async () => {
  await mockServerManager.stopAll()
})

describe('the HTTP mock server puts the shortcuts into every response template', () => {
  const PLAIN_JSON = '{"id":"{{request.body.model}}","ok":true,"missing":"{{nope}}"}'

  async function start(): Promise<number> {
    const port = await freePort()
    const r = await mockServerManager.start(
      serverDef(port, [
        {
          path: '/v1/chat/completions',
          bodyType: 'text',
          body: 'You said: {{lastUserMessage}} / {{model}}',
        },
        {
          path: '/v1/messages',
          bodyType: 'json',
          body: '{"model":"{{model}}","you":"{{lastUserMessage}}","tool":"{{lastToolResult}}"}',
        },
        { path: '/plain', bodyType: 'json', body: PLAIN_JSON },
        { path: '/xml', bodyType: 'xml', body: '<m>{{model}}</m>' },
      ]),
    )
    expect(r.ok).toBe(true)
    return port
  }

  const post = async (port: number, path: string, body: unknown): Promise<string> => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    return res.text()
  }

  it('OpenAI chat completions body → lastUserMessage + model (text body)', async () => {
    const port = await start()
    expect(await post(port, '/v1/chat/completions', OPENAI_BODY)).toBe(
      'You said: What is 2+2? / gpt-4o-mini',
    )
  })

  it('Anthropic messages body → lastUserMessage, lastToolResult, model (json body)', async () => {
    const port = await start()
    expect(JSON.parse(await post(port, '/v1/messages', ANTHROPIC_TOOL_BODY))).toEqual({
      model: 'claude-mock-1',
      you: 'Echo hello please',
      tool: 'hello from echo',
    })
  })

  it('xml body type sees them too', async () => {
    const port = await start()
    expect(await post(port, '/xml', OPENAI_BODY)).toBe('<m>gpt-4o-mini</m>')
  })

  it('a template that does not use them is unchanged for an LLM-shaped request', async () => {
    const port = await start()
    expect(await post(port, '/plain', OPENAI_BODY)).toBe(
      '{"id":"gpt-4o-mini","ok":true,"missing":""}',
    )
    expect(await post(port, '/plain', { hello: 'world' })).toBe('{"id":"","ok":true,"missing":""}')
  })
})
