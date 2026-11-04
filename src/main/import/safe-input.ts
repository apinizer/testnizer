/**
 * Reading a user's file for an import. A file is untrusted input and main has the
 * disk: every importer reads and parses through here, so a bad file ends in a
 * sentence about the file, not a hang or a JavaScript error.
 */
import { lstatSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { basename, join } from 'path'
import {
  assertTextBounded,
  InputDocumentError,
  MAX_IMPORT_BYTES,
} from '../../shared/bounded-document'
import { pickProjectFile, projectFileName } from '../lib/project-file'

export { MAX_IMPORT_BYTES }

/** A project file in a git checkout can legitimately be far bigger than a spec. */
export const MAX_CHECKOUT_FILE_BYTES = 256 * 1024 * 1024

const MEGABYTE = 1024 * 1024
const DAMAGED = 'This file is damaged: part of its content is not in the expected form.'

interface JsYaml {
  load: (s: string, o?: { schema?: unknown }) => unknown
}

/**
 * Parse YAML and bound it. `schema` keeps a format's own tags (RAML's `!include`).
 * js-yaml itself recurses: a deep flow sequence overflows the stack inside `load`.
 */
export function parseYamlBounded(text: string, label: string, schema?: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as JsYaml
  let doc: unknown
  try {
    doc = schema ? yaml.load(text, { schema }) : yaml.load(text)
  } catch (e) {
    if (e instanceof RangeError) {
      throw new InputDocumentError(`${label}: the document is nested too deeply.`)
    }
    throw e
  }
  assertTextBounded(doc, text, label)
  return doc
}

/** JSON first (the fast path), then YAML; both bounded. Throws on neither. */
export function parseJsonOrYamlBounded(text: string, label: string): unknown {
  const stripped = text.replace(/^\uFEFF/, '')
  let doc: unknown
  try {
    doc = JSON.parse(stripped)
  } catch {
    return parseYamlBounded(stripped, label)
  }
  assertTextBounded(doc, stripped, label)
  return doc
}

/** A file only JSON can be. Empty and unparsable are told apart, in the file's terms. */
export function parseJsonFile(text: string, what: string): unknown {
  const stripped = text.replace(/^\uFEFF/, '')
  if (stripped.trim() === '') throw new InputDocumentError(`This ${what} is empty.`)
  let doc: unknown
  try {
    doc = JSON.parse(stripped)
  } catch {
    throw new InputDocumentError(`This is not a valid ${what}: it is not JSON.`)
  }
  assertTextBounded(doc, stripped, what)
  return doc
}

/**
 * The sentence a person reads for an import failure. Shape checks come first in
 * each importer; this is the net under them, because a file can be wrong in more
 * ways than any list: a JavaScript or constraint message says nothing about it.
 */
export function importErrorText(e: unknown): string {
  if (e instanceof TypeError) return DAMAGED
  if (e instanceof RangeError) return 'This file is damaged: it is nested too deeply to read.'
  const message = e instanceof Error ? e.message : String(e)
  const notNull = /NOT NULL constraint failed: (\w+)\.(\w+)/.exec(message)
  if (notNull) {
    return `This file is damaged: a row in "${notNull[1]}" has no "${notNull[2]}".`
  }
  if (/constraint failed|SQLite3 can only bind|datatype mismatch/i.test(message)) return DAMAGED
  return message
}

function tooLarge(name: string, limit: number): string {
  return `"${name}" is larger than ${Math.round(limit / MEGABYTE)} MB, too large to import.`
}

/**
 * Stat before anything opens the path: opening a FIFO blocks until a writer comes,
 * and a device has no end to read. Follows a link, as a file the user picked may be one.
 */
export function assertImportableFile(filePath: string, limit = MAX_IMPORT_BYTES): void {
  const stat = statSync(filePath)
  const name = basename(filePath)
  if (stat.isDirectory()) return // the caller's own folder message is clearer
  if (!stat.isFile()) throw new InputDocumentError(`"${name}" is not a regular file.`)
  if (stat.size > limit) throw new InputDocumentError(tooLarge(name, limit))
}

/** The text of a file the user picked, capped and never a device. */
export function readImportFile(filePath: string, limit = MAX_IMPORT_BYTES): string {
  assertImportableFile(filePath, limit)
  return readFileSync(filePath, 'utf-8')
}

/** Why a checkout's file must not be read, or null. A clone can hold anything. */
export function checkoutFileProblem(filePath: string): string | null {
  const name = basename(filePath)
  const stat = lstatSync(filePath)
  if (!stat.isFile()) return `"${name}" is a link or a special file, not a regular file.`
  if (stat.size > MAX_CHECKOUT_FILE_BYTES) return tooLarge(name, MAX_CHECKOUT_FILE_BYTES)
  return null
}

/** The text of a file in a git checkout: a regular file under the cap, or it throws. */
export function readCheckoutFile(filePath: string): string {
  const problem = checkoutFileProblem(filePath)
  if (problem) throw new InputDocumentError(problem)
  return readFileSync(filePath, 'utf-8')
}

export interface CheckoutJsonFiles {
  /** Regular `.json` files small enough to read. */
  files: string[]
  /** Names left out, each with its reason: a repository can hold `x.json -> /dev/zero`. */
  skipped: Array<{ file: string; reason: string }>
}

/** The top-level `.json` candidates of a checkout, never reading one. */
export function listCheckoutJsonFiles(dir: string, ignore: string[] = []): CheckoutJsonFiles {
  const out: CheckoutJsonFiles = { files: [], skipped: [] }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('.') || ignore.includes(file)) continue
    const reason = checkoutFileProblem(join(dir, file))
    if (reason) out.skipped.push({ file, reason })
    else out.files.push(file)
  }
  return out
}

/**
 * The file a checkout holds for this project, or null when it has none. A skipped
 * file that would have been the choice is an error naming it, so a repository with
 * `project.json -> /dev/zero` is reported, not read and not taken for an empty one.
 */
export function pickCheckoutProjectFile(
  dir: string,
  projectName: string | null | undefined,
  ignore: string[] = [],
): string | null {
  const { files, skipped } = listCheckoutJsonFiles(dir, ignore)
  const own = skipped.find((s) => s.file === projectFileName(projectName))
  const blocking = own ?? (files.length === 0 ? skipped[0] : undefined)
  if (blocking) {
    throw new InputDocumentError(`The project file was not read: ${blocking.reason}`)
  }
  for (const s of skipped) console.warn(`[git] Skipped ${s.reason}`)
  return files.length === 0 ? null : pickProjectFile(files, projectName)
}

/** Writing through a link would change whatever it points at: replace the link instead. */
export function clearIrregularFile(filePath: string): void {
  try {
    if (!lstatSync(filePath).isFile()) rmSync(filePath, { force: true, recursive: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}
