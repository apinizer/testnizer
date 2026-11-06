/**
 * Resolving an OpenAPI document's `$ref`s, for the APIs tree and the mock server.
 *
 * Internal refs only. A spec is untrusted input and main has the disk and the
 * network: left to its defaults the parser reads `$ref: /any/file` and fetches
 * `$ref: http://…` the moment the file is imported.
 *
 * A ref that cannot be resolved is a warning, never a failure: whether the file is
 * an OpenAPI document at all is `openApiProblem`'s question, asked before this.
 *
 * The result can hold cycles (a self-referencing schema) and shares objects (a
 * schema used twice), so walking it naively overflows the stack or runs forever:
 * write it out with `boundedJson`.
 */
import OpenAPIParser from '@readme/openapi-parser'

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/** What the pointer `#/a/b` names in `root`, or undefined. */
function pointAt(root: unknown, ref: string): unknown {
  let node = root
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    if (!isObject(node)) return undefined
    let token = raw
    try {
      token = decodeURIComponent(raw)
    } catch {
      /* a literal % stays as written */
    }
    node = node[token.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return node
}

/**
 * Counts the refs that leave the document and drops the ones pointing at nothing:
 * the parser stops at the first of those, and one typo would leave every ref in the
 * spec unresolved. The dropped ones stand out later, a parameter with no name.
 */
function sweepRefs(root: unknown): { external: number; dangling: string[] } {
  const seen = new WeakSet<object>()
  const out = { external: 0, dangling: [] as string[] }
  const walk = (node: unknown): void => {
    if (!isObject(node) || seen.has(node)) return
    seen.add(node)
    const ref = node.$ref
    if (typeof ref === 'string') {
      if (!ref.startsWith('#')) out.external += 1
      else if (pointAt(root, ref) === undefined) {
        out.dangling.push(ref)
        delete node.$ref
      }
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(root)
  return out
}

/**
 * The document with its internal refs inlined; external and broken ones are warned
 * about and stay unresolved. Call only after `openApiProblem` passed and the parsed
 * document is bounded: that decides what is OpenAPI, so the parser's own gate (exact
 * minor versions, a mandatory `info`) is given what it wants and restored after.
 */
export async function dereferenceLocalRefs<T>(parsed: T, warnings: string[]): Promise<T> {
  // A clone: the parser edits in place, and a failure half way leaves a mixed tree.
  const raw = parsed as T & Record<string, unknown>
  const working = structuredClone(parsed) as T & Record<string, unknown>
  const { external, dangling } = sweepRefs(working)
  if (external > 0) {
    warnings.push(`${external} reference(s) to other files or URLs were not followed.`)
  }
  if (dangling.length > 0) {
    const shown = dangling.slice(0, 5).join(', ')
    const more = dangling.length > 5 ? ` and ${dangling.length - 5} more` : ''
    warnings.push(`${dangling.length} reference(s) point at nothing in this file: ${shown}${more}.`)
  }
  const version =
    working.openapi !== undefined
      ? { openapi: '3.0.3', swagger: undefined }
      : { swagger: '2.0', openapi: undefined }
  try {
    const out = (await OpenAPIParser.dereference(
      {
        ...working,
        ...version,
        info: { title: 'spec', version: '1' },
        paths: working.paths ?? {},
      } as never,
      { resolve: { external: false } } as never,
    )) as unknown as Record<string, unknown>
    return {
      ...out,
      openapi: raw.openapi,
      swagger: raw.swagger,
      info: raw.info,
      paths: raw.paths === undefined || raw.paths === null ? raw.paths : out.paths,
    } as T
  } catch (e) {
    warnings.push(
      'Could not resolve the references in this spec; they were left as written. ' +
        (e instanceof Error ? e.message : String(e)),
    )
    return raw
  }
}

/** What one import may write out of a resolved document. */
export interface JsonBudget {
  /** Values left for the whole import. */
  left: number
  /** Values written out that had to be cut. */
  trimmed: number
}

export const newJsonBudget = (): JsonBudget => ({ left: 3_000_000, trimmed: 0 })

/** Enough for any one response or example a person reads. */
const JSON_PER_VALUE = 20_000

/**
 * JSON text of a resolved subtree. A cycle closes with `{}`; past the budget the
 * rest becomes `{}` too, counted in `budget.trimmed` so the caller can warn. A
 * schema shared by two branches is written twice, which is why this needs a budget:
 * forty levels of doubling are a small file and 2^40 values.
 */
export function boundedJson(value: unknown, budget: JsonBudget, indent?: number): string {
  let left = Math.min(JSON_PER_VALUE, budget.left)
  const start = left
  const path = new Set<object>()
  let cut = false
  const copy = (node: unknown): unknown => {
    if (!isObject(node)) return node
    if (path.has(node)) return {}
    if (left <= 0) {
      cut = true
      return {}
    }
    left -= 1
    path.add(node)
    const out: unknown = Array.isArray(node)
      ? node.map(copy)
      : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, copy(v)]))
    path.delete(node)
    return out
  }
  const text = JSON.stringify(copy(value), null, indent)
  budget.left -= start - left
  if (cut) budget.trimmed += 1
  return text
}
