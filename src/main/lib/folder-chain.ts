/**
 * The ancestor folder chain of a request — the input of `resolveEffectiveAuth`
 * / `collectCascadeScripts` (`lib/auth-inheritance.ts`). Shared by the Runner
 * and the exports that must show a request's EFFECTIVE auth (`export:curl`,
 * OpenAPI, Insomnia — issue #276), so an `inherit` request resolves the same
 * way everywhere.
 */
import { getDb } from '../db/database'
import type { FolderRow } from '../db/project.repo'
import {
  projectAuthToAuthConfig,
  resolveEffectiveAuth,
  type AuthConfigLike,
} from './auth-inheritance'
import { loadProjectSettings } from './project-settings'

/**
 * Walk an endpoint's ancestor folder chain, outermost → innermost (leaf). Used
 * to resolve inherited auth and cascade scripts. Cycle-guarded so a corrupt
 * parent_id loop can't hang the run.
 */
export function buildFolderChain(folderId: string | null | undefined): FolderRow[] {
  if (!folderId) return []
  const db = getDb()
  const chain: FolderRow[] = []
  const seen = new Set<string>()
  let id: string | null = folderId
  while (id && !seen.has(id)) {
    seen.add(id)
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined
    if (!folder) break
    chain.unshift(folder)
    id = folder.parent_id
  }
  return chain
}

/**
 * Suite-item variant of buildFolderChain: walks `test_suite_folders` instead of
 * the APIs `folders` table so an imported collection's folder-level auth +
 * pre/post scripts cascade at run time (project → folder(s) → request). Adapts
 * each row to the FolderRow shape so it feeds the SAME resolveEffectiveAuth /
 * collectCascadeScripts the APIs path uses. `project_id` is unused by those and
 * filled with '' (test_suite_folders has no such column).
 */
export function buildSuiteFolderChain(folderId: string | null | undefined): FolderRow[] {
  if (!folderId) return []
  const db = getDb()
  const chain: FolderRow[] = []
  const seen = new Set<string>()
  let id: string | null = folderId
  while (id && !seen.has(id)) {
    seen.add(id)
    const f = db.prepare('SELECT * FROM test_suite_folders WHERE id = ?').get(id) as
      | {
          id: string
          parent_id: string | null
          name: string
          sort_order: number
          auth?: string | null
          pre_script?: string | null
          post_script?: string | null
        }
      | undefined
    if (!f) break
    chain.unshift({
      id: f.id,
      project_id: '',
      parent_id: f.parent_id,
      name: f.name,
      sort_order: f.sort_order,
      auth: f.auth ?? null,
      pre_script: f.pre_script ?? null,
      post_script: f.post_script ?? null,
    })
    id = f.parent_id
  }
  return chain
}

/** Which table a stored request lives in. */
export type StoredRequestRef =
  | { endpointId: string }
  | { savedRequestId: string }
  | { testSuiteItemId: string }

/**
 * The effective auth of a stored request: its own unless `inherit` / unset,
 * then the nearest folder's, then the project's (literal values included — the
 * caller decides what a file may carry). Same chain as Run.
 */
export async function resolveStoredRequestAuth(
  ref: StoredRequestRef,
  requestAuth: AuthConfigLike | null | undefined,
  projectId?: string | null,
): Promise<AuthConfigLike | null> {
  const db = getDb()
  let folderId: string | null = null
  let project = projectId ?? null
  let chain: FolderRow[] = []
  if ('endpointId' in ref) {
    const row = db
      .prepare('SELECT folder_id, project_id FROM endpoints WHERE id = ?')
      .get(ref.endpointId) as { folder_id: string | null; project_id: string } | undefined
    folderId = row?.folder_id ?? null
    project = project ?? row?.project_id ?? null
    chain = buildFolderChain(folderId)
  } else if ('savedRequestId' in ref) {
    const row = db
      .prepare('SELECT folder_id, project_id FROM saved_requests WHERE id = ?')
      .get(ref.savedRequestId) as { folder_id: string | null; project_id: string } | undefined
    folderId = row?.folder_id ?? null
    project = project ?? row?.project_id ?? null
    chain = buildFolderChain(folderId)
  } else {
    const row = db
      .prepare(
        `SELECT i.folder_id AS folder_id, s.project_id AS project_id
           FROM test_suite_items i JOIN test_suites s ON s.id = i.suite_id
          WHERE i.id = ?`,
      )
      .get(ref.testSuiteItemId) as { folder_id: string | null; project_id: string } | undefined
    folderId = row?.folder_id ?? null
    project = project ?? row?.project_id ?? null
    chain = buildSuiteFolderChain(folderId)
  }
  const settings = project ? await loadProjectSettings(project) : undefined
  return resolveEffectiveAuth(requestAuth, chain, projectAuthToAuthConfig(settings?.auth))
}
