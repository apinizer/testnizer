import { describe, it, expect } from 'vitest'
import {
  resolveVariables,
  resolveKeyValuePairs,
} from '../../src/renderer/lib/variable-resolver'

describe('resolveVariables', () => {
  it('returns empty/null templates as-is', () => {
    expect(resolveVariables('', {})).toBe('')
  })

  it('returns plain text without placeholders unchanged', () => {
    expect(resolveVariables('hello world', {})).toBe('hello world')
  })

  it('substitutes a single environment variable', () => {
    expect(resolveVariables('Hello {{name}}', { name: 'World' })).toBe('Hello World')
  })

  it('substitutes multiple variables in one template', () => {
    expect(
      resolveVariables('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Ada' }),
    ).toBe('Hi Ada!')
  })

  it('falls back to globals when env var is missing', () => {
    expect(
      resolveVariables('{{baseUrl}}/users', {}, { baseUrl: 'https://api.example.com' }),
    ).toBe('https://api.example.com/users')
  })

  it('prefers env over global when both define same key', () => {
    expect(
      resolveVariables('{{token}}', { token: 'env-token' }, { token: 'global-token' }),
    ).toBe('env-token')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(resolveVariables('Hi {{unknown}}!', {})).toBe('Hi {{unknown}}!')
  })

  it('trims whitespace inside placeholders', () => {
    expect(resolveVariables('{{  spaced  }}', { spaced: 'yes' })).toBe('yes')
  })

  it('resolves dynamic values starting with $', () => {
    const result = resolveVariables('{{$timestamp}}', {})
    expect(result).toMatch(/^\d+$/)
  })

  it('handles URL-style templates with multiple variables', () => {
    expect(
      resolveVariables('{{protocol}}://{{host}}:{{port}}/api', {
        protocol: 'https',
        host: 'example.com',
        port: '443',
      }),
    ).toBe('https://example.com:443/api')
  })
})

describe('resolveKeyValuePairs', () => {
  it('resolves variables in both keys and values', () => {
    const pairs = [
      { key: '{{headerName}}', value: '{{token}}', enabled: true },
      { key: 'static', value: '{{baseUrl}}/api', enabled: false },
    ]
    const result = resolveKeyValuePairs(
      pairs,
      { headerName: 'Authorization', token: 'abc123' },
      { baseUrl: 'https://x.com' },
    )
    expect(result).toEqual([
      { key: 'Authorization', value: 'abc123', enabled: true },
      { key: 'static', value: 'https://x.com/api', enabled: false },
    ])
  })

  it('preserves enabled flag', () => {
    const pairs = [{ key: 'a', value: 'b', enabled: false }]
    expect(resolveKeyValuePairs(pairs, {})[0].enabled).toBe(false)
  })

  it('returns empty array for empty input', () => {
    expect(resolveKeyValuePairs([], {})).toEqual([])
  })
})
