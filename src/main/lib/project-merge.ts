/**
 * Row-level three-way merge for a Testnizer project file.
 *
 * A project export is a set of tables, each an array of rows with a stable
 * `id`. Git merges it as TEXT: two branches that each append a request to
 * `endpoints` touch the same lines and conflict, and the only resolution the
 * UI can offer is "keep mine" / "keep theirs" — one side's rows are thrown
 * away. That is wrong for a collection, which is a set, not a document.
 *
 * This module merges the three versions (merge base, ours, theirs) by row:
 *   - added on one side            → kept
 *   - changed on one side          → that side's version
 *   - changed on both sides        → the more recently `updated_at` version
 *                                    (ties / no timestamps → ours)
 *   - deleted on one side, untouched on the other → dropped
 *   - deleted on one side, changed on the other   → the change wins (never
 *                                    lose edited work to a stale delete)
 *
 * Rows whose parent went away are re-parented to the root (folders,
 * requests) or dropped (cases, variables, suite items, mock children,
 * examples) so the result never violates a foreign key on import.
 *
 * Pure: no git, no DB. `git.handler` reads `:1:` / `:2:` / `:3:` from the
 * index, calls `mergeProjectFiles`, writes the result and completes the merge.
 */

type Row = Record<string, unknown>
type Doc = Record<string, unknown>

/** Sections merged by row. Order matters only for FK repair (parents first). */
const ROW_SECTIONS = [
  'folders',
  'endpoints',
  'endpointCases',
  'savedRequests',
  'environments',
  'environmentVariables',
  'globalVariables',
  'testSuites',
  'testSuiteFolders',
  'testSuiteItems',
  'mockServers',
  'mockEndpoints',
  'mockResponses',
  'certificates',
  'savedResponses',
] as const

function rowsOf(doc: Doc | null, section: string): Row[] {
  const v = doc?.[section]
  return Array.isArray(v) ? (v as Row[]).filter((r) => r && typeof r.id === 'string') : []
}

function byId(rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>()
  for (const r of rows) m.set(r.id as string, r)
  return m
}

/** Key-order-insensitive structural equality. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * Fields the importer rewrites to the local project on every machine. A row
 * that differs only there was NOT edited — treating it as changed would let
 * a mere re-export on one machine beat a genuine delete on the other.
 */
const MACHINE_LOCAL_FIELDS = new Set(['project_id', 'workspace_id'])

function comparable(r: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) if (!MACHINE_LOCAL_FIELDS.has(k)) out[k] = v
  return out
}

function same(a: Row | undefined, b: Row | undefined): boolean {
  if (!a || !b) return a === b
  return canonical(comparable(a)) === canonical(comparable(b))
}

function updatedAt(r: Row): number {
  const v = r.updated_at
  return typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) || 0 : 0
}

function mergeSection(base: Row[], ours: Row[], theirs: Row[]): Row[] {
  const b = byId(base)
  const o = byId(ours)
  const t = byId(theirs)
  const out: Row[] = []
  const emitted = new Set<string>()

  const pick = (id: string): Row | null => {
    const inBase = b.get(id)
    const mine = o.get(id)
    const yours = t.get(id)
    if (mine && yours) {
      if (same(mine, yours)) return mine
      const iChanged = !same(mine, inBase)
      const youChanged = !same(yours, inBase)
      if (iChanged && !youChanged) return mine
      if (youChanged && !iChanged) return yours
      // Both changed (or neither knows the base): newest edit wins, ours on tie.
      return updatedAt(yours) > updatedAt(mine) ? yours : mine
    }
    if (mine && !yours) {
      // Theirs lacks it: never existed there (added by us) → keep; or they
      // deleted it → keep only if we changed it since the base.
      if (!inBase) return mine
      return same(mine, inBase) ? null : mine
    }
    if (yours && !mine) {
      if (!inBase) return yours
      return same(yours, inBase) ? null : yours
    }
    return null
  }

  // Ours first (keeps the user's own ordering), then rows only they have.
  for (const r of ours) {
    const id = r.id as string
    const chosen = pick(id)
    emitted.add(id)
    if (chosen) out.push(chosen)
  }
  for (const r of theirs) {
    const id = r.id as string
    if (emitted.has(id)) continue
    emitted.add(id)
    const chosen = pick(id)
    if (chosen) out.push(chosen)
  }
  return out
}

/**
 * Drop / re-parent rows whose parent did not survive the merge so the file
 * imports without tripping a foreign key.
 */
function repairReferences(doc: Doc): void {
  const ids = (section: string): Set<string> =>
    new Set(rowsOf(doc, section).map((r) => r.id as string))
  // Sections the file does not carry stay absent (older exports).
  const has = (section: string): boolean => Array.isArray(doc[section])
  const keep = (section: string, parent: string, parents: Set<string>): void => {
    if (!has(section)) return
    doc[section] = rowsOf(doc, section).filter((r) => {
      const p = r[parent]
      return typeof p !== 'string' || parents.has(p)
    })
  }
  const reparent = (section: string, parent: string, parents: Set<string>): void => {
    if (!has(section)) return
    doc[section] = rowsOf(doc, section).map((r) => {
      const p = r[parent]
      return typeof p === 'string' && !parents.has(p) ? { ...r, [parent]: null } : r
    })
  }

  // Folder tree: a folder whose parent is gone surfaces at the root.
  reparent('folders', 'parent_id', ids('folders'))
  const folders = ids('folders')
  reparent('endpoints', 'folder_id', folders)
  reparent('savedRequests', 'folder_id', folders)

  keep('endpointCases', 'endpoint_id', ids('endpoints'))
  keep('environmentVariables', 'environment_id', ids('environments'))

  const suites = ids('testSuites')
  keep('testSuiteFolders', 'suite_id', suites)
  reparent('testSuiteFolders', 'parent_id', ids('testSuiteFolders'))
  keep('testSuiteItems', 'suite_id', suites)
  reparent('testSuiteItems', 'folder_id', ids('testSuiteFolders'))

  keep('mockEndpoints', 'server_id', ids('mockServers'))
  keep('mockResponses', 'endpoint_id', ids('mockEndpoints'))

  // Examples hang off an endpoint or a saved request.
  if (has('savedResponses')) {
    const owners = new Set([...ids('endpoints'), ...ids('savedRequests')])
    doc.savedResponses = rowsOf(doc, 'savedResponses').filter((r) => {
      const owner = r.owner_id
      return typeof owner !== 'string' || owners.has(owner)
    })
  }
}

/**
 * Merge three parsed project files. `base` may be null (no common ancestor —
 * e.g. an add/add conflict); every row is then treated as "added".
 * Scalars and the `project` header come from `ours`; `exportedAt` is now.
 */
export function mergeProjectDocs(base: Doc | null, ours: Doc, theirs: Doc): Doc {
  const out: Doc = { ...ours }
  for (const section of ROW_SECTIONS) {
    const present = Array.isArray(ours[section]) || Array.isArray(theirs[section])
    if (!present) continue
    out[section] = mergeSection(
      rowsOf(base, section),
      rowsOf(ours, section),
      rowsOf(theirs, section),
    )
  }
  repairReferences(out)
  out.exportedAt = Date.now()
  return out
}

/**
 * Text-in, text-out wrapper. Returns null when either side is not a
 * parsable project file (then the merge is left to the user, as before).
 * An empty / unparsable base is treated as "no common ancestor".
 */
export function mergeProjectFiles(base: string, ours: string, theirs: string): string | null {
  const parse = (s: string): Doc | null => {
    if (!s.trim()) return null
    try {
      const v = JSON.parse(s) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : null
    } catch {
      return null
    }
  }
  const o = parse(ours)
  const t = parse(theirs)
  if (!o || !t) return null
  const isProject = (d: Doc): boolean => d.project !== undefined || Array.isArray(d.endpoints)
  if (!isProject(o) || !isProject(t)) return null
  // A section that is present but not an array is a damaged file — merging
  // it by row would read as "everything deleted". Leave that to the user.
  const wellFormed = (d: Doc): boolean =>
    ROW_SECTIONS.every((k) => d[k] === undefined || Array.isArray(d[k]))
  if (!wellFormed(o) || !wellFormed(t)) return null
  return JSON.stringify(mergeProjectDocs(parse(base), o, t), null, 2)
}
