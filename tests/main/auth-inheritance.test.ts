/**
 * Pure-function coverage for the auth + script inheritance resolver
 * (request → folder(s) → project). No DB / electron — just the algorithm.
 */
import { describe, it, expect } from 'vitest'
import {
  projectAuthToAuthConfig,
  resolveEffectiveAuth,
  parseFolderAuth,
  collectCascadeScripts,
  type AuthConfigLike,
} from '../../src/main/lib/auth-inheritance'
import type { FolderRow } from '../../src/main/db/project.repo'

function folder(partial: Partial<FolderRow>): FolderRow {
  return {
    id: partial.id ?? 'f',
    project_id: 'p',
    parent_id: partial.parent_id ?? null,
    name: partial.name ?? 'F',
    sort_order: 0,
    auth: partial.auth ?? null,
    pre_script: partial.pre_script ?? null,
    post_script: partial.post_script ?? null,
  }
}

const bearer = (token: string): AuthConfigLike => ({
  type: 'bearer',
  bearer: { token, prefix: 'Bearer' },
})

describe('projectAuthToAuthConfig', () => {
  it('maps bearer/basic/api-key', () => {
    expect(projectAuthToAuthConfig({ type: 'bearer', bearerToken: '{{tok}}' })).toEqual({
      type: 'bearer',
      bearer: { token: '{{tok}}', prefix: 'Bearer' },
    })
    expect(projectAuthToAuthConfig({ type: 'basic', basicUser: 'u', basicPass: 'p' })).toEqual({
      type: 'basic',
      basic: { username: 'u', password: 'p' },
    })
    expect(
      projectAuthToAuthConfig({ type: 'api-key', apiKeyKey: 'k', apiKeyValue: 'v', apiKeyIn: 'query' }),
    ).toEqual({ type: 'api-key', apiKey: { key: 'k', value: 'v', in: 'query' } })
  })

  it('returns null for none/inherit/undefined', () => {
    expect(projectAuthToAuthConfig(undefined)).toBeNull()
    expect(projectAuthToAuthConfig({ type: 'none' })).toBeNull()
    expect(projectAuthToAuthConfig({ type: 'inherit' })).toBeNull()
  })
})

describe('parseFolderAuth', () => {
  it('parses JSON auth, tolerates null/garbage', () => {
    expect(parseFolderAuth(folder({ auth: JSON.stringify(bearer('x')) }))).toEqual(bearer('x'))
    expect(parseFolderAuth(folder({ auth: null }))).toBeUndefined()
    expect(parseFolderAuth(folder({ auth: 'not json' }))).toBeUndefined()
  })
})

describe('resolveEffectiveAuth — override, nearest wins', () => {
  const projectAuth = bearer('{{projectTok}}')

  it('request concrete auth wins over everything', () => {
    const f = folder({ auth: JSON.stringify(bearer('folderTok')) })
    expect(resolveEffectiveAuth(bearer('reqTok'), [f], projectAuth)).toEqual(bearer('reqTok'))
  })

  it('request inherit → nearest folder wins', () => {
    const outer = folder({ id: 'o', auth: JSON.stringify(bearer('outerTok')) })
    const inner = folder({ id: 'i', parent_id: 'o', auth: JSON.stringify(bearer('innerTok')) })
    // foldersOuterToLeaf = [outer, inner] → innermost (inner) wins
    expect(resolveEffectiveAuth({ type: 'inherit' }, [outer, inner], projectAuth)).toEqual(
      bearer('innerTok'),
    )
  })

  it('request inherit + folder inherit/unset → project', () => {
    const f = folder({ auth: null }) // unset = transparent
    expect(resolveEffectiveAuth({ type: 'inherit' }, [f], projectAuth)).toEqual(projectAuth)
  })

  it('explicit none at request halts inheritance → no auth', () => {
    expect(resolveEffectiveAuth({ type: 'none' }, [], projectAuth)).toBeNull()
  })

  it('explicit none at folder halts inheritance even when project has auth', () => {
    const f = folder({ auth: JSON.stringify({ type: 'none' }) })
    expect(resolveEffectiveAuth({ type: 'inherit' }, [f], projectAuth)).toBeNull()
  })

  it('no request/folder auth → project fallback; none anywhere → null', () => {
    expect(resolveEffectiveAuth({ type: 'inherit' }, [], projectAuth)).toEqual(projectAuth)
    expect(resolveEffectiveAuth({ type: 'inherit' }, [], null)).toBeNull()
  })
})

describe('collectCascadeScripts — top-down order', () => {
  it('orders project → outer → inner → request and drops empties', () => {
    const outer = folder({ id: 'o', pre_script: 'OUTER_PRE', post_script: '  ' })
    const inner = folder({ id: 'i', pre_script: 'INNER_PRE', post_script: 'INNER_POST' })
    const { pre, post } = collectCascadeScripts(
      [outer, inner],
      { preScript: 'PROJ_PRE', testScript: 'PROJ_TEST' },
      'REQ_PRE',
      '',
    )
    expect(pre).toEqual(['PROJ_PRE', 'OUTER_PRE', 'INNER_PRE', 'REQ_PRE'])
    // outer.post is whitespace (dropped), request post is '' (dropped)
    expect(post).toEqual(['PROJ_TEST', 'INNER_POST'])
  })

  it('handles missing project settings', () => {
    const { pre, post } = collectCascadeScripts([], undefined, 'REQ', undefined)
    expect(pre).toEqual(['REQ'])
    expect(post).toEqual([])
  })
})
