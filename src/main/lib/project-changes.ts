/**
 * What would a commit change? (issue #207)
 *
 * Pure: compares two parsed project files — the one at HEAD and the one a
 * commit would write (the DB export, stripped of secrets and JSON-round-
 * tripped by the caller) — ROW by row, and names each difference the way the
 * user knows it. No git, no DB.
 *
 * The normalisation is the SAME one `sameExport` uses for the switch / merge
 * no-op check (it lives here so the two cannot drift): the export timestamp,
 * the per-machine parts of the `project` header (id, workspace, local_path,
 * save_mode…), each row's `project_id` / `workspace_id` and row ORDER are not
 * content. So an empty change list means `git:commit` has nothing to commit,
 * and the Commit button can be disabled on it.
 *
 * Selective commit (issue #214): each change names the changes it cannot be
 * committed without (`requires`), and `applySelectedChanges` builds the file
 * a commit of only some of them writes — HEAD's file with exactly those rows
 * swapped in. A reference is any `*_id` field (except the per-machine
 * `project_id` / `workspace_id`) whose value is the id of a row in either
 * file, so a committed file never points at a row it does not carry.
 */
import { canonical } from './project-merge'
import { gitChangeKey } from '../../shared/git-changes'
import type { GitChangeItem, GitChangeKind } from '../../shared/git-changes'

type Row = Record<string, unknown>
type Doc = Record<string, unknown>

/** Fields the importer rewrites to the local project on every machine. */
const MACHINE_LOCAL_FIELDS = new Set(['project_id', 'workspace_id'])

/** The project header fields that travel with the file (`shared_settings`: project auth, scripts…). */
const HEADER_FIELDS = ['name', 'display_name', 'description', 'shared_settings'] as const

function comparableRow(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const out: Row = {}
  for (const [k, v] of Object.entries(row as Row)) if (!MACHINE_LOCAL_FIELDS.has(k)) out[k] = v
  return out
}

function headerOf(doc: Doc): Row {
  const header = (doc.project ?? {}) as Row
  const out: Row = {}
  for (const f of HEADER_FIELDS) out[f] = header[f] ?? null
  return out
}

/**
 * Canonical text of a project file for equality: same content ⇔ same string.
 * Shared by `sameExport` (git.handler) and `diffProjectDocs` below.
 */
export function normaliseExportDoc(doc: Doc): string {
  const out: Doc = { ...doc, exportedAt: 0, project: headerOf(doc) }
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v)) out[k] = v.map((row) => canonical(comparableRow(row))).sort()
  }
  return canonical(out)
}

/** Exported section → change kind. Parents before children (display order). */
const SECTION_KINDS: readonly (readonly [string, GitChangeKind])[] = [
  ['folders', 'folder'],
  ['endpoints', 'endpoint'],
  ['endpointCases', 'endpointCase'],
  ['savedRequests', 'savedRequest'],
  ['savedResponses', 'savedResponse'],
  ['environments', 'environment'],
  ['environmentVariables', 'variable'],
  ['globalVariables', 'globalVariable'],
  ['testSuites', 'testSuite'],
  ['testSuiteFolders', 'testSuiteFolder'],
  ['testSuiteItems', 'testSuiteItem'],
  ['mockServers', 'mockServer'],
  ['mockEndpoints', 'mockEndpoint'],
  ['mockResponses', 'mockResponse'],
  ['mockMcpServers', 'mockMcpServer'],
  ['certificates', 'certificate'],
]

function rowsOf(doc: Doc | null, section: string): Row[] {
  const v = doc?.[section]
  return Array.isArray(v)
    ? (v as unknown[]).filter((r): r is Row => !!r && typeof r === 'object')
    : []
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

/** Row identity: its `id`, or its whole content when a row has none. */
function keyOf(row: Row): string {
  return typeof row.id === 'string' ? `id:${row.id}` : `c:${canonical(comparableRow(row))}`
}

/** environment id → name, from both sides (a deleted variable's env may be gone live). */
function environmentNames(head: Doc | null, live: Doc): Map<string, string> {
  const m = new Map<string, string>()
  for (const doc of [head, live]) {
    for (const env of rowsOf(doc, 'environments')) {
      if (typeof env.id === 'string') m.set(env.id, text(env.name) || env.id)
    }
  }
  return m
}

function nameOf(kind: GitChangeKind, row: Row, envNames: Map<string, string>): string {
  const id = typeof row.id === 'string' ? row.id : ''
  switch (kind) {
    case 'variable': {
      const env = typeof row.environment_id === 'string' ? envNames.get(row.environment_id) : ''
      const key = text(row.key) || id
      return env ? `${env} › ${key}` : key
    }
    case 'globalVariable':
      return text(row.key) || id
    case 'mockEndpoint':
      return [text(row.method), text(row.path)].filter(Boolean).join(' ') || id
    case 'certificate':
      return text(row.name) || text(row.host) || id
    default:
      return text(row.name) || text(row.path) || text(row.url) || id
  }
}

/** Item id of a row: its `id`, or its content key (same rule as `diffProjectDocs`). */
function itemIdOf(row: Row): string {
  return typeof row.id === 'string' ? row.id : keyOf(row)
}

/** Ids this row points at through `*_id` fields (per-machine fields excluded). */
function refsOf(row: Row): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_id') && !MACHINE_LOCAL_FIELDS.has(k) && typeof v === 'string' && v) out.push(v)
  }
  return out
}

/**
 * Fill `requires` (issue #214). A row's committed version is its live one
 * when its change is selected and its HEAD one otherwise, so a reference can
 * only dangle two ways:
 *   - a selected live row points at a row that is ADDED and not selected →
 *     the change requires that add;
 *   - a HEAD row points at a row whose DELETION is selected, and the HEAD
 *     row's own change (its deletion, or the edit that moved it) is not →
 *     the deletion requires that change.
 * With no file at HEAD every row also requires the project file itself.
 */
function linkRequirements(head: Doc | null, live: Doc, items: GitChangeItem[]): void {
  const keyByRowId = new Map<string, string>()
  const changeByRowId = new Map<string, GitChangeItem>()
  for (const item of items) {
    if (item.kind === 'project') continue
    keyByRowId.set(item.id, gitChangeKey(item))
    changeByRowId.set(item.id, item)
  }
  const requires = new Map<string, Set<string>>()
  const need = (from: string, to: string): void => {
    if (from === to) return
    const set = requires.get(from) ?? new Set<string>()
    set.add(to)
    requires.set(from, set)
  }
  for (const [section] of SECTION_KINDS) {
    for (const row of rowsOf(live, section)) {
      const own = changeByRowId.get(itemIdOf(row))
      if (!own || own.change === 'deleted') continue
      for (const ref of refsOf(row)) {
        const target = changeByRowId.get(ref)
        if (target?.change === 'added') need(gitChangeKey(own), gitChangeKey(target))
      }
    }
    for (const row of rowsOf(head, section)) {
      const own = keyByRowId.get(itemIdOf(row))
      if (!own) continue
      for (const ref of refsOf(row)) {
        const target = changeByRowId.get(ref)
        if (target?.change === 'deleted') need(gitChangeKey(target), own)
      }
    }
  }
  const projectItem = items.find((i) => i.kind === 'project')
  if (!head && projectItem) {
    for (const item of items)
      if (item !== projectItem) need(gitChangeKey(item), gitChangeKey(projectItem))
  }
  for (const item of items) {
    const set = requires.get(gitChangeKey(item))
    if (set && set.size > 0) item.requires = [...set].sort()
  }
}

/**
 * The project file a commit of only `keys` writes (issue #214): HEAD's file
 * with the selected rows taken from `live` — added rows appended, modified
 * rows replaced, deleted rows dropped — and every other row as HEAD has it.
 * The header (name / display name / description) is live's only when its
 * `project` change is selected. Collections the change list does not show
 * keep HEAD's version, so nothing the user could not see is committed.
 * `keys` should already be closed over `requires` (`withRequiredChanges`).
 * `head` null = no file yet: the header is live's (the file needs one).
 */
export function applySelectedChanges(head: Doc | null, live: Doc, keys: Set<string>): Doc {
  const out: Doc = { ...live }
  const listed = new Set(SECTION_KINDS.map(([section]) => section))
  for (const [k, v] of Object.entries(out)) {
    if (Array.isArray(v) && !listed.has(k)) {
      const atHead = head?.[k]
      out[k] = head ? (Array.isArray(atHead) ? atHead : []) : v
    }
  }
  const liveProject = (live.project ?? {}) as Row
  const projectKey = gitChangeKey({
    kind: 'project',
    id: typeof liveProject.id === 'string' ? liveProject.id : '',
  })
  out.project = !head || keys.has(projectKey) ? live.project : head.project

  for (const [section, kind] of SECTION_KINDS) {
    if (!(section in live) && !(head && section in head)) continue
    const selected = (row: Row): boolean => keys.has(gitChangeKey({ kind, id: itemIdOf(row) }))
    const after = new Map(rowsOf(live, section).map((r) => [keyOf(r), r]))
    const before = new Set<string>()
    const rows: Row[] = []
    for (const row of rowsOf(head, section)) {
      const key = keyOf(row)
      before.add(key)
      const now = after.get(key)
      if (now) rows.push(selected(now) ? now : row)
      else if (!selected(row)) rows.push(row)
    }
    for (const [key, row] of after) if (!before.has(key) && selected(row)) rows.push(row)
    out[section] = rows
  }
  return out
}

/**
 * Rows a commit would add / modify / delete, in section order. `head` null =
 * HEAD has no project file yet: the project file itself is added (a commit
 * writes it even for an empty project), and so is every row.
 */
export function diffProjectDocs(head: Doc | null, live: Doc): GitChangeItem[] {
  const items: GitChangeItem[] = []
  const liveHeader = headerOf(live)
  const project = (live.project ?? {}) as Row
  const projectName = text(liveHeader.display_name) || text(liveHeader.name) || 'project'
  const projectId = typeof project.id === 'string' ? project.id : ''
  if (!head) {
    items.push({ kind: 'project', id: projectId, name: projectName, change: 'added' })
  } else if (canonical(headerOf(head)) !== canonical(liveHeader)) {
    items.push({ kind: 'project', id: projectId, name: projectName, change: 'modified' })
  }

  const envNames = environmentNames(head, live)
  for (const [section, kind] of SECTION_KINDS) {
    const before = new Map(rowsOf(head, section).map((r) => [keyOf(r), r]))
    const after = new Map(rowsOf(live, section).map((r) => [keyOf(r), r]))
    const out: GitChangeItem[] = []
    for (const [key, row] of after) {
      const old = before.get(key)
      const id = typeof row.id === 'string' ? row.id : key
      if (!old) out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'added' })
      else if (canonical(comparableRow(old)) !== canonical(comparableRow(row)))
        out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'modified' })
    }
    for (const [key, row] of before) {
      if (after.has(key)) continue
      const id = typeof row.id === 'string' ? row.id : key
      out.push({ kind, id, name: nameOf(kind, row, envNames), change: 'deleted' })
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    items.push(...out)
  }
  linkRequirements(head, live, items)
  return items
}
