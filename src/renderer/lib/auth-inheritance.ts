/**
 * Renderer mirror of `src/main/lib/auth-inheritance.ts` — resolves a request's
 * inherited auth and cascade scripts for the **Send** path so a single request
 * behaves the same as it does in the Collection Runner.
 *
 * Auth = override (request → nearest folder → project); scripts = cascade
 * (project → outer folder → inner folder → request). Keep this in lockstep with
 * the main-process version (same "paralellik" class as env-vars / runner auth).
 */
import type { AuthConfig } from '../types'

export interface StoredProjectAuth {
  type?: 'none' | 'inherit' | 'basic' | 'bearer' | 'api-key'
  bearerToken?: string
  basicUser?: string
  basicPass?: string
  apiKeyKey?: string
  apiKeyValue?: string
  apiKeyIn?: 'header' | 'query'
}
export interface StoredProjectSettings {
  auth?: StoredProjectAuth
  preScript?: string
  testScript?: string
}

/** Minimal folder shape as returned by `window.api.folder.list` (auth is a
 *  JSON-encoded AuthConfig string). */
export interface FolderLike {
  id: string
  parent_id: string | null
  auth?: string | null
  pre_script?: string | null
  post_script?: string | null
}

export function projectAuthToAuthConfig(pa: StoredProjectAuth | undefined): AuthConfig | null {
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

export function parseFolderAuth(authStr: string | null | undefined): AuthConfig | undefined {
  if (!authStr) return undefined
  try {
    const a = JSON.parse(authStr) as AuthConfig
    return a && typeof a === 'object' && typeof a.type === 'string' ? a : undefined
  } catch {
    return undefined
  }
}

/** Override semantics, nearest wins: request → innermost folder → … → project.
 *  `inherit`/unset is transparent; explicit `none` halts inheritance. */
export function resolveEffectiveAuth(
  requestAuth: AuthConfig | null | undefined,
  foldersOuterToLeaf: FolderLike[],
  projectAuth: AuthConfig | null,
): AuthConfig | null {
  const levels: (AuthConfig | undefined)[] = [requestAuth ?? undefined]
  for (let i = foldersOuterToLeaf.length - 1; i >= 0; i--) {
    levels.push(parseFolderAuth(foldersOuterToLeaf[i].auth))
  }
  for (const lv of levels) {
    if (!lv || !lv.type || lv.type === 'inherit') continue
    if (lv.type === 'none') return null
    return lv
  }
  return projectAuth
}

/** Cascade scripts, top-down: project → outer folder → inner folder → request. */
export function collectCascadeScripts(
  foldersOuterToLeaf: FolderLike[],
  project: StoredProjectSettings | undefined,
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

/** Build the ancestor chain (outermost → innermost) for a folder id. */
export function buildFolderChain(
  folderId: string | null | undefined,
  byId: Map<string, FolderLike>,
): FolderLike[] {
  const chain: FolderLike[] = []
  const seen = new Set<string>()
  let id = folderId ?? null
  while (id && !seen.has(id)) {
    seen.add(id)
    const f = byId.get(id)
    if (!f) break
    chain.unshift(f)
    id = f.parent_id
  }
  return chain
}

interface ResolveInput {
  projectId: string | null | undefined
  endpointId?: string
  savedRequestId?: string
  requestAuth: AuthConfig | null | undefined
  requestPre: string | null | undefined
  requestPost: string | null | undefined
}

interface ResolveOutput {
  auth: AuthConfig | null
  preScripts: string[]
  postScripts: string[]
}

/**
 * Async orchestrator for the Send path: fetches the folder list, the request's
 * folder_id, and the project settings over IPC, then resolves effective auth +
 * cascade scripts. Best-effort — any failure falls back to the request's own
 * auth/scripts so Send never breaks on a settings/IPC hiccup.
 */
export async function resolveInheritance(input: ResolveInput): Promise<ResolveOutput> {
  const fallback: ResolveOutput = {
    auth: input.requestAuth && input.requestAuth.type !== 'inherit' ? input.requestAuth : null,
    preScripts: input.requestPre && input.requestPre.trim() ? [input.requestPre] : [],
    postScripts: input.requestPost && input.requestPost.trim() ? [input.requestPost] : [],
  }
  if (!input.projectId) return fallback

  try {
    const api = window.api as unknown as {
      folder?: { list?: (p: string) => Promise<{ success: boolean; data?: FolderLike[] }> }
      endpoint?: {
        get?: (id: string) => Promise<{ success: boolean; data?: { folder_id?: string | null } }>
      }
      savedRequest?: {
        get?: (id: string) => Promise<{ success: boolean; data?: { folder_id?: string | null } }>
      }
      settings?: {
        get?: (k: string) => Promise<{ success: boolean; data?: StoredProjectSettings }>
      }
    }

    // 1. Determine the request's folder_id.
    let folderId: string | null = null
    if (input.endpointId && api.endpoint?.get) {
      const r = await api.endpoint.get(input.endpointId)
      if (r?.success) folderId = r.data?.folder_id ?? null
    } else if (input.savedRequestId && api.savedRequest?.get) {
      const r = await api.savedRequest.get(input.savedRequestId)
      if (r?.success) folderId = r.data?.folder_id ?? null
    }

    // 2. Build the folder chain.
    let chain: FolderLike[] = []
    if (folderId && api.folder?.list) {
      const r = await api.folder.list(input.projectId)
      if (r?.success && Array.isArray(r.data)) {
        const byId = new Map(r.data.map((f) => [f.id, f]))
        chain = buildFolderChain(folderId, byId)
      }
    }

    // 3. Project-level settings.
    let projectSettings: StoredProjectSettings | undefined
    if (api.settings?.get) {
      const r = await api.settings.get(`project.${input.projectId}.settings`)
      if (r?.success && r.data && typeof r.data === 'object') projectSettings = r.data
    }

    const projectAuth = projectAuthToAuthConfig(projectSettings?.auth)
    const auth = resolveEffectiveAuth(input.requestAuth, chain, projectAuth)
    const { pre, post } = collectCascadeScripts(
      chain,
      projectSettings,
      input.requestPre,
      input.requestPost,
    )
    return { auth, preScripts: pre, postScripts: post }
  } catch {
    return fallback
  }
}
