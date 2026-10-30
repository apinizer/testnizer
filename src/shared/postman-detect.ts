/**
 * Which Postman artifact is this? — ONE classifier for every caller (issue
 * #276): the APIs import (`import:postman` → `src/main/import/postman/`), the
 * Import modal's format guard (`import-format-detect.ts`) and the
 * Environments modal. Three hand copies would drift the way Send/Run did.
 *
 * Rules follow the Postman format research (01-formats §6, rules B1–B6) for a
 * single file:
 *   B1 `$kind` present            → v3 (monolith JSON, folder definition,
 *                                    request / example / message file)
 *   B2 `info` + `item[]`          → v2.x collection (2.0 vs 2.1 from the
 *                                    schema URL — both hosts — else from the
 *                                    auth attribute shape; `_postman_id` is
 *                                    NOT required: Newman/Insomnia omit it)
 *   B3 `version: 1` + `collections[]` → legacy data dump (`postman_dump.json`)
 *   B4 `_postman_variable_scope` environment | globals + `values[]`
 *                                  → environment / globals export
 *   B5 `name` + `requests[]`, no `info` / `item[]` → collection v1
 *   B6 anything else              → not Postman (null)
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 * Parsing YAML is the caller's job (main has js-yaml); `classifyPostmanText`
 * takes an optional parser and otherwise recognises v3 YAML by its `$kind:`
 * line only.
 */

export type PostmanArtifactKind =
  | 'v2-collection'
  | 'v1-collection'
  | 'legacy-dump'
  | 'environment'
  | 'globals'
  | 'v3-collection'
  | 'v3-definition'
  | 'v3-request'
  | 'v3-resource'
  | 'v3-unknown'

export interface PostmanDetection {
  kind: PostmanArtifactKind
  /** Collection schema version for collections: '1.0.0' | '2.0.0' | '2.1.0' | '3.0.0'. */
  version?: string
  /** The `$kind` value of a v3 file. */
  v3Kind?: string
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Both Postman schema hosts and path shapes:
 *   https://schema.getpostman.com/json/collection/v2.1.0/collection.json
 *   https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json
 */
const SCHEMA_VERSION_RE =
  /schema\.(?:getpostman|postman)\.com\/(?:json\/collection\/v(\d+\.\d+\.\d+)|collection\/json\/v(\d+\.\d+\.\d+)\/draft-0[47])/i

/** `info.schema` → '2.0.0' / '2.1.0' / …, or null when it names no known version. */
export function postmanSchemaVersion(schema: unknown): string | null {
  if (typeof schema !== 'string') return null
  const m = SCHEMA_VERSION_RE.exec(schema)
  return m ? (m[1] ?? m[2] ?? null) : null
}

/**
 * v2.0 stores auth attributes as an OBJECT (`basic: {username}`), v2.1 as an
 * ARRAY of `{key, value}`. First auth block found decides; none → 2.1.
 */
function versionFromAuthShape(root: Record<string, unknown>): string {
  const seen = new Set<unknown>()
  const stack: unknown[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!isRecord(node) || seen.has(node)) continue
    seen.add(node)
    const auth = node.auth
    if (isRecord(auth) && typeof auth.type === 'string' && auth.type !== 'noauth') {
      const attrs = auth[auth.type]
      if (Array.isArray(attrs)) return '2.1.0'
      if (isRecord(attrs)) return '2.0.0'
    }
    if (isRecord(node.request)) stack.push(node.request)
    if (Array.isArray(node.item)) for (const child of node.item) stack.push(child)
  }
  return '2.1.0'
}

/** Classify an already-parsed JSON / YAML document. */
export function classifyPostmanDocument(root: unknown): PostmanDetection | null {
  if (!isRecord(root)) return null

  // B1 — v3
  if (typeof root.$kind === 'string') {
    const k = root.$kind
    if (k === 'collection') {
      return Array.isArray(root.items)
        ? { kind: 'v3-collection', version: '3.0.0', v3Kind: k }
        : { kind: 'v3-definition', version: '3.0.0', v3Kind: k }
    }
    if (/-request$/.test(k)) return { kind: 'v3-request', version: '3.0.0', v3Kind: k }
    if (/-(example|message)$/.test(k)) return { kind: 'v3-resource', version: '3.0.0', v3Kind: k }
    return { kind: 'v3-unknown', version: '3.0.0', v3Kind: k }
  }

  // B2 — v2.x
  if (isRecord(root.info) && Array.isArray(root.item)) {
    const v = postmanSchemaVersion(root.info.schema)
    const version = v && v.startsWith('2.') ? v : versionFromAuthShape(root)
    return { kind: 'v2-collection', version }
  }

  // B3 — legacy dump
  if (root.version === 1 && Array.isArray(root.collections)) return { kind: 'legacy-dump' }

  // B4 — environment / globals
  const scope = root._postman_variable_scope
  if ((scope === 'environment' || scope === 'globals') && Array.isArray(root.values)) {
    return { kind: scope }
  }

  // B5 — v1. Real v1 exports also carry `id` / `order` / `folders`; the
  // importer has always recognised `name` + `requests[]` alone, so the
  // looser test stays (no other format has that pair without `info`).
  if (
    !root.info &&
    typeof root.name === 'string' &&
    Array.isArray(root.requests) &&
    !Array.isArray(root.item)
  ) {
    return { kind: 'v1-collection', version: '1.0.0' }
  }

  return null
}

/**
 * Classify raw file text. JSON is parsed here; YAML only through `parseYaml`
 * when given. Without a YAML parser a document whose first key line is
 * `$kind: <x>` is still recognised as v3 (enough for the renderer guard).
 */
export function classifyPostmanText(
  text: string,
  parseYaml?: (s: string) => unknown,
): PostmanDetection | null {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart()
  if (!trimmed) return null
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return classifyPostmanDocument(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  if (parseYaml) {
    try {
      return classifyPostmanDocument(parseYaml(trimmed))
    } catch {
      return null
    }
  }
  const m = /^\$kind:\s*["']?([\w.-]+)["']?\s*$/m.exec(trimmed.slice(0, 4096))
  if (!m) return null
  const kind = m[1]
  const hasItems = /^items:/m.test(trimmed)
  if (kind === 'collection') {
    return hasItems
      ? { kind: 'v3-collection', version: '3.0.0', v3Kind: kind }
      : { kind: 'v3-definition', version: '3.0.0', v3Kind: kind }
  }
  if (/-request$/.test(kind)) return { kind: 'v3-request', version: '3.0.0', v3Kind: kind }
  if (/-(example|message)$/.test(kind))
    return { kind: 'v3-resource', version: '3.0.0', v3Kind: kind }
  return { kind: 'v3-unknown', version: '3.0.0', v3Kind: kind }
}

/**
 * A .zip archive (a local file header, `PK\x03\x04`) — decided by the bytes,
 * not the file name. Takes raw bytes or text decoded as UTF-8 / Latin-1 (the
 * four signature bytes are ASCII, so they survive either decoding). Main
 * reads a zipped Postman folder, data dump or JSON set in memory
 * (`src/main/import/postman/zip.ts`); a zip never travels to the renderer.
 */
export function isZipMagic(data: Uint8Array | string): boolean {
  if (typeof data === 'string') return data.startsWith('PK\u0003\u0004')
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4
}

/** Environment-like artifacts: imported as project environments, never into a folder. */
export function isPostmanVariablesKind(kind: PostmanArtifactKind | null | undefined): boolean {
  return kind === 'environment' || kind === 'globals'
}

/** v3 kinds — recognised, but imported in a later step (issue #276 part 2). */
export function isPostmanV3Kind(kind: PostmanArtifactKind | null | undefined): boolean {
  return typeof kind === 'string' && kind.startsWith('v3-')
}
