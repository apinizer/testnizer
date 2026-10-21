/**
 * Issue #244 — literal credentials never reach a tab snapshot in localStorage.
 *
 * The pure half of the "withheld credential" mechanism (the Socket.IO token
 * of issue #243, generalized). No store imports: every tab-scoped store
 * imports this, and `lib/withheld-credentials.ts` (which imports the stores)
 * does the reload from the saved row.
 *
 * A store describes its credential fields with a `CredentialSpec`:
 *   - `fields` — single values by dot path into the tab state
 *     (`auth.bearer.token`);
 *   - `rows`   — KeyValuePair lists (`headers`, `customHeaders`, …) whose
 *     credential-NAMED rows carry a secret value.
 *
 * On the way to localStorage (`withholdCredentials`, the store's snapshot
 * sanitizer — also applied on load, so a snapshot an older build wrote is
 * cleaned at once) a LITERAL value is blanked and its path recorded in the
 * tab's `withheldCredentials` marker. The row itself stays, so the header
 * name is still on screen. A value that is only `{{variable}}` references
 * (`Bearer {{token}}`) carries no secret and is stored as typed — the rule of
 * AI Chat's credential headers (`isTemplateOnlyValue`).
 *
 * The marker is per PATH, not per tab: after a restart, typing a username
 * must not forget that the password is still waiting for its saved value,
 * or Ctrl+S would write the empty password over the stored one.
 *   - `trackCredentialEdits` drops a path once the user edits that value;
 *   - `restoreWithheld` fills a still-marked, still-empty value from the
 *     saved row and clears the marker (`lib/withheld-credentials.ts`).
 */
import type { KeyValuePair } from '../types'
import { isTemplateOnlyValue } from './ai-chat-config'
import { isCredentialHeaderName } from '../../shared/credential-headers'

/** The per-tab marker every store with a `CredentialSpec` carries. */
export interface WithheldState {
  /**
   * Paths whose literal value was left out of the snapshot this tab was
   * restored from — the value may still be on the saved row. Distinct from
   * "the user cleared it". Session memory only ever holds `[]` until a
   * snapshot is loaded.
   */
  withheldCredentials: string[]
}

export interface CredentialRowList {
  /** Top-level key of a `KeyValuePair[]` in the tab state. */
  list: string
  /** Whether a row of that name carries a credential. */
  isCredentialName: (name: string) => boolean
}

export interface CredentialSpec {
  fields: readonly string[]
  rows: readonly CredentialRowList[]
}

/** Header-style rows (headers, gRPC metadata, MCP stdio env): the one masking rule. */
export function credentialRows(list: string): CredentialRowList {
  return { list, isCredentialName: isCredentialHeaderName }
}

/** A non-blank value that is not only `{{variable}}` references. */
export function isLiteralCredential(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && !isTemplateOnlyValue(v)
}

// ─── Paths ──────────────────────────────────────────────────────────────

const ROW_SEP = '#'

/** `headers#<rowId>` — a row path; anything else is a dot field path. */
function rowPath(list: string, id: string): string {
  return `${list}${ROW_SEP}${id}`
}

function parseRowPath(path: string): { list: string; id: string } | null {
  const i = path.indexOf(ROW_SEP)
  return i < 0 ? null : { list: path.slice(0, i), id: path.slice(i + 1) }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (!isRecord(cur)) return undefined
    cur = cur[seg]
  }
  return cur
}

/** Immutable set of `segs` under `obj` (only called where the path exists). */
function setIn(obj: unknown, segs: string[], value: unknown): unknown {
  if (segs.length === 0) return value
  const base = isRecord(obj) ? obj : {}
  const [head, ...rest] = segs
  return { ...base, [head]: setIn(base[head], rest, value) }
}

function rowsOf(obj: unknown, list: string): KeyValuePair[] | undefined {
  const v = isRecord(obj) ? obj[list] : undefined
  return Array.isArray(v) ? (v as KeyValuePair[]) : undefined
}

const sameKey = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').trim() !== '' && (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** The value a marker path points at in `state`; undefined when gone. */
function valueAt(state: unknown, path: string): unknown {
  const row = parseRowPath(path)
  if (!row) return getPath(state, path)
  return rowsOf(state, row.list)?.find((r) => r.id === row.id)?.value
}

// ─── Snapshot sanitizer ─────────────────────────────────────────────────

/**
 * The tab state as written to localStorage: literal credential values blank,
 * their paths marked. A path marked earlier stays marked while its value is
 * still empty — a restored tab may be written again before its value came
 * back from the saved row.
 */
export function withholdCredentials<T extends object>(st: T, spec: CredentialSpec): T {
  let out: Record<string, unknown> = { ...(st as Record<string, unknown>) }
  const marks = new Set<string>()
  for (const path of spec.fields) {
    if (!isLiteralCredential(getPath(out, path))) continue
    const [top, ...rest] = path.split('.')
    out = { ...out, [top]: setIn(out[top], rest, '') }
    marks.add(path)
  }
  for (const { list, isCredentialName } of spec.rows) {
    const rows = rowsOf(out, list)
    if (!rows) continue
    let changed = false
    const next = rows.map((r) => {
      if (!r || !isCredentialName(r.key ?? '') || !isLiteralCredential(r.value)) return r
      changed = true
      marks.add(rowPath(list, r.id))
      return { ...r, value: '' }
    })
    if (changed) out = { ...out, [list]: next }
  }
  const earlier = (st as Partial<WithheldState>).withheldCredentials
  for (const path of Array.isArray(earlier) ? earlier : []) {
    if (valueAt(out, path) === '') marks.add(path)
  }
  return { ...out, withheldCredentials: [...marks] } as T
}

// ─── Edits ──────────────────────────────────────────────────────────────

/**
 * Where marker `path` lands after an edit from `prev` to `next`: the same
 * path when the value is untouched, the re-minted row's path when a bulk edit
 * replaced the row id but kept name and (empty) value, `null` when the user
 * changed or removed the value — their edit wins over the saved one.
 */
function followEdit(prev: unknown, next: unknown, path: string): string | null {
  const row = parseRowPath(path)
  if (!row) return getPath(prev, path) === getPath(next, path) ? path : null
  const before = rowsOf(prev, row.list)?.find((r) => r.id === row.id)
  if (!before) return null
  const nextRows = rowsOf(next, row.list) ?? []
  const after =
    nextRows.find((r) => r.id === row.id) ??
    nextRows.find(
      (r) => sameKey(r.key, before.key) && !rowsOf(prev, row.list)?.some((p) => p.id === r.id),
    )
  if (!after || after.value !== before.value) return null
  return rowPath(row.list, after.id)
}

interface TabbedRoot extends WithheldState {
  _currentTabId: string | null
}

/**
 * Keep the live slice's marker in step with user edits, for every setter at
 * once (`setAuth` replaces the whole auth object on each keystroke, bulk
 * header edits re-mint row ids). A change that writes the marker itself — a
 * tab switch, a load from the row, a restore — is left alone.
 */
export function trackCredentialEdits<S extends TabbedRoot>(store: {
  subscribe: (listener: (state: S, prev: S) => void) => () => void
  setState: (patch: Partial<S>) => void
}): void {
  store.subscribe((next, prev) => {
    const marks = next.withheldCredentials
    if (!marks || marks.length === 0) return
    if (marks !== prev.withheldCredentials) return
    if (next._currentTabId !== prev._currentTabId) return
    const kept: string[] = []
    let changed = false
    for (const path of marks) {
      const to = followEdit(prev, next, path)
      if (to !== path) changed = true
      if (to !== null) kept.push(to)
    }
    if (changed) store.setState({ withheldCredentials: kept } as Partial<S>)
  })
}

// ─── Restore ────────────────────────────────────────────────────────────

/**
 * The patch that puts the saved values back on a tab slice: each still-marked
 * value that is still empty takes the value at the same path in `source`
 * (rows matched by id, then by name); the marker is cleared either way.
 * `source` undefined = an unsaved draft — nothing to restore, the literal
 * value is gone. Not a user edit: callers apply it with `setState`.
 */
export function restoreWithheld<T extends WithheldState>(st: T, source: unknown): Partial<T> {
  const patch: Record<string, unknown> = { withheldCredentials: [] }
  const cur = (key: string): unknown =>
    key in patch ? patch[key] : (st as unknown as Record<string, unknown>)[key]
  for (const path of st.withheldCredentials ?? []) {
    if (source === undefined) break
    const row = parseRowPath(path)
    if (row) {
      const rows = rowsOf({ [row.list]: cur(row.list) }, row.list)
      const i = rows ? rows.findIndex((r) => r.id === row.id) : -1
      if (!rows || i < 0 || rows[i].value !== '') continue
      const saved = rowsOf(source, row.list)
      const match =
        saved?.find((r) => r?.id === row.id) ?? saved?.find((r) => sameKey(r?.key, rows[i].key))
      if (typeof match?.value !== 'string') continue
      const copy = rows.slice()
      copy[i] = { ...rows[i], value: match.value }
      patch[row.list] = copy
      continue
    }
    const [top, ...rest] = path.split('.')
    if (getPath({ [top]: cur(top) }, path) !== '') continue
    const value = getPath(source, path)
    if (typeof value !== 'string') continue
    patch[top] = setIn(cur(top), rest, value)
  }
  return patch as Partial<T>
}

/** Row paths re-pointed onto re-stamped row ids (Duplicate Tab). */
export function remapWithheldRows(
  marks: readonly string[],
  idMap: ReadonlyMap<string, string>,
): string[] {
  return marks.map((path) => {
    const row = parseRowPath(path)
    const id = row ? idMap.get(row.id) : undefined
    return row && id ? rowPath(row.list, id) : path
  })
}
