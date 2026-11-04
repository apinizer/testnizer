/**
 * Safe parsing of untrusted Postman v3 input (issue #276 part 2).
 *
 * YAML is loaded with js-yaml's CORE schema: plain JSON-like types only — no
 * custom tags, no JS types, unquoted dates stay strings and `<<` merge keys
 * are not applied. Every parsed document — YAML or JSON — goes through
 * `assertBounded` (`src/shared/bounded-document.ts`, the alias-bomb check every
 * importer shares).
 */
import {
  assertBounded,
  DOCUMENT_LIMITS,
  InputDocumentError,
} from '../../../../shared/bounded-document'

export { assertBounded }

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
  maxNodeDepth: DOCUMENT_LIMITS.maxNodeDepth,
  /** Values visited in one document (aliases counted per use). */
  maxNodesPerDocument: DOCUMENT_LIMITS.maxNodesPerDocument,
  // ── A .zip import (`../zip.ts`): checked while the archive is read in
  // memory, before any entry reaches a reader. `maxEntries` above caps the
  // entry count of an archive too; the v3 caps above still apply to a zipped
  // v3 folder's files.
  /** Bytes of the .zip file itself. */
  maxArchiveBytes: 100 * 1024 * 1024,
  /** Uncompressed bytes of one entry (a JSON data dump can be large). */
  maxArchiveEntryBytes: 50 * 1024 * 1024,
  /** Uncompressed bytes of all entries together. */
  maxArchiveTotalBytes: 100 * 1024 * 1024,
  /** Uncompressed : compressed ratio of one entry (zip bomb), checked above `ratioCheckFromBytes`. */
  maxCompressionRatio: 100,
  /** Entries smaller than this are not ratio-checked (a small, repetitive file compresses well). */
  ratioCheckFromBytes: 1024 * 1024,
} as const

export const V3InputError = InputDocumentError
export type V3InputError = InputDocumentError

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
