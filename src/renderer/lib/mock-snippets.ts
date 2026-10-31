/**
 * Hand-written snippet libraries for the mock-server response editor.
 *
 * The Condition field accepts a JSON describing one of the supported
 * predicates (see `MockCondition` in types). The Script field accepts
 * arbitrary JavaScript that runs in a Node vm sandbox before the response
 * is sent and can mutate `state` / `response` / `setJson()` / `setStatus()`.
 *
 * These two arrays power the "Insert example" dropdowns next to those
 * fields so users don't have to memorise the schema.
 */

export interface MockSnippet {
  /**
   * Stable id. The dropdown name and its tooltip live in i18n
   * (`mock.snippet.<id>.label` / `.description`, EN + TR — issue #309);
   * the picker translates them at render time.
   */
  id: string
  /** The text inserted into the editor when the user picks this entry. Code — never translated. */
  body: string
}

/** i18n key of the snippet's dropdown name. */
export function snippetLabelKey(s: Pick<MockSnippet, 'id'>): string {
  return `mock.snippet.${s.id}.label`
}

/** i18n key of the snippet's one-line description (the option tooltip). */
export function snippetDescriptionKey(s: Pick<MockSnippet, 'id'>): string {
  return `mock.snippet.${s.id}.description`
}

// ─── Condition snippets ──────────────────────────────────────────

export const CONDITION_SNIPPETS: MockSnippet[] = [
  {
    id: 'cond.always',
    body: JSON.stringify({ type: 'always' }, null, 2),
  },
  {
    id: 'cond.headerEquals',
    body: JSON.stringify({ type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' }, null, 2),
  },
  {
    id: 'cond.headerContains',
    body: JSON.stringify(
      { type: 'header', name: 'User-Agent', op: 'contains', value: 'Postman' },
      null,
      2,
    ),
  },
  {
    id: 'cond.bearerPresent',
    body: JSON.stringify(
      { type: 'header', name: 'Authorization', op: 'regex', value: '^Bearer\\s+' },
      null,
      2,
    ),
  },
  {
    id: 'cond.queryEquals',
    body: JSON.stringify({ type: 'query', name: 'status', op: 'eq', value: 'active' }, null, 2),
  },
  {
    id: 'cond.pathParamEquals',
    body: JSON.stringify({ type: 'pathParam', name: 'id', op: 'eq', value: '42' }, null, 2),
  },
  {
    id: 'cond.jsonFieldEquals',
    body: JSON.stringify(
      { type: 'jsonPath', path: '$.user.role', op: 'eq', value: 'admin' },
      null,
      2,
    ),
  },
  {
    id: 'cond.jsonFieldExists',
    body: JSON.stringify({ type: 'jsonPath', path: '$.errors[0]', op: 'exists' }, null, 2),
  },
  {
    id: 'cond.xpathValue',
    body: JSON.stringify(
      { type: 'xpath', expression: '//Order/Status/text()', op: 'eq', value: 'PAID' },
      null,
      2,
    ),
  },
  {
    id: 'cond.methodPost',
    body: JSON.stringify({ type: 'method', method: 'POST' }, null, 2),
  },
  {
    id: 'cond.and',
    body: JSON.stringify(
      {
        type: 'and',
        conditions: [
          { type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' },
          { type: 'jsonPath', path: '$.user.role', op: 'eq', value: 'admin' },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'cond.or',
    body: JSON.stringify(
      {
        type: 'or',
        conditions: [
          { type: 'method', method: 'POST' },
          { type: 'method', method: 'PUT' },
        ],
      },
      null,
      2,
    ),
  },
]

// ─── Script snippets ─────────────────────────────────────────────

export const SCRIPT_SNIPPETS: MockSnippet[] = [
  {
    id: 'script.statefulCrud',
    body: `// In-memory CRUD stub. Persists across requests until the server is stopped.
state.users ??= {}

if (request.method === 'POST') {
  const u = request.body
  if (!u || !u.id) {
    setStatus(400)
    setJson({ error: 'id required' })
  } else {
    state.users[u.id] = u
    setStatus(201)
    setJson(u)
  }
} else if (request.method === 'GET') {
  const id = request.params.id
  if (id) setJson(state.users[id] ?? { error: 'not found' })
  else setJson(Object.values(state.users))
} else if (request.method === 'DELETE') {
  delete state.users[request.params.id]
  setStatus(204)
}
`,
  },
  {
    id: 'script.counter',
    body: `state.calls = (state.calls ?? 0) + 1
setJson({ count: state.calls, ts: new Date().toISOString() })
`,
  },
  {
    id: 'script.echo',
    body: `setJson({
  method: request.method,
  path: request.path,
  headers: request.headers,
  query: request.query,
  params: request.params,
  body: request.body,
})
`,
  },
  {
    id: 'script.conditionalByBody',
    body: `if (request.body && request.body.role === 'admin') {
  setJson({ allowed: true, scope: ['read', 'write', 'delete'] })
} else {
  setStatus(403)
  setJson({ allowed: false, error: 'forbidden' })
}
`,
  },
  {
    id: 'script.randomFailure',
    body: `if (Math.random() < 0.2) {
  setStatus(500)
  setJson({ error: 'random_failure' })
} else {
  setJson({ ok: true })
}
`,
  },
  {
    id: 'script.bearerCheck',
    body: `const auth = request.headers['authorization'] ?? ''
const token = /^Bearer\\s+(.+)$/i.exec(auth.trim())?.[1] ?? ''
const ALLOWED = ['secret-token-1', 'secret-token-2']
if (!ALLOWED.includes(token)) {
  setStatus(401)
  setHeader('www-authenticate', 'Bearer realm="mock", error="invalid_token"')
  setJson({ error: 'unauthorized' })
} else {
  setJson({ ok: true, who: token.slice(-4) })
}
`,
  },
  {
    id: 'script.serverFields',
    body: `const inbound = request.body ?? {}
const created = {
  ...inbound,
  id: state.nextId = (state.nextId ?? 1000) + 1,
  createdAt: new Date().toISOString(),
}
setStatus(201)
setJson(created)
`,
  },
  {
    id: 'script.headerMapping',
    body: `const traceId = request.headers['x-trace-id'] ?? 'untraced'
setHeader('x-trace-id', traceId)
setJson({ traceId, timestamp: Date.now() })
`,
  },
  {
    id: 'script.pagination',
    body: `const items = Object.values(state.users ?? {})
const page = Math.max(1, Number(request.query.page) || 1)
const size = Math.min(100, Math.max(1, Number(request.query.size) || 20))
const start = (page - 1) * size
setJson({
  page,
  size,
  total: items.length,
  items: items.slice(start, start + size),
})
`,
  },
  {
    id: 'script.statusFromQuery',
    body: `const code = Number(request.query.code)
if (Number.isFinite(code) && code >= 100 && code < 600) {
  setStatus(code)
  setJson({ requestedStatus: code })
} else {
  setJson({ ok: true, hint: 'Add ?code=NNN to override status' })
}
`,
  },
  {
    id: 'script.roundRobin',
    body: `const replies = [
  { status: 200, body: { ok: true, n: 1 } },
  { status: 200, body: { ok: true, n: 2 } },
  { status: 503, body: { error: 'try again' } },
]
state.idx = ((state.idx ?? -1) + 1) % replies.length
const r = replies[state.idx]
setStatus(r.status)
setJson(r.body)
`,
  },
  {
    id: 'script.slowResponse',
    body: `// Note: vm sandbox can't await timers — for clean delays use the
// "Delay (ms)" field on the response. This snippet shows the pattern.
const start = Date.now()
while (Date.now() - start < 200) {
  // busy wait — keep brief, the sandbox enforces a 5s timeout
}
setJson({ ok: true, delayedMs: 200 })
`,
  },
]
