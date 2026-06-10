/**
 * Renderer mirror of the auth/script inheritance resolver. Kept in lockstep
 * with tests/main/auth-inheritance.test.ts (the "paralellik" class).
 */
import { describe, it, expect } from 'vitest'
import {
  projectAuthToAuthConfig,
  resolveEffectiveAuth,
  collectCascadeScripts,
  buildFolderChain,
  type FolderLike,
} from '../../src/renderer/lib/auth-inheritance'
import type { AuthConfig } from '../../src/renderer/types'

const folder = (p: Partial<FolderLike>): FolderLike => ({
  id: p.id ?? 'f',
  parent_id: p.parent_id ?? null,
  auth: p.auth ?? null,
  pre_script: p.pre_script ?? null,
  post_script: p.post_script ?? null,
})
const bearer = (token: string): AuthConfig => ({ type: 'bearer', bearer: { token, prefix: 'Bearer' } })

describe('renderer projectAuthToAuthConfig', () => {
  it('maps bearer / returns null for inherit', () => {
    expect(projectAuthToAuthConfig({ type: 'bearer', bearerToken: '{{t}}' })).toEqual(bearer('{{t}}'))
    expect(projectAuthToAuthConfig({ type: 'inherit' })).toBeNull()
  })
})

describe('renderer resolveEffectiveAuth', () => {
  const proj = bearer('PROJ')
  it('request concrete wins; inherit walks to nearest folder; none halts', () => {
    expect(resolveEffectiveAuth(bearer('REQ'), [folder({ auth: JSON.stringify(bearer('F')) })], proj)).toEqual(
      bearer('REQ'),
    )
    const outer = folder({ id: 'o', auth: JSON.stringify(bearer('OUT')) })
    const inner = folder({ id: 'i', parent_id: 'o', auth: JSON.stringify(bearer('IN')) })
    expect(resolveEffectiveAuth({ type: 'inherit' }, [outer, inner], proj)).toEqual(bearer('IN'))
    expect(resolveEffectiveAuth({ type: 'none' }, [], proj)).toBeNull()
    expect(resolveEffectiveAuth({ type: 'inherit' }, [], proj)).toEqual(proj)
  })
})

describe('renderer collectCascadeScripts + buildFolderChain', () => {
  it('orders project → outer → inner → request', () => {
    const outer = folder({ id: 'o', pre_script: 'OUT' })
    const inner = folder({ id: 'i', parent_id: 'o', pre_script: 'IN' })
    const { pre } = collectCascadeScripts(
      [outer, inner],
      { preScript: 'PROJ', testScript: '' },
      'REQ',
      null,
    )
    expect(pre).toEqual(['PROJ', 'OUT', 'IN', 'REQ'])
  })

  it('buildFolderChain returns outermost → innermost', () => {
    const outer = folder({ id: 'o' })
    const inner = folder({ id: 'i', parent_id: 'o' })
    const byId = new Map([
      ['o', outer],
      ['i', inner],
    ])
    expect(buildFolderChain('i', byId).map((f) => f.id)).toEqual(['o', 'i'])
  })
})
