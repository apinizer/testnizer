/**
 * Safe parsing of untrusted Postman v3 input (issue #276 part 2).
 *
 * YAML is loaded with js-yaml's CORE schema: plain JSON-like types only — no
 * custom tags, no JS types, unquoted dates stay strings and `<<` merge keys
 * are not applied. js-yaml resolves an alias to the SAME object instead of a
 * copy, so a document with nested aliases ("billion laughs") is small in
 * memory but explodes for anything that walks it (`JSON.stringify`, the
 * importer). Every parsed document — YAML or JSON — therefore goes through
 * `assertBounded`: a walk that counts every visit (an alias seen twice counts
 * twice), caps the nesting depth and refuses a recursive alias.
 */

/** Limits for one import (a whole folder or one file). */
export const V3_LIMITS = {
  /** Files read from a folder (YAML + referenced scripts). */
  maxFiles: 5000,
  /** Directory entries looked at while scanning (files + folders). */
  maxEntries: 20_000,
  /** Bytes of one file. */
  maxFileBytes: 5 * 1024 * 1024,
  /** Bytes read in total. */
  maxTotalBytes: 50 * 1024 * 1024,
  /** Folder nesting below the picked folder. */
  maxDirDepth: 32,
  /** Nesting of one parsed document. */
  maxNodeDepth: 64,
  /** Values visited in one document (aliases counted per use). */
  maxNodesPerDocument: 200_000,
} as const

export class V3InputError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Throw a `V3InputError` when `doc` is deeper than `maxNodeDepth`, has more
 * than `maxNodesPerDocument` values (alias uses counted) or contains a
 * recursive alias. `label` names the file in the message.
 */
export function assertBounded(doc: unknown, label: string): void {
  let visits = 0
  const ancestors = new Set<object>()
  const walk = (v: unknown, depth: number): void => {
    visits++
    if (visits > V3_LIMITS.maxNodesPerDocument) {
      throw new V3InputError(
        `${label}: the document is too large (more than ${V3_LIMITS.maxNodesPerDocument} values, YAML aliases counted per use).`,
      )
    }
    if (!v || typeof v !== 'object') return
    if (depth > V3_LIMITS.maxNodeDepth) {
      throw new V3InputError(
        `${label}: the document is nested deeper than ${V3_LIMITS.maxNodeDepth} levels.`,
      )
    }
    if (ancestors.has(v)) {
      throw new V3InputError(`${label}: the document contains a recursive YAML alias.`)
    }
    ancestors.add(v)
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
    else if (isRecord(v)) for (const x of Object.values(v)) walk(x, depth + 1)
    ancestors.delete(v)
  }
  walk(doc, 0)
}

interface JsYaml {
  load: (s: string, o?: { schema?: unknown; filename?: string; json?: boolean }) => unknown
  CORE_SCHEMA: unknown
}

function jsYaml(): JsYaml {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('js-yaml') as JsYaml
}

/** Parse one YAML document (CORE schema) and bound it. */
export function parseYamlSafe(text: string, label: string): unknown {
  let doc: unknown
  try {
    doc = jsYaml().load(text.replace(/^\uFEFF/, ''), {
      schema: jsYaml().CORE_SCHEMA,
      filename: label,
    })
  } catch (e) {
    throw new V3InputError(`${label}: not valid YAML (${(e as Error).message.split('\n')[0]}).`)
  }
  assertBounded(doc, label)
  return doc
}
