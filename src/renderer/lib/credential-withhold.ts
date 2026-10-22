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
 *   - `rows`   — KeyValuePair lists by dot path (`headers`, `params`,
 *     `body.formData`, …) whose credential-NAMED rows carry a secret value;
 *   - `texts`  — a text value with a credential PART inside (a URL's
 *     `?api_key=…`, a command line's `--token …`, a JSON member, issue #247):
 *     only that part is blanked, the rest of the text stays as typed
 *     (`lib/credential-text.ts`).
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
  /** Dot path of a `KeyValuePair[]` in the tab state (`headers`, `body.formData`). */
  list: string
  /** Whether a row of that name carries a credential. */
  isCredentialName: (name: string) => boolean
  /** Whether the VALUE itself is one whatever the name (`postgres://u:p@h`). */
  isCredentialValue?: (value: string) => boolean
  /** Rows the rule never touches (a form-data file row: its value is a file name). */
  skip?: (row: KeyValuePair) => boolean
}

/**
 * A text value whose credential part is blanked in place (issue #247). The
 * marker stays while the text holds no new literal credential, so editing the
 * rest of the URL / body after a restart does not forget the saved value.
 */
export interface CredentialText {
  path: string
  /** The value with its literal credential parts blanked; unchanged when none. */
  scrub: (value: string, state: unknown) => string
  /** The saved credential parts put back into the blank parts of `live`. */
  fill: (live: string, saved: string, state: unknown) => string
  /** Dot path of the saved value in the restore source when it differs (`call.toolArgs`). */
  source?: string
}

export interface CredentialSpec {
  fields: readonly string[]
  rows: readonly CredentialRowList[]
  texts?: readonly CredentialText[]
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
  const v = getPath(obj, list)
  return Array.isArray(v) ? (v as KeyValuePair[]) : undefined
}

/** `obj` with the value at dot path `path` replaced. */
function putPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  return setIn(obj, path.split('.'), value) as Record<string, unknown>
}

function isCredentialRow(r: KeyValuePair | undefined, rule: CredentialRowList): boolean {
  if (!r || rule.skip?.(r) || !isLiteralCredential(r.value)) return false
  return rule.isCredentialName(r.key ?? '') || !!rule.isCredentialValue?.(r.value)
}

const textOf = (spec: CredentialSpec | undefined, path: string): CredentialText | undefined =>
  spec?.texts?.find((t) => t.path === path)

const sameKey = (a: string | undefined, b: string | undefined): boolean =>
  (a ?? '').trim() !== '' && (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** The value a marker path points at in `state`; undefined when gone. */
function valueAt(state: unknown, path: string): unknown {
  const row = parseRowPath(path)
  if (!row) return getPath(state, path)
  return rowsOf(state, row.list)?.find((r) => r.id === row.id)?.value
}

// ─── Restart hint condition ─────────────────────────────────────────────

/** Auth type → the key its fields live under (`auth.apiKey.value`). */
const AUTH_FIELD_KEY: Readonly<Record<string, string>> = {
  'api-key': 'apiKey',
  'aws-signature': 'awsSignature',
}

/**
 * Whether the ACTIVE auth type holds a literal credential that the snapshot
 * withholds — one of `spec.fields` under `auth.<type>.` with a value that is
 * not blank and not only `{{variable}}` references. The restart hint under
 * the Auth fields shows on exactly this (the rule of `CredentialRowsHint`):
 * an empty field or `{{token}}` loses nothing after a restart.
 */
export function hasLiteralAuthCredential(
  auth: { type?: string } | undefined,
  spec: CredentialSpec,
): boolean {
  if (!auth?.type) return false
  const prefix = `auth.${AUTH_FIELD_KEY[auth.type] ?? auth.type}.`
  return spec.fields.some((p) => p.startsWith(prefix) && isLiteralCredential(getPath({ auth }, p)))
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
    out = putPath(out, path, '')
    marks.add(path)
  }
  for (const rule of spec.rows) {
    const rows = rowsOf(out, rule.list)
    if (!rows) continue
    let changed = false
    const next = rows.map((r) => {
      if (!isCredentialRow(r, rule)) return r
      changed = true
      marks.add(rowPath(rule.list, r.id))
      return { ...r, value: '' }
    })
    if (changed) out = putPath(out, rule.list, next)
  }
  for (const text of spec.texts ?? []) {
    const v = getPath(out, text.path)
    if (typeof v !== 'string') continue
    const scrubbed = text.scrub(v, out)
    if (scrubbed === v) continue
    out = putPath(out, text.path, scrubbed)
    marks.add(text.path)
  }
  const earlier = (st as Partial<WithheldState>).withheldCredentials
  for (const path of Array.isArray(earlier) ? earlier : []) {
    // A scrubbed text is never `''`: its marker stays while the text is there.
    const v = valueAt(out, path)
    if (v === '' || (textOf(spec, path) && typeof v === 'string')) marks.add(path)
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
function followEdit(
  prev: unknown,
  next: unknown,
  path: string,
  spec: CredentialSpec | undefined,
): string | null {
  const row = parseRowPath(path)
  const text = row ? undefined : textOf(spec, path)
  if (text) {
    // Editing the rest of the text keeps the marker; typing a literal
    // credential into it (or removing the text) is the user's own value.
    const v = getPath(next, path)
    return typeof v === 'string' && text.scrub(v, next) === v ? path : null
  }
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
export function trackCredentialEdits<S extends TabbedRoot>(
  store: {
    subscribe: (listener: (state: S, prev: S) => void) => () => void
    setState: (patch: Partial<S>) => void
  },
  /** Needed when the spec has `texts` (their markers follow a different rule). */
  spec?: CredentialSpec,
): void {
  store.subscribe((next, prev) => {
    const marks = next.withheldCredentials
    if (!marks || marks.length === 0) return
    if (marks !== prev.withheldCredentials) return
    if (next._currentTabId !== prev._currentTabId) return
    const kept: string[] = []
    let changed = false
    for (const path of marks) {
      const to = followEdit(prev, next, path, spec)
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
 * (rows matched by id, then by name); a marked text takes the saved text when
 * it is still exactly the scrubbed saved text, else only its blank credential
 * parts are filled. The marker is cleared either way.
 * `source` undefined = an unsaved draft — nothing to restore, the literal
 * value is gone. Not a user edit: callers apply it with `setState`.
 */
export function restoreWithheld<T extends WithheldState>(
  st: T,
  source: unknown,
  spec?: CredentialSpec,
): Partial<T> {
  let work: Record<string, unknown> = { ...(st as unknown as Record<string, unknown>) }
  const touched = new Set<string>()
  const put = (path: string, value: unknown): void => {
    work = putPath(work, path, value)
    touched.add(path.split('.')[0])
  }
  for (const path of st.withheldCredentials ?? []) {
    if (source === undefined) break
    const row = parseRowPath(path)
    if (row) {
      const rows = rowsOf(work, row.list)
      const i = rows ? rows.findIndex((r) => r.id === row.id) : -1
      if (!rows || i < 0 || rows[i].value !== '') continue
      const saved = rowsOf(source, row.list)
      const match =
        saved?.find((r) => r?.id === row.id) ?? saved?.find((r) => sameKey(r?.key, rows[i].key))
      if (typeof match?.value !== 'string') continue
      const copy = rows.slice()
      copy[i] = { ...rows[i], value: match.value }
      put(row.list, copy)
      continue
    }
    const live = getPath(work, path)
    const text = textOf(spec, path)
    const value = getPath(source, text?.source ?? path)
    if (typeof value !== 'string') continue
    if (text) {
      if (typeof live !== 'string') continue
      const next = text.scrub(value, work) === live ? value : text.fill(live, value, work)
      if (next !== live) put(path, next)
      continue
    }
    if (live !== '') continue
    put(path, value)
  }
  const patch: Record<string, unknown> = { withheldCredentials: [] }
  for (const key of touched) patch[key] = work[key]
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
