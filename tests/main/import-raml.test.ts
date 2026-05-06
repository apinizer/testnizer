import { describe, it, expect } from 'vitest'
import { parseRamlSpec } from '../../src/main/ipc/import-export.handler'

// ─── Minimal RAML 1.0 with two top-level resources ──────────

describe('parseRamlSpec — minimal document', () => {
  const minimal = `#%RAML 1.0
title: My API
version: v1
baseUri: https://api.example.com/{version}

/users:
  get:
    description: List all users
  post:
    description: Create a user

/health:
  get:
    description: Healthcheck
`

  it('parses title / version / baseUri and resolves {version}', () => {
    const spec = parseRamlSpec(minimal)
    expect(spec.title).toBe('My API')
    expect(spec.version).toBe('v1')
    expect(spec.baseUri).toBe('https://api.example.com/{version}')
    expect(spec.resolvedBaseUri).toBe('https://api.example.com/v1')
  })

  it('extracts methods for each top-level resource', () => {
    const spec = parseRamlSpec(minimal)
    const summary = spec.endpoints.map((e) => `${e.method.method} ${e.fullPath}`).sort()
    expect(summary).toEqual(['GET /health', 'GET /users', 'POST /users'])
  })

  it('captures method description', () => {
    const spec = parseRamlSpec(minimal)
    const listUsers = spec.endpoints.find(
      (e) => e.method.method === 'GET' && e.fullPath === '/users',
    )
    expect(listUsers?.method.description).toBe('List all users')
  })
})

// ─── Nested resources with URI parameters ──────────────────

describe('parseRamlSpec — nested resources and URI parameters', () => {
  const nested = `#%RAML 1.0
title: Nested
baseUri: https://api.example.com

/users:
  get:
  /{id}:
    get:
      description: Get user by id
    /posts:
      get:
        description: Posts of a user
      /{postId}:
        delete:
          description: Delete a post
`

  it('walks nested resources to build full paths', () => {
    const spec = parseRamlSpec(nested)
    const paths = spec.endpoints
      .map((e) => `${e.method.method} ${e.fullPath}`)
      .sort()
    expect(paths).toEqual([
      'DELETE /users/{id}/posts/{postId}',
      'GET /users',
      'GET /users/{id}',
      'GET /users/{id}/posts',
    ])
  })

  it('preserves {id}-style URI parameters in the path', () => {
    const spec = parseRamlSpec(nested)
    const deletePost = spec.endpoints.find((e) => e.method.method === 'DELETE')
    expect(deletePost?.fullPath).toBe('/users/{id}/posts/{postId}')
  })

  it('falls back gracefully when version is absent for {version} substitution', () => {
    const noVersion = `#%RAML 1.0
title: T
baseUri: https://api.example.com/{version}
/x:
  get:
`
    const spec = parseRamlSpec(noVersion)
    // No version present → leave as-is rather than producing /undefined
    expect(spec.resolvedBaseUri).toBe('https://api.example.com/{version}')
  })
})

// ─── Methods with queryParameters, headers, and body ─────────

describe('parseRamlSpec — method details', () => {
  const detailed = `#%RAML 1.0
title: Detailed
baseUri: https://api.example.com

/search:
  get:
    queryParameters:
      q:
        description: Search term
        default: hello
      limit:
        description: Max results
        example: "10"
    headers:
      X-Trace:
        description: Trace id
        default: abc-123
  post:
    body:
      application/json:
        example: '{"q":"x"}'
`

  it('extracts queryParameters with default fallback to example', () => {
    const spec = parseRamlSpec(detailed)
    const get = spec.endpoints.find((e) => e.method.method === 'GET')
    expect(get?.method.queryParameters).toEqual([
      { name: 'q', description: 'Search term', defaultValue: 'hello' },
      { name: 'limit', description: 'Max results', defaultValue: '10' },
    ])
  })

  it('extracts headers', () => {
    const spec = parseRamlSpec(detailed)
    const get = spec.endpoints.find((e) => e.method.method === 'GET')
    expect(get?.method.headers).toEqual([
      { name: 'X-Trace', description: 'Trace id', defaultValue: 'abc-123' },
    ])
  })

  it('parses application/json body example', () => {
    const spec = parseRamlSpec(detailed)
    const post = spec.endpoints.find((e) => e.method.method === 'POST')
    expect(post?.method.body).toEqual({ type: 'json', content: '{"q":"x"}' })
  })

  it('returns body type:none when method has no body', () => {
    const spec = parseRamlSpec(detailed)
    const get = spec.endpoints.find((e) => e.method.method === 'GET')
    expect(get?.method.body).toEqual({ type: 'none' })
  })

  it('throws when input is not a YAML object', () => {
    expect(() => parseRamlSpec('#%RAML 1.0\n- just\n- a\n- list\n')).toThrow(
      /RAML root is not an object/,
    )
  })
})
