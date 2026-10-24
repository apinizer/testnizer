/**
 * `pm.request.url` and `pm.request.body` — Postman's Url / RequestBody shapes,
 * shared by Send and Run (issue #281).
 *
 * `pm.request.url` used to be a plain string on both paths, so the common
 * signing / HMAC pre-request scripts (`pm.request.url.getHost()`,
 * `pm.request.url.getPathWithQuery()`, `pm.request.url.query.get('x')`,
 * `pm.request.body.raw`) died with a TypeError. Names and return values follow
 * postman-collection's `Url` and `RequestBody`; `toString()` returns the
 * request's URL exactly as written (placeholders included) until a script
 * edits the query list.
 *
 * Edits a script makes here (e.g. `pm.request.url.query.add(...)`) change what
 * the script reads back but are NOT applied to the outgoing request — the same
 * as before, when the URL was a read-only string. `pm.request.headers` remains
 * the mutation channel that is folded back.
 */

export interface PmKeyValue {
  key: string
  value: string
  disabled?: boolean
  /** form-data only: 'text' | 'file'. */
  type?: string
  /** form-data file row: the file path. */
  src?: string
}

/** Postman PropertyList subset over key/value rows (query params, form fields). */
export class PmPropertyList {
  private rows: PmKeyValue[]
  private readonly onChange?: () => void

  constructor(rows: PmKeyValue[] = [], onChange?: () => void) {
    this.rows = rows.map((r) => ({ ...r }))
    this.onChange = onChange
  }

  private enabled(): PmKeyValue[] {
    return this.rows.filter((r) => !r.disabled)
  }

  /** Value of the last enabled row named `key` (Postman semantics). */
  get(key: string): string | undefined {
    const hits = this.enabled().filter((r) => r.key === key)
    return hits.length ? hits[hits.length - 1].value : undefined
  }

  has(key: string, value?: string): boolean {
    return this.rows.some((r) => r.key === key && (value === undefined || r.value === value))
  }

  one(key: string): PmKeyValue | undefined {
    const hits = this.rows.filter((r) => r.key === key)
    return hits.length ? { ...hits[hits.length - 1] } : undefined
  }

  idx(i: number): PmKeyValue | undefined {
    const r = this.rows[i]
    return r ? { ...r } : undefined
  }

  count(): number {
    return this.rows.length
  }

  all(): PmKeyValue[] {
    return this.rows.map((r) => ({ ...r }))
  }

  each(fn: (row: PmKeyValue) => void): void {
    for (const r of this.all()) fn(r)
  }

  map<T>(fn: (row: PmKeyValue) => T): T[] {
    return this.all().map(fn)
  }

  filter(fn: (row: PmKeyValue) => boolean): PmKeyValue[] {
    return this.all().filter(fn)
  }

  find(fn: (row: PmKeyValue) => boolean): PmKeyValue | undefined {
    return this.all().find(fn)
  }

  toObject(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const r of this.enabled()) out[r.key] = r.value
    return out
  }

  toJSON(): PmKeyValue[] {
    return this.all()
  }

  add(row: PmKeyValue | string): void {
    const r = typeof row === 'string' ? parseQueryPair(row) : { ...row }
    if (!r.key) return
    this.rows.push({ ...r, value: r.value ?? '' })
    this.onChange?.()
  }

  upsert(row: PmKeyValue): void {
    if (!row || !row.key) return
    const i = this.rows.findIndex((r) => r.key === row.key)
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...row, value: row.value ?? '' }
    else this.rows.push({ ...row, value: row.value ?? '' })
    this.onChange?.()
  }

  remove(keyOrFn: string | ((row: PmKeyValue) => boolean)): void {
    const drop = typeof keyOrFn === 'string' ? (r: PmKeyValue) => r.key === keyOrFn : keyOrFn
    this.rows = this.rows.filter((r) => !drop(r))
    this.onChange?.()
  }

  clear(): void {
    this.rows = []
    this.onChange?.()
  }

  /** `a=1&b=2` — enabled rows, values as written (no re-encoding). */
  toString(): string {
    return this.enabled()
      .map((r) => (r.value === undefined || r.value === null ? r.key : `${r.key}=${r.value}`))
      .join('&')
  }
}

function parseQueryPair(pair: string): PmKeyValue {
  const eq = pair.indexOf('=')
  return eq < 0 ? { key: pair, value: '' } : { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
}

function parseQuery(qs: string): PmKeyValue[] {
  if (!qs) return []
  return qs
    .split('&')
    .filter((p) => p.length > 0)
    .map(parseQueryPair)
}

/** Postman `Url` subset. */
export class PmUrl {
  readonly protocol: string | undefined
  readonly auth: { user: string; password?: string } | undefined
  /** Host split on '.' (Postman keeps it as segments). */
  readonly host: string[]
  readonly port: string | undefined
  /** Path segments without the leading slash. */
  readonly path: string[]
  readonly hash: string | undefined
  readonly query: PmPropertyList
  private readonly raw: string
  private readonly base: string
  private queryEdited = false

  constructor(raw: string) {
    this.raw = raw ?? ''
    let rest = this.raw
    const hashAt = rest.indexOf('#')
    this.hash = hashAt >= 0 ? rest.slice(hashAt + 1) : undefined
    if (hashAt >= 0) rest = rest.slice(0, hashAt)
    const qAt = rest.indexOf('?')
    const qs = qAt >= 0 ? rest.slice(qAt + 1) : ''
    this.base = qAt >= 0 ? rest.slice(0, qAt) : rest
    this.query = new PmPropertyList(parseQuery(qs), () => {
      this.queryEdited = true
    })

    let s = this.base
    const proto = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//)
    this.protocol = proto ? proto[1] : undefined
    if (proto) s = s.slice(proto[0].length)
    const slash = s.indexOf('/')
    let authority = slash >= 0 ? s.slice(0, slash) : s
    const pathPart = slash >= 0 ? s.slice(slash + 1) : ''
    const at = authority.lastIndexOf('@')
    if (at >= 0) {
      const userinfo = authority.slice(0, at)
      authority = authority.slice(at + 1)
      const colon = userinfo.indexOf(':')
      this.auth =
        colon >= 0
          ? { user: userinfo.slice(0, colon), password: userinfo.slice(colon + 1) }
          : { user: userinfo }
    } else {
      this.auth = undefined
    }
    // Port: a trailing `:digits` or `:{{var}}` after the host.
    const portMatch = authority.match(/:(\d+|\{\{[^}]+\}\})$/)
    this.port = portMatch ? portMatch[1] : undefined
    const hostname = portMatch ? authority.slice(0, -portMatch[0].length) : authority
    this.host = hostname ? hostname.split('.') : []
    this.path = pathPart ? pathPart.split('/') : []
  }

  getHost(): string {
    return this.host.join('.')
  }

  getRemote(forcePort?: boolean): string {
    const port = this.port ?? (forcePort ? (this.protocol === 'http' ? '80' : '443') : undefined)
    return port ? `${this.getHost()}:${port}` : this.getHost()
  }

  getPath(): string {
    return `/${this.path.join('/')}`
  }

  getQueryString(): string {
    return this.query.toString()
  }

  getPathWithQuery(): string {
    const qs = this.getQueryString()
    return qs ? `${this.getPath()}?${qs}` : this.getPath()
  }

  getRaw(): string {
    return this.toString()
  }

  toString(): string {
    if (!this.queryEdited) return this.raw
    const qs = this.getQueryString()
    return `${this.base}${qs ? `?${qs}` : ''}${this.hash !== undefined ? `#${this.hash}` : ''}`
  }

  toJSON(): string {
    return this.toString()
  }
}

/** The request body as each host stores it (Testnizer `RequestBody`). */
export interface PmRequestBodyInput {
  type?: string
  content?: string
  formData?: Array<{
    key: string
    value: string
    enabled?: boolean
    type?: string
    filePath?: string
  }>
  urlEncoded?: Array<{ key: string; value: string; enabled?: boolean }>
  binaryPath?: string
}

/** Postman `RequestBody` subset. */
export interface PmRequestBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file'
  raw?: string
  urlencoded?: PmPropertyList
  formdata?: PmPropertyList
  file?: { src: string }
  options?: { raw: { language: string } }
  isEmpty(): boolean
  toString(): string
  toJSON(): Record<string, unknown>
}

const RAW_LANGUAGE: Record<string, string> = {
  json: 'json',
  xml: 'xml',
  text: 'text',
  html: 'html',
  javascript: 'javascript',
}

/**
 * Map a Testnizer body onto Postman's `RequestBody`. No body (or type 'none')
 * gives `undefined`, as `pm.request.body` is in Postman for a request without
 * one.
 */
export function createPmRequestBody(
  input: PmRequestBodyInput | null | undefined,
): PmRequestBody | undefined {
  if (!input || !input.type || input.type === 'none') return undefined
  const lang = RAW_LANGUAGE[input.type]
  if (lang) {
    const raw = input.content ?? ''
    return {
      mode: 'raw',
      raw,
      options: { raw: { language: lang } },
      isEmpty: () => raw.length === 0,
      toString: () => raw,
      toJSON: () => ({ mode: 'raw', raw, options: { raw: { language: lang } } }),
    }
  }
  if (input.type === 'urlencoded') {
    const list = new PmPropertyList(
      (input.urlEncoded ?? []).map((r) => ({
        key: r.key,
        value: r.value,
        disabled: r.enabled === false,
      })),
    )
    return {
      mode: 'urlencoded',
      urlencoded: list,
      isEmpty: () => list.count() === 0,
      toString: () => list.toString(),
      toJSON: () => ({ mode: 'urlencoded', urlencoded: list.toJSON() }),
    }
  }
  if (input.type === 'form-data') {
    const list = new PmPropertyList(
      (input.formData ?? []).map((r) => ({
        key: r.key,
        value: r.type === 'file' ? '' : r.value,
        disabled: r.enabled === false,
        type: r.type === 'file' ? 'file' : 'text',
        ...(r.type === 'file' ? { src: r.filePath ?? r.value } : {}),
      })),
    )
    return {
      mode: 'formdata',
      formdata: list,
      isEmpty: () => list.count() === 0,
      toString: () => '',
      toJSON: () => ({ mode: 'formdata', formdata: list.toJSON() }),
    }
  }
  if (input.type === 'binary') {
    const src = input.binaryPath ?? ''
    return {
      mode: 'file',
      file: { src },
      isEmpty: () => src.length === 0,
      toString: () => '',
      toJSON: () => ({ mode: 'file', file: { src } }),
    }
  }
  return undefined
}
