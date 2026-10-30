/**
 * Postman collection v2.0 / v2.1 → Testnizer folders, endpoints, examples and
 * project variables (issues #276 / #281). The v1 converter and the legacy data dump
 * feed the same function.
 *
 * ALL-OR-NOTHING: the whole import runs in one SQLite transaction. Bad items
 * are normalised or skipped with a warning (`normalize.ts`); anything that
 * still throws rolls everything back — no half-imported collection is left
 * behind (it used to be: the rows before the failing item stayed).
 *
 * Auth inheritance (APIs import only, `apisTree`): a request without its own
 * auth is stored as `{type:'inherit'}` whenever an ancestor carries the auth —
 * a Postman folder's auth lives on its folder row, and the COLLECTION auth is
 * placed on the import's own (empty) folder, or on the project when the
 * collection lands at the project root, the project has no auth yet and the
 * type is one project auth can hold (basic / bearer / API key) with only
 * `{{variable}}` credentials. Literal credentials stay baked onto each request
 * as before: project-auth credentials never leave the machine (issue #177
 * rule 5), baked request auth travels with the collection — moving a literal
 * token into project auth would silently drop it from git and exports. Send
 * (renderer `resolveInheritance`) and Run (`resolveEffectiveAuth`) resolve the
 * same chain, so the effective auth is unchanged. Parser-style callers (the
 * Tests-panel suite import) keep the old shape: auth baked onto each request.
 */
import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { getDb } from '../../db/database'
import { readSharedProjectSettings, writeSharedProjectSettings } from '../../lib/project-settings'
import { isVariableReferenceOnly } from '../../lib/local-secrets'
import { invalidateSecretInventory } from '../../lib/secret-inventory-cache'
import { stripExportedAssertions } from '../../../shared/assertions-to-script'
import type {
  PostmanAuth,
  PostmanCollection,
  PostmanItem,
  PostmanRequest,
  PostmanResponse,
  PostmanUrl,
} from './types'
import {
  descriptionText,
  extractPath,
  genKvId,
  itemLabel,
  normalizeHeaders,
  normalizeRequest,
  reconstructPostmanUrl,
  toText,
} from './normalize'
import { mapPostmanAuth, type AuthConfigLike } from './auth'
import { mapPostmanBody, type UiBody } from './body'
import { extractEventScripts, vaultReferences, type ExtractedScripts } from './scripts'
import { mergePpb, ppbToRequestSettings, reportUnsupportedPpb } from './settings'
import { insertExamples, type ExampleRequestSide } from './examples'
import { toVariableRow, writeProjectVariables, type SourcedVariable } from './environment'
import {
  X_APINIZER_RESTORED_KINDS,
  apinizerRowTypeToBodyType,
  isRawFamilyBodyType,
  xApinizerAssertionsToUi,
  xApinizerVersionOk,
} from './x-apinizer'

export interface PostmanImportOptions {
  /**
   * APIs-tree import (the `import:postman` IPC): collection-level scripts and
   * auth go to the project (or the import's own folder), requests inherit,
   * saved examples are written. Off for parser-style callers — the
   * Tests-panel suite import must not change the project, and it deletes the
   * endpoints it materialises (their examples would be orphaned).
   */
  apisTree?: boolean
  /**
   * Postman v3 (issue #276 part 2): items of a request kind Testnizer keeps
   * as its own protocol (GraphQL, gRPC, WebSocket, Socket.IO, MCP, AI Chat)
   * carry no v2 `request`. The hook writes such an item and returns its
   * endpoint id, or null for an ordinary item.
   */
  nativeItem?: (item: PostmanItem, ctx: NativeItemContext) => string | null
}

/** What the walker hands `nativeItem` for one item. */
export interface NativeItemContext {
  db: Database
  projectId: string
  parentFolderId: string | null
  label: string
  /** What a request without its own auth gets: `inherit` (an ancestor carries it), a baked auth, or null. */
  inheritedAuth: AuthConfigLike | null
  /** An ancestor folder / the collection defines auth. */
  ancestorAuth: boolean
  sortOrder: number
  now: number
  warnings: string[]
}

export interface PostmanImportResult {
  success: boolean
  error?: string
  collectionId?: string
  endpointCount?: number
  folderCount?: number
  endpointIds?: string[]
  exampleCount?: number
  environmentId?: string
  environmentName?: string
  suggestedEnvVars?: Record<string, string>
  warnings?: string[]
}

/** Counters shared across collections of one import (a dump imports several). */
export interface ImportCounters {
  endpointCount: number
  folderCount: number
  exampleCount: number
  endpointIds: string[]
  /** Monotonic timestamp source: examples keep their file order. */
  clock: () => number
}

export function newCounters(now: number): ImportCounters {
  let t = now
  return { endpointCount: 0, folderCount: 0, exampleCount: 0, endpointIds: [], clock: () => t++ }
}

interface UiKv {
  id: string
  key: string
  value: string
  description?: string
  enabled: boolean
}

/** Where the collection-level auth ended up. */
type AuthPlacement = 'none' | 'folder' | 'project' | 'bake'

interface WalkCtx {
  path: string[]
  /** Nearest mapped auth to bake onto a request that has none (parser mode / fallback). */
  bakedAuth: AuthConfigLike | null
  /** An ancestor (folder row / import folder / project) carries the auth → `inherit` resolves it. */
  inheritCarrier: boolean
  ppb: Record<string, unknown> | undefined
}

const PROJECT_AUTH_TYPES = new Set(['basic', 'bearer', 'api-key'])

function folderIsEmpty(db: Database, folderId: string): boolean {
  const row = db
    .prepare('SELECT auth, pre_script, post_script FROM folders WHERE id = ?')
    .get(folderId) as
    | { auth: string | null; pre_script: string | null; post_script: string | null }
    | undefined
  if (
    !row ||
    row.auth ||
    (row.pre_script && row.pre_script.trim()) ||
    (row.post_script && row.post_script.trim())
  )
    return false
  const child =
    db.prepare('SELECT 1 FROM folders WHERE parent_id = ? LIMIT 1').get(folderId) ??
    db.prepare('SELECT 1 FROM endpoints WHERE folder_id = ? LIMIT 1').get(folderId) ??
    db.prepare('SELECT 1 FROM saved_requests WHERE folder_id = ? LIMIT 1').get(folderId)
  return !child
}

/** Mapped collection auth → the flat project-auth shape (`StoredProjectAuth`). */
function toProjectAuth(a: AuthConfigLike): Record<string, unknown> | null {
  if (a.type === 'bearer') {
    const b = a.bearer as { token?: string } | undefined
    return { type: 'bearer', bearerToken: b?.token ?? '' }
  }
  if (a.type === 'basic') {
    const b = a.basic as { username?: string; password?: string } | undefined
    return { type: 'basic', basicUser: b?.username ?? '', basicPass: b?.password ?? '' }
  }
  if (a.type === 'api-key') {
    const k = a.apiKey as { key?: string; value?: string; in?: string } | undefined
    return {
      type: 'api-key',
      apiKeyKey: k?.key ?? '',
      apiKeyValue: k?.value ?? '',
      apiKeyIn: k?.in === 'query' ? 'query' : 'header',
    }
  }
  return null
}

/** Credential fields empty or `{{var}}`-only → safe to keep in project auth (#177 rule 5). */
function credentialsAreReferences(pa: Record<string, unknown>): boolean {
  for (const f of ['bearerToken', 'basicPass', 'apiKeyValue']) {
    const v = pa[f]
    if (typeof v === 'string' && v !== '' && !isVariableReferenceOnly(v)) return false
  }
  return true
}

function projectHasAuth(projectId: string): boolean {
  const auth = readSharedProjectSettings(projectId)?.auth as { type?: string } | undefined
  return !!auth?.type && auth.type !== 'none' && auth.type !== 'inherit'
}

/** Decide where the collection auth lives (see the module comment). */
function placeCollectionAuth(
  db: Database,
  projectId: string,
  rootFolderId: string | null,
  rootFolderEmpty: boolean,
  collAuth: AuthConfigLike | null,
  opts: PostmanImportOptions,
): AuthPlacement {
  if (!collAuth) return 'none'
  if (!opts.apisTree) return 'bake'
  if (rootFolderId) {
    if (!rootFolderEmpty) return 'bake'
    db.prepare('UPDATE folders SET auth = ? WHERE id = ?').run(
      JSON.stringify(collAuth),
      rootFolderId,
    )
    return 'folder'
  }
  if (projectHasAuth(projectId)) return 'bake'
  if (collAuth.type === 'none') return 'project' // nothing to write: no project auth = no auth
  if (!PROJECT_AUTH_TYPES.has(collAuth.type)) return 'bake'
  const pa = toProjectAuth(collAuth)
  if (!pa || !credentialsAreReferences(pa)) return 'bake'
  writeSharedProjectSettings(projectId, { auth: pa })
  return 'project'
}

/**
 * Collection-level `event` scripts. APIs import: into the import's own empty
 * folder (they cascade to exactly the collection's requests), else into the
 * project's scripts at the project root (issue #270). Never overwrites an
 * existing script; every case that does not import is reported.
 */
function placeCollectionScripts(
  db: Database,
  projectId: string,
  rootFolderId: string | null,
  rootFolderEmpty: boolean,
  scripts: ExtractedScripts,
  opts: PostmanImportOptions,
  warnings: string[],
): void {
  const incoming: Array<{ key: 'preScript' | 'testScript'; label: string; text?: string }> = [
    { key: 'preScript', label: 'pre-request', text: scripts.preScript },
    { key: 'testScript', label: 'test', text: scripts.postScript },
  ]
  const present = incoming.filter((s) => s.text && s.text.trim())
  if (present.length === 0) return
  if (!opts.apisTree) {
    warnings.push('Collection-level scripts were not imported.')
    return
  }
  if (rootFolderId) {
    if (!rootFolderEmpty) {
      for (const s of present)
        warnings.push(
          `The collection-level ${s.label} script was not imported: the collection went into a folder that already has content. ` +
            'Add it in that folder’s settings if its requests need it.',
        )
      return
    }
    db.prepare('UPDATE folders SET pre_script = ?, post_script = ? WHERE id = ?').run(
      scripts.preScript?.trim() ? scripts.preScript : null,
      scripts.postScript?.trim() ? scripts.postScript : null,
      rootFolderId,
    )
    return
  }
  const current = readSharedProjectSettings(projectId) ?? {}
  const next: Record<string, unknown> = {}
  for (const s of present) {
    const existing = current[s.key]
    if (typeof existing === 'string' && existing.trim()) {
      warnings.push(
        `The collection-level ${s.label} script was not imported: this project already has one.`,
      )
    } else {
      next[s.key] = s.text
    }
  }
  if (Object.keys(next).length > 0) writeSharedProjectSettings(projectId, next)
}

/** Folder / request `variable[]` of the whole tree, with where each came from. */
function collectTreeVariables(
  items: PostmanItem[],
  path: string[],
  out: SourcedVariable[],
  warnings: string[],
): void {
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const where = `"${itemLabel(path, item.name)}"`
    if (Array.isArray(item.variable)) {
      for (const v of item.variable) {
        const row = toVariableRow(v, where, warnings, 'disabled')
        if (row) out.push({ row, where })
      }
    }
    if (Array.isArray(item.item))
      collectTreeVariables(item.item, [...path, item.name || 'Folder'], out, warnings)
  }
}

/** Path variables (`url.variable[]`) of a request, `:name` kept in the URL. */
function pathVariablesOf(url: PostmanUrl | string | undefined): Array<{
  id: string
  key: string
  value: string
  description?: string
}> {
  if (!url || typeof url === 'string' || !Array.isArray(url.variable)) return []
  const out: Array<{ id: string; key: string; value: string; description?: string }> = []
  for (const v of url.variable) {
    if (!v || typeof v !== 'object' || typeof v.key !== 'string' || !v.key) continue
    out.push({
      id: genKvId(),
      key: v.key,
      value: toText(v.value),
      description: descriptionText(v.description) ?? undefined,
    })
  }
  return out
}

function headerRows(h: unknown): UiKv[] {
  return normalizeHeaders(h).map((x) => ({
    id: genKvId(),
    key: x.key ?? '',
    value: x.value ?? '',
    description: typeof x.description === 'string' ? x.description : undefined,
    enabled: !x.disabled,
  }))
}

function queryRows(url: PostmanUrl | string | undefined): UiKv[] {
  if (!url || typeof url === 'string' || !Array.isArray(url.query)) return []
  return url.query
    .filter((q) => q && typeof q === 'object')
    .map((q) => ({
      id: genKvId(),
      key: toText(q.key),
      value: toText(q.value),
      description: descriptionText(q.description) ?? undefined,
      enabled: !q.disabled,
    }))
}

/** The editor shape of a request (shared by endpoints and example `originalRequest`s). */
function requestParts(
  req: PostmanRequest,
  label: string,
  warnings: string[],
): { method: string; url: string; params: UiKv[]; headers: UiKv[]; body: UiBody } {
  return {
    method: (toText(req.method) || 'GET').toUpperCase(),
    url: reconstructPostmanUrl(req.url),
    params: queryRows(req.url),
    headers: headerRows(req.header),
    body: mapPostmanBody(req.body, label, warnings),
  }
}

/**
 * Import ONE collection into `projectId` under `rootFolderId`. Must run inside
 * the caller's transaction; throws on an unexpected failure (→ rollback).
 */
export function importCollectionTx(
  db: Database,
  projectId: string,
  collection: PostmanCollection,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
  counters: ImportCounters,
  warnings: string[],
  now: number,
): {
  suggestedEnvVars: Record<string, string>
  /** Variables added to the project variables (issue #281). */
  projectVariableCount: number
  /** Never set any more (collection variables are project variables, issue #281). */
  environmentId?: string
  environmentName?: string
} {
  const projectRow = db
    .prepare('SELECT workspace_id, description FROM projects WHERE id = ?')
    .get(projectId) as { workspace_id: string; description: string | null } | undefined
  if (!projectRow) throw new Error('Project not found: ' + projectId)

  const collName = toText(collection.info?.name) || 'Postman collection'
  const collLabel = `Collection "${collName}"`
  const items = Array.isArray(collection.item) ? collection.item : []

  const schema = toText(collection.info?.schema)
  if (schema && !/postman|getpostman/i.test(schema)) {
    warnings.push(`Unknown collection schema "${schema}" — importing best-effort.`)
  }

  // The import's own folder: an empty folder (the modal's "new folder", a
  // dump's wrapper) can take the collection's auth and scripts.
  const rootFolderEmpty = rootFolderId ? folderIsEmpty(db, rootFolderId) : false

  // ── Variables → project variables (issue #281) ───────────────────────
  // A Testnizer project is the Postman collection: its variables become the
  // project variables ("Globals" — `pm.collectionVariables`), always active
  // below the environment, so they resolve whichever environment is active.
  const suggestedEnvVars: Record<string, string> = {}
  const vars: SourcedVariable[] = []
  for (const v of Array.isArray(collection.variable) ? collection.variable : []) {
    const row = toVariableRow(v, collLabel, warnings, 'disabled')
    if (!row) continue
    suggestedEnvVars[row.key] = row.value
    vars.push({ row, where: collLabel })
  }
  const treeVars: SourcedVariable[] = []
  collectTreeVariables(items, [], treeVars, warnings)
  const scoped = new Map<string, string[]>()
  for (const tv of treeVars) scoped.set(tv.where, [...(scoped.get(tv.where) ?? []), tv.row.key])
  for (const [where, keys] of scoped) {
    warnings.push(
      `${where}: folder/request variables (${keys.join(', ')}) have no folder scope in Testnizer; ` +
        `they were added to the project's Globals and apply to every request.`,
    )
  }
  const { added: projectVariableCount } = writeProjectVariables(
    projectId,
    projectRow.workspace_id,
    [...vars, ...treeVars],
    collLabel,
    warnings,
  )

  // ── Collection description, auth, scripts, behaviour ──────────────────
  const collDescription = descriptionText(collection.info?.description)
  if (collDescription && opts.apisTree) {
    if (!rootFolderId && !(projectRow.description ?? '').trim()) {
      db.prepare('UPDATE projects SET description = ? WHERE id = ?').run(collDescription, projectId)
    } else {
      warnings.push(
        `${collLabel}: the collection description was not imported (${
          rootFolderId
            ? 'folders have no description field'
            : 'the project already has a description'
        }).`,
      )
    }
  }
  const collAuth = mapPostmanAuth(collection.auth ?? undefined, collLabel, warnings)
  const placement = placeCollectionAuth(
    db,
    projectId,
    rootFolderId,
    rootFolderEmpty,
    collAuth,
    opts,
  )
  placeCollectionScripts(
    db,
    projectId,
    rootFolderId,
    rootFolderEmpty,
    extractEventScripts(collection.event, collLabel, warnings),
    opts,
    warnings,
  )
  reportUnsupportedPpb(collection.protocolProfileBehavior, collLabel, warnings)

  const insertFolder = db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertEndpoint = db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const undocumentedFolders: string[] = []

  const walk = (list: PostmanItem[], parentFolderId: string | null, ctx: WalkCtx): void => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const label = itemLabel(ctx.path, item.name)
      const isFolder = Array.isArray(item.item) && !item.request
      if (isFolder) {
        const folderId = randomUUID()
        // Folder-level cascade metadata — a Postman "Setup folder → token
        // pre-request script → Bearer inherit" pattern survives import.
        const folderScripts = extractEventScripts(item.event, label, warnings)
        const folderAuth = mapPostmanAuth(item.auth ?? undefined, label, warnings)
        if (descriptionText(item.description)) undocumentedFolders.push(label)
        reportUnsupportedPpb(item.protocolProfileBehavior, label, warnings)
        insertFolder.run(
          folderId,
          projectId,
          parentFolderId,
          toText(item.name) || 'Folder',
          counters.folderCount,
          folderAuth ? JSON.stringify(folderAuth) : null,
          folderScripts.preScript ?? null,
          folderScripts.postScript ?? null,
        )
        counters.folderCount++
        walk(item.item ?? [], folderId, {
          path: [...ctx.path, toText(item.name) || 'Folder'],
          bakedAuth: folderAuth ?? ctx.bakedAuth,
          inheritCarrier: ctx.inheritCarrier || !!folderAuth,
          ppb: mergePpb(ctx.ppb, item.protocolProfileBehavior),
        })
        continue
      }

      if (opts.nativeItem) {
        const nativeId = opts.nativeItem(item, {
          db,
          projectId,
          parentFolderId,
          label,
          inheritedAuth: opts.apisTree && ctx.inheritCarrier ? { type: 'inherit' } : ctx.bakedAuth,
          ancestorAuth: ctx.inheritCarrier || !!ctx.bakedAuth,
          sortOrder: counters.endpointCount,
          now,
          warnings,
        })
        if (nativeId) {
          counters.endpointIds.push(nativeId)
          counters.endpointCount++
          continue
        }
      }

      const req = normalizeRequest(item.request)
      if (!req) {
        warnings.push(`Skipped item "${item.name ?? '(unnamed)'}" — no request body`)
        continue
      }

      const parts = requestParts(req, label, warnings)
      const { method, url } = parts
      const path = extractPath(url)

      // Skip Postman placeholder items that have neither a URL nor a name —
      // those show up after some Postman collection-builder operations and
      // surfaced as the stray "GET New Request" in v1.3.1 B16.
      const looksLikePlaceholder =
        !url.trim() && (!item.name || /^new request$/i.test(item.name.trim()))
      if (looksLikePlaceholder) {
        warnings.push(`Skipped empty placeholder item "${item.name ?? '(unnamed)'}"`)
        continue
      }

      const ownAuth = mapPostmanAuth(req.auth ?? undefined, label, warnings)
      const auth: AuthConfigLike | null =
        ownAuth ?? (opts.apisTree && ctx.inheritCarrier ? { type: 'inherit' } : ctx.bakedAuth)

      const { preScript, postScript } = extractEventScripts(item.event, label, warnings)
      reportUnsupportedPpb(item.protocolProfileBehavior, label, warnings)
      const settings = ppbToRequestSettings(mergePpb(ctx.ppb, item.protocolProfileBehavior))

      const vault = vaultReferences(JSON.stringify(req))
      if (vault.length > 0) {
        warnings.push(
          `"${label}": uses Postman Vault reference(s) ${vault.map((v) => `{{vault:${v}}}`).join(', ')} — Testnizer keeps vault values as this project's secret variables (Globals, which pm.vault reads): replace each with {{name}} and enter its value there as a secret variable.`,
        )
      }
      if (req.proxy || req.certificate) {
        warnings.push(
          `"${label}": the request-level ${[req.proxy ? 'proxy' : '', req.certificate ? 'certificate' : ''].filter(Boolean).join(' and ')} setting was not imported (configure it in Settings).`,
        )
      }

      const requestSchema: Record<string, unknown> = {
        url,
        method,
        params: parts.params,
        headers: parts.headers,
        body: parts.body,
      }
      if (auth) requestSchema.auth = auth
      if (preScript) requestSchema.preScript = preScript
      if (postScript) requestSchema.postScript = postScript
      Object.assign(requestSchema, settings)
      // `:name` values → the Params tab's Path Variables (issue #276);
      // Send / Run / codegen substitute them (`src/shared/path-variables.ts`).
      const pathVariables = pathVariablesOf(req.url)
      if (pathVariables.length > 0) requestSchema.pathVariables = pathVariables

      // ── Apinizer interop: fold x-apinizer fidelity back in (additive) ──
      const xa = item['x-apinizer']
      if (xa && xApinizerVersionOk(xa)) {
        const xaAssertions = xApinizerAssertionsToUi(xa.assertions, warnings)
        if (xaAssertions.length > 0) {
          requestSchema.assertions = xaAssertions
          // Our own export (issue #270) also wrote these rows as generated
          // pm.test code — keep only the tests x-apinizer does not restore.
          if (typeof requestSchema.postScript === 'string') {
            const kept = stripExportedAssertions(
              requestSchema.postScript,
              X_APINIZER_RESTORED_KINDS,
            )
            if (kept) requestSchema.postScript = kept
            else delete requestSchema.postScript
          }
        }
        const refinedBodyType = apinizerRowTypeToBodyType(xa.bodyRowType)
        if (refinedBodyType && isRawFamilyBodyType(parts.body.type)) {
          parts.body.type = refinedBodyType
        }
        // Apinizer carries seconds; Testnizer's one timeout key is the
        // top-level `timeout` in ms (issue #185). Apinizer's 0 means "use the
        // default" — left unset (inherit), never `timeout: 0` (= no limit).
        if (
          typeof xa.timeoutSeconds === 'number' &&
          Number.isFinite(xa.timeoutSeconds) &&
          xa.timeoutSeconds > 0
        ) {
          requestSchema.timeout = Math.round(xa.timeoutSeconds * 1000)
        }
        // Testnizer's Critical flag (issue #304) — the row's top-level key.
        if (xa.critical === true) requestSchema.critical = true
      } else if (xa) {
        warnings.push(
          `Ignored x-apinizer extension with unsupported schemaVersion "${
            xa.schemaVersion ?? '(none)'
          }" on "${item.name ?? '(unnamed)'}" — imported as plain Postman.`,
        )
      }

      const endpointId = randomUUID()
      insertEndpoint.run(
        endpointId,
        projectId,
        parentFolderId,
        toText(item.name) || `${method} ${path}`,
        descriptionText(req.description) ?? descriptionText(item.description),
        'http',
        method,
        path || '/',
        'developing',
        JSON.stringify(requestSchema),
        null,
        counters.endpointCount,
        now,
        now,
      )
      counters.endpointIds.push(endpointId)
      counters.endpointCount++

      const responses = Array.isArray(item.response) ? item.response : []
      if (responses.length > 0) {
        if (opts.apisTree) {
          counters.exampleCount += insertExamples({
            db,
            projectId,
            endpointId,
            responses,
            label,
            warnings,
            clock: counters.clock,
            requestSide: (r: PostmanResponse): ExampleRequestSide => {
              const orig = normalizeRequest(r.originalRequest) ?? req
              const p = requestParts(orig, label, [])
              const a = mapPostmanAuth(orig.auth ?? undefined, label, [])
              return { ...p, authType: (a ?? auth)?.type }
            },
          })
        } else {
          warnings.push(`"${label}": ${responses.length} saved example(s) were not imported.`)
        }
      }
    }
  }

  walk(items, rootFolderId, {
    path: [],
    bakedAuth: placement === 'bake' || placement === 'none' ? collAuth : null,
    inheritCarrier: placement === 'folder' || placement === 'project',
    ppb: mergePpb(undefined, collection.protocolProfileBehavior),
  })

  if (undocumentedFolders.length > 0) {
    warnings.push(
      `Folder descriptions were not imported (Testnizer folders have no description field): ${undocumentedFolders.join('; ')}.`,
    )
  }
  return { suggestedEnvVars, projectVariableCount }
}

/**
 * Import one parsed v2.x collection (also the converted v1 one) in a single
 * transaction. Returns the classic `ImportResult` envelope.
 */
export function importPostmanCollection(
  projectId: string,
  collection: PostmanCollection,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
  preWarnings: string[] = [],
): PostmanImportResult {
  const warnings: string[] = [...preWarnings]
  const db = getDb()
  const now = Date.now()
  const counters = newCounters(now)
  const out = db.transaction(() =>
    importCollectionTx(db, projectId, collection, rootFolderId, opts, counters, warnings, now),
  )()
  invalidateSecretInventory()
  if (counters.endpointCount === 0 && counters.folderCount === 0) {
    warnings.push('No requests or folders found in the Postman collection')
  }
  return {
    success: true,
    collectionId: projectId,
    endpointCount: counters.endpointCount,
    folderCount: counters.folderCount,
    endpointIds: counters.endpointIds,
    ...(counters.exampleCount > 0 ? { exampleCount: counters.exampleCount } : {}),
    suggestedEnvVars:
      Object.keys(out.suggestedEnvVars).length > 0 ? out.suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export type { PostmanAuth }
