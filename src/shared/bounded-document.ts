/**
 * Bounds on a parsed document from a user's file. One helper for main and renderer.
 *
 * A YAML alias resolves to the SAME object instead of a copy, so a document with
 * nested aliases ("billion laughs") is small in memory but explodes for anything
 * that walks it. `assertBounded` counts every visit (an alias seen twice counts
 * twice), caps the nesting depth and refuses a recursive alias.
 *
 * Pure TS, zero runtime imports: compiled into both bundles.
 */

/** Largest file an import reads. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export const DOCUMENT_LIMITS = {
  /** Nesting of one parsed document. */
  maxNodeDepth: 64,
  /** Values visited in one document (aliases counted per use). */
  maxNodesPerDocument: 200_000,
} as const

export class InputDocumentError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Throw an `InputDocumentError` when `doc` is deeper than `maxNodeDepth`, has more
 * than `maxNodes` values or contains a recursive alias. `label` names the file.
 */
export function assertBounded(
  doc: unknown,
  label: string,
  maxNodes: number = DOCUMENT_LIMITS.maxNodesPerDocument,
): void {
  let visits = 0
  const ancestors = new Set<object>()
  const walk = (v: unknown, depth: number): void => {
    visits++
    if (visits > maxNodes) {
      throw new InputDocumentError(
        `${label}: the document is too large (more than ${maxNodes} values, YAML aliases counted per use).`,
      )
    }
    if (!v || typeof v !== 'object') return
    if (depth > DOCUMENT_LIMITS.maxNodeDepth) {
      throw new InputDocumentError(
        `${label}: the document is nested deeper than ${DOCUMENT_LIMITS.maxNodeDepth} levels.`,
      )
    }
    if (ancestors.has(v)) {
      throw new InputDocumentError(`${label}: the document contains a recursive YAML alias.`)
    }
    ancestors.add(v)
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
    else if (isRecord(v)) for (const x of Object.values(v)) walk(x, depth + 1)
    ancestors.delete(v)
  }
  walk(doc, 0)
}

/**
 * `assertBounded` for a document parsed from `text`. Every value takes at least a
 * byte of the file unless an alias repeats it, so a big spec without aliases (Stripe
 * and GitHub run past the flat limit) always passes while a small bomb never does.
 */
export function assertTextBounded(doc: unknown, text: string, label: string): void {
  assertBounded(doc, label, Math.max(DOCUMENT_LIMITS.maxNodesPerDocument, text.length))
}
