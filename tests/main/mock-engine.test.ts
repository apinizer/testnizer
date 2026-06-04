import { describe, it, expect } from 'vitest'
import { matchEndpoint, matchPath, type MatchableEndpoint } from '../../src/main/mock/matcher'
import { evaluateCondition } from '../../src/main/mock/condition'
import { renderTemplate } from '../../src/main/mock/template'

// ─── matchPath ────────────────────────────────────────────────────

describe('matchPath — exact', () => {
  it('matches identical strings', () => {
    expect(matchPath('exact', '/users', '/users')).toEqual({})
  })
  it('does not match different strings', () => {
    expect(matchPath('exact', '/users', '/users/1')).toBeNull()
  })
  it('tolerates a trailing slash', () => {
    expect(matchPath('exact', '/users/', '/users')).toEqual({})
  })
})

describe('matchPath — param', () => {
  it('extracts a single path parameter', () => {
    expect(matchPath('param', '/users/:id', '/users/42')).toEqual({ id: '42' })
  })
  it('extracts multiple parameters', () => {
    expect(matchPath('param', '/users/:uid/posts/:pid', '/users/u1/posts/p9')).toEqual({
      uid: 'u1',
      pid: 'p9',
    })
  })
  it('rejects when segment count differs', () => {
    expect(matchPath('param', '/users/:id', '/users')).toBeNull()
    expect(matchPath('param', '/users/:id', '/users/1/profile')).toBeNull()
  })
  it('rejects when literal segments differ', () => {
    expect(matchPath('param', '/users/:id', '/posts/1')).toBeNull()
  })
  it('decodes URI-encoded values', () => {
    expect(matchPath('param', '/users/:name', '/users/John%20Doe')).toEqual({ name: 'John Doe' })
  })
})

describe('matchPath — wildcard', () => {
  it('* matches a single segment', () => {
    expect(matchPath('wildcard', '/api/*', '/api/users')).toEqual({})
    expect(matchPath('wildcard', '/api/*', '/api/users/1')).toBeNull()
  })
  it('** matches greedily across segments', () => {
    expect(matchPath('wildcard', '/api/**', '/api/users/1/posts')).toEqual({})
  })
})

describe('matchPath — regex', () => {
  it('matches against a regex with named groups', () => {
    expect(matchPath('regex', '^/v(?<v>\\d+)/users$', '/v3/users')).toEqual({ v: '3' })
  })
  it('returns null when regex does not match', () => {
    expect(matchPath('regex', '^/v\\d+/users$', '/users')).toBeNull()
  })
})

// ─── matchEndpoint (priority + specificity) ───────────────────────

describe('matchEndpoint', () => {
  const endpoints: MatchableEndpoint[] = [
    { id: 'wildcard', method: 'GET', path: '/api/*', pathMode: 'wildcard', priority: 0, enabled: true },
    { id: 'param', method: 'GET', path: '/api/:resource', pathMode: 'param', priority: 0, enabled: true },
    { id: 'exact', method: 'GET', path: '/api/users', pathMode: 'exact', priority: 0, enabled: true },
  ]

  it('exact wins over param wins over wildcard at equal priority', () => {
    const r = matchEndpoint(endpoints, 'GET', '/api/users')
    expect(r?.endpoint.id).toBe('exact')
  })

  it('param wins when path doesn\'t match exact', () => {
    const r = matchEndpoint(endpoints, 'GET', '/api/posts')
    expect(r?.endpoint.id).toBe('param')
    expect(r?.params).toEqual({ resource: 'posts' })
  })

  it('higher priority overrides specificity', () => {
    const eps: MatchableEndpoint[] = [
      ...endpoints,
      { id: 'wild-priority', method: 'GET', path: '/api/*', pathMode: 'wildcard', priority: 10, enabled: true },
    ]
    const r = matchEndpoint(eps, 'GET', '/api/users')
    expect(r?.endpoint.id).toBe('wild-priority')
  })

  it('skips disabled endpoints', () => {
    const eps: MatchableEndpoint[] = endpoints.map((e) => ({ ...e, enabled: e.id !== 'exact' ? e.enabled : false }))
    const r = matchEndpoint(eps, 'GET', '/api/users')
    expect(r?.endpoint.id).not.toBe('exact')
  })

  it('ANY method matches any verb', () => {
    const eps: MatchableEndpoint[] = [
      { id: 'any', method: 'ANY', path: '/echo', pathMode: 'exact', priority: 0, enabled: true },
    ]
    expect(matchEndpoint(eps, 'GET', '/echo')?.endpoint.id).toBe('any')
    expect(matchEndpoint(eps, 'POST', '/echo')?.endpoint.id).toBe('any')
    expect(matchEndpoint(eps, 'DELETE', '/echo')?.endpoint.id).toBe('any')
  })

  it('returns null when nothing matches', () => {
    expect(matchEndpoint(endpoints, 'POST', '/api/users')).toBeNull()
  })
})

// ─── evaluateCondition ────────────────────────────────────────────

const baseCtx = {
  method: 'POST',
  headers: { 'x-tenant': 'acme', 'content-type': 'application/json' },
  query: { locale: 'tr' },
  pathParams: { id: '42' },
  body: { user: { role: 'admin', amount: 1500 } },
  bodyText: '<order><status>PAID</status></order>',
}

describe('evaluateCondition — basic', () => {
  it('always matches', () => {
    expect(evaluateCondition({ type: 'always' }, baseCtx)).toBe(true)
  })

  it('header eq', () => {
    expect(
      evaluateCondition({ type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' }, baseCtx),
    ).toBe(true)
    expect(
      evaluateCondition({ type: 'header', name: 'X-Tenant', op: 'eq', value: 'other' }, baseCtx),
    ).toBe(false)
  })

  it('query eq + regex', () => {
    expect(
      evaluateCondition({ type: 'query', name: 'locale', op: 'eq', value: 'tr' }, baseCtx),
    ).toBe(true)
    expect(
      evaluateCondition({ type: 'query', name: 'locale', op: 'regex', value: '^t' }, baseCtx),
    ).toBe(true)
  })

  it('pathParam eq', () => {
    expect(
      evaluateCondition({ type: 'pathParam', name: 'id', op: 'eq', value: '42' }, baseCtx),
    ).toBe(true)
    expect(
      evaluateCondition({ type: 'pathParam', name: 'id', op: 'neq', value: '42' }, baseCtx),
    ).toBe(false)
  })

  it('method', () => {
    expect(evaluateCondition({ type: 'method', method: 'POST' }, baseCtx)).toBe(true)
    expect(evaluateCondition({ type: 'method', method: 'GET' }, baseCtx)).toBe(false)
  })
})

describe('evaluateCondition — JSONPath', () => {
  it('eq match', () => {
    expect(
      evaluateCondition(
        { type: 'jsonPath', path: '$.user.role', op: 'eq', value: 'admin' },
        baseCtx,
      ),
    ).toBe(true)
  })

  it('exists', () => {
    expect(
      evaluateCondition({ type: 'jsonPath', path: '$.user.role', op: 'exists' }, baseCtx),
    ).toBe(true)
    expect(
      evaluateCondition({ type: 'jsonPath', path: '$.user.missing', op: 'exists' }, baseCtx),
    ).toBe(false)
  })

  it('contains', () => {
    expect(
      evaluateCondition(
        { type: 'jsonPath', path: '$.user.role', op: 'contains', value: 'min' },
        baseCtx,
      ),
    ).toBe(true)
  })
})

describe('evaluateCondition — XPath', () => {
  it('matches against XML body text', () => {
    expect(
      evaluateCondition(
        { type: 'xpath', expression: '//Status/text()', op: 'eq', value: 'PAID' },
        { ...baseCtx, bodyText: '<order><Status>PAID</Status></order>' },
      ),
    ).toBe(true)
  })

  it('exists', () => {
    expect(
      evaluateCondition(
        { type: 'xpath', expression: '//Status', op: 'exists' },
        { ...baseCtx, bodyText: '<order><Status>PAID</Status></order>' },
      ),
    ).toBe(true)
  })
})

describe('evaluateCondition — and / or', () => {
  it('and: all must match', () => {
    expect(
      evaluateCondition(
        {
          type: 'and',
          conditions: [
            { type: 'method', method: 'POST' },
            { type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' },
          ],
        },
        baseCtx,
      ),
    ).toBe(true)
  })

  it('and: short-circuits on first false', () => {
    expect(
      evaluateCondition(
        {
          type: 'and',
          conditions: [
            { type: 'method', method: 'GET' },
            { type: 'header', name: 'X-Tenant', op: 'eq', value: 'acme' },
          ],
        },
        baseCtx,
      ),
    ).toBe(false)
  })

  it('or: any can match', () => {
    expect(
      evaluateCondition(
        {
          type: 'or',
          conditions: [
            { type: 'method', method: 'GET' },
            { type: 'method', method: 'POST' },
          ],
        },
        baseCtx,
      ),
    ).toBe(true)
  })
})

// ─── renderTemplate ───────────────────────────────────────────────

const tCtx = {
  request: {
    method: 'GET',
    path: '/users/42',
    headers: { 'x-foo': 'bar' },
    query: { q: 'x' },
    params: { id: '42' },
    body: { name: 'Alice' },
    bodyText: '{"name":"Alice"}',
  },
}

describe('renderTemplate', () => {
  it('substitutes Handlebars variables', () => {
    expect(renderTemplate('Hello {{request.body.name}}!', tCtx)).toBe('Hello Alice!')
  })

  it('handles {{#if}}', () => {
    expect(
      renderTemplate('{{#if request.body.name}}has-name{{/if}}', tCtx),
    ).toBe('has-name')
  })

  it('substitutes path params', () => {
    expect(renderTemplate('id={{request.params.id}}', tCtx)).toBe('id=42')
  })

  it('substitutes query', () => {
    expect(renderTemplate('q={{request.query.q}}', tCtx)).toBe('q=x')
  })

  it('resolves request headers case-insensitively (#29)', () => {
    const ctx = {
      request: { ...tCtx.request, headers: { authorization: 'Bearer test-token-123' } },
    }
    // Lowercase, PascalCase, and uppercase must all resolve (RFC 7230 §3.2).
    expect(renderTemplate('{{request.headers.authorization}}', ctx)).toBe('Bearer test-token-123')
    expect(renderTemplate('{{request.headers.Authorization}}', ctx)).toBe('Bearer test-token-123')
    expect(renderTemplate('{{request.headers.AUTHORIZATION}}', ctx)).toBe('Bearer test-token-123')
  })

  it('header case-insensitivity also works inside {{#if}}', () => {
    const ctx = {
      request: { ...tCtx.request, headers: { authorization: 'Bearer x' } },
    }
    expect(
      renderTemplate('{{#if request.headers.Authorization}}yes{{else}}no{{/if}}', ctx),
    ).toBe('yes')
  })

  it('substitutes dynamic values', () => {
    const out = renderTemplate('{{$timestamp}}', tCtx)
    expect(/^\d+$/.test(out)).toBe(true)
  })

  it('renders {{$randomUUID}} as v4-shaped UUID', () => {
    const out = renderTemplate('{{$randomUUID}}', tCtx)
    expect(out).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('renders {{$randomInt(1,3)}} in range', () => {
    for (let i = 0; i < 10; i++) {
      const v = Number(renderTemplate('{{$randomInt(1,3)}}', tCtx))
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
    }
  })

  it('keeps non-template strings unchanged', () => {
    expect(renderTemplate('Hello world', tCtx)).toBe('Hello world')
  })

  it('json helper serializes', () => {
    expect(renderTemplate('{{json request.body}}', tCtx)).toBe('{"name":"Alice"}')
  })
})
