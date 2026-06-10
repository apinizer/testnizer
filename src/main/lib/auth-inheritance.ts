/**
 * Auth + script inheritance resolution for the request hierarchy
 * (request → folder(s) → project), shared shape used by the Collection Runner.
 *
 * Two semantics, both Postman-aligned:
 *   - **Auth = override**: the nearest level that sets a concrete auth wins.
 *     `inherit` / unset is transparent (look further up); an explicit `none`
 *     halts inheritance (means "deliberately no auth here").
 *   - **Scripts = cascade**: every level's pre/test script runs, top-down
 *     (project → outer folder → inner folder → request).
 *
 * Pure functions — the runner feeds them the folder chain (from the DB) and the
 * project settings (from electron-store). The renderer Send path mirrors this
 * logic; keep the two in lockstep.
 */

import type { FolderRow } from '../db/project.repo'
import type { StoredProjectAuth } from './project-settings'

/** Minimal AuthConfig shape — the engine's concrete auth object. */
export interface AuthConfigLike {
  type: string
  [k: string]: unknown
}

/**
 * Convert the project settings' flat ProjectAuth into a concrete AuthConfig.
 * Returns null for none/inherit/empty — the project is the top of the chain, so
 * an `inherit` there resolves to "no auth".
 */
export function projectAuthToAuthConfig(pa: StoredProjectAuth | undefined): AuthConfigLike | null {
  if (!pa || !pa.type || pa.type === 'none' || pa.type === 'inherit') return null
  switch (pa.type) {
    case 'bearer':
      return { type: 'bearer', bearer: { token: pa.bearerToken ?? '', prefix: 'Bearer' } }
    case 'basic':
      return {
        type: 'basic',
        basic: { username: pa.basicUser ?? '', password: pa.basicPass ?? '' },
      }
    case 'api-key':
      return {
        type: 'api-key',
        apiKey: {
          key: pa.apiKeyKey ?? '',
          value: pa.apiKeyValue ?? '',
          in: pa.apiKeyIn === 'query' ? 'query' : 'header',
        },
      }
    default:
      return null
  }
}

/** Parse a folder's JSON-encoded auth column into an AuthConfig (undefined when
 *  unset or malformed). */
export function parseFolderAuth(folder: FolderRow): AuthConfigLike | undefined {
  if (!folder.auth) return undefined
  try {
    const a = JSON.parse(folder.auth) as AuthConfigLike
    return a && typeof a === 'object' && typeof a.type === 'string' ? a : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the effective auth for a request. Override semantics, nearest wins:
 * request → innermost folder → … → outermost folder → project.
 *
 * @param requestAuth      the request's own auth (may be {type:'inherit'} / null)
 * @param foldersOuterToLeaf ancestor folders ordered outermost → innermost
 * @param projectAuth      already-converted project auth (null when none)
 */
export function resolveEffectiveAuth(
  requestAuth: AuthConfigLike | null | undefined,
  foldersOuterToLeaf: FolderRow[],
  projectAuth: AuthConfigLike | null,
): AuthConfigLike | null {
  // Walk bottom-up: request first, then folders from innermost to outermost.
  const levels: (AuthConfigLike | undefined)[] = [requestAuth ?? undefined]
  for (let i = foldersOuterToLeaf.length - 1; i >= 0; i--) {
    levels.push(parseFolderAuth(foldersOuterToLeaf[i]))
  }
  for (const lv of levels) {
    if (!lv || !lv.type || lv.type === 'inherit') continue
    if (lv.type === 'none') return null // explicit "no auth" halts inheritance
    return lv
  }
  return projectAuth
}

/**
 * Collect cascade pre/test scripts, top-down: project → outer folder → inner
 * folder → request. Empty / whitespace-only scripts are dropped.
 */
export function collectCascadeScripts(
  foldersOuterToLeaf: FolderRow[],
  project: { preScript?: string; testScript?: string } | undefined,
  requestPre: string | null | undefined,
  requestPost: string | null | undefined,
): { pre: string[]; post: string[] } {
  const pre: string[] = []
  const post: string[] = []
  const add = (arr: string[], s: string | null | undefined): void => {
    if (s && s.trim()) arr.push(s)
  }
  add(pre, project?.preScript)
  add(post, project?.testScript)
  for (const f of foldersOuterToLeaf) {
    add(pre, f.pre_script)
    add(post, f.post_script)
  }
  add(pre, requestPre)
  add(post, requestPost)
  return { pre, post }
}
