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
  /** Display label shown in the dropdown. */
  label: string
  /** One-line tooltip / hint shown under the snippet content. */
  description: string
  /** The text inserted into the editor when the user picks this entry. */
  body: string
}

// ─── Condition snippets ──────────────────────────────────────────

export const CONDITION_SNIPPETS: MockSnippet[] = [
  {
    label: 'Always (default)',
    description: 'Catch-all — the simplest possible condition; matches every request.',
    body: JSON.stringify({ type: 'always' }, null, 2),
  },
  {
    label: 'Header equals',
    description: 'Pick this response when a request header has a specific value.',
    body: JSON.stringify({ type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' }, null, 2),
  },
  {
    label: 'Header contains',
    description: 'Substring match against a header value.',
    body: JSON.stringify(
      { type: 'header', name: 'User-Agent', op: 'contains', value: 'Postman' },
      null,
      2,
    ),
  },
  {
    label: 'Authorization bearer present',
    description: 'Match when the Authorization header starts with "Bearer ".',
    body: JSON.stringify(
      { type: 'header', name: 'Authorization', op: 'regex', value: '^Bearer\\s+' },
      null,
      2,
    ),
  },
  {
    label: 'Query param equals',
    description: 'Pick this response when ?status=active (etc.) is present.',
    body: JSON.stringify({ type: 'query', name: 'status', op: 'eq', value: 'active' }, null, 2),
  },
  {
    label: 'Path parameter equals',
    description: 'Match a specific :id segment from the endpoint path.',
    body: JSON.stringify({ type: 'pathParam', name: 'id', op: 'eq', value: '42' }, null, 2),
  },
  {
    label: 'JSON body — field equals',
    description: 'Match when a JSONPath in the request body equals a value.',
    body: JSON.stringify(
      { type: 'jsonPath', path: '$.user.role', op: 'eq', value: 'admin' },
      null,
      2,
    ),
  },
  {
    label: 'JSON body — field exists',
    description: 'Match when a JSONPath resolves to anything at all.',
    body: JSON.stringify({ type: 'jsonPath', path: '$.errors[0]', op: 'exists' }, null, 2),
  },
  {
    label: 'XML body — element value (XPath)',
    description: 'Match an XPath expression evaluated against the request body.',
    body: JSON.stringify(
      { type: 'xpath', expression: '//Order/Status/text()', op: 'eq', value: 'PAID' },
      null,
      2,
    ),
  },
  {
    label: 'Method is POST',
    description: 'Filter by HTTP verb (useful when the endpoint accepts ANY).',
    body: JSON.stringify({ type: 'method', method: 'POST' }, null, 2),
  },
  {
    label: 'AND — header + body',
    description: 'Combine two predicates; both must match.',
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
    label: 'OR — multiple methods',
    description: 'Match when any of the listed predicates is true.',
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
    label: 'Stateful CRUD — store + return',
    description:
      'POST stores the body in `state.users[id]`; GET returns either one user or the full collection.',
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
    label: 'Counter — incremented on every call',
    description: 'Server-wide counter, useful for quickly checking how many requests came in.',
    body: `state.calls = (state.calls ?? 0) + 1
setJson({ count: state.calls, ts: new Date().toISOString() })
`,
  },
  {
    label: 'Echo + transform',
    description:
      'Reply with method, path, headers, query and body — useful for debugging client requests.',
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
    label: 'Conditional response by request body',
    description: 'Different status / body depending on a request body field.',
    body: `if (request.body && request.body.role === 'admin') {
  setJson({ allowed: true, scope: ['read', 'write', 'delete'] })
} else {
  setStatus(403)
  setJson({ allowed: false, error: 'forbidden' })
}
`,
  },
  {
    label: 'Random failure (1 in 5)',
    description: 'Probabilistic fault injection — return 500 ~20% of the time.',
    body: `if (Math.random() < 0.2) {
  setStatus(500)
  setJson({ error: 'random_failure' })
} else {
  setJson({ ok: true })
}
`,
  },
  {
    label: 'Bearer token check (custom)',
    description:
      'Inline token validation in script — use the server-level Auth panel for declarative auth instead.',
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
    label: 'Add server-generated fields',
    description: 'Take an incoming body, add an id + timestamps, return it as the response.',
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
    label: 'Header → response mapping',
    description: 'Echo a request header into the response payload.',
    body: `const traceId = request.headers['x-trace-id'] ?? 'untraced'
setHeader('x-trace-id', traceId)
setJson({ traceId, timestamp: Date.now() })
`,
  },
  {
    label: 'Pagination (paginate state.items)',
    description:
      'Slice an in-memory list with ?page=&size= query params. Run "Stateful CRUD" first to populate.',
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
    label: 'HTTP status from query (?code=429)',
    description:
      'Return whatever HTTP status the caller asks for — handy for client-side error tests.',
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
    label: 'Sequential responses (round-robin)',
    description:
      'Cycle through a fixed list of responses on each call. Resets when the server restarts.',
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
    label: 'Slow response (artificial latency)',
    description:
      'Adds delay using a busy-wait loop. Prefer the per-response Delay (ms) field for cleaner waits — this script is a fallback when you need conditional latency.',
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
