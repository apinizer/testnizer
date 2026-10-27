/**
 * A .zip picked for the Postman import (issue #276 follow-up). The archive is
 * read in memory (`zip.ts`) and its entries go to the EXISTING readers — no
 * second importer:
 *  - a zipped Postman v3 Native Git folder (a collection or a workspace) →
 *    the v3 folder reader (`v3/folder-reader.ts`, same checks and limits as a
 *    picked folder) → `importV3FolderContent`;
 *  - otherwise its `.json` files, each classified by the shared classifier
 *    (`src/shared/postman-detect.ts`):
 *      one Postman file  → exactly the single-file import (`importPostman`);
 *      several           → one data-dump-shaped document for `dump.ts`
 *                          (`importLegacyDump`): every collection in its own
 *                          folder, environments and globals alongside, ONE
 *                          transaction. A `postman_dump.json` inside is merged
 *                          into it.
 *    Postman's account data export keeps environments as `{name, values}`
 *    under an `environment/` folder without the `_postman_variable_scope`
 *    key a single environment export carries; such a file under an
 *    `environment(s)/` or `globals/` folder is read as one.
 *
 * Anything else in the archive is listed in the import report, never
 * imported; an archive with nothing Postman in it is refused when picked.
 */
import { classifyPostmanDocument, type PostmanArtifactKind } from '../../../shared/postman-detect'
import { readV3Source, type V3FolderContent } from './v3/folder-reader'
import { importV3FolderContent } from './v3'
import { V3InputError } from './v3/safe-parse'
import { readZipEntries, unwrapSingleTopFolder, zipSource, type ZipLimits } from './zip'
import { importPostman } from './index'
import { importLegacyDump } from './dump'
import type { PostmanImportOptions, PostmanImportResult } from './v2'

type Obj = Record<string, unknown>
const isRecord = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export const NOT_POSTMAN_ZIP_MESSAGE =
  'This .zip archive holds no Postman collection, environment, globals, data dump or Postman v3 folder.'

/** One Postman JSON file found in an archive. */
export interface ArchiveDocument {
  rel: string
  kind: PostmanArtifactKind
  doc: Obj
}

/** The JSON files of an archive that is not a v3 folder. */
export interface PostmanDocumentSet {
  kind: 'documents'
  documents: ArchiveDocument[]
  /** Found and not imported. */
  ignored: string[]
  warnings: string[]
}

/** What a picked Postman folder or archive holds (kept in main behind a handle). */
export type PostmanPickedContent = V3FolderContent | PostmanDocumentSet

const YAML_RE = /\.ya?ml$/i
const JSON_RE = /\.json$/i
const ENV_DIR_RE = /(^|\/)environments?\//i
const GLOBALS_DIR_RE = /(^|\/)globals\//i

/** Classify one JSON document found at `rel`, with the account-export folder rule above. */
function classifyInArchive(rel: string, doc: unknown): ArchiveDocument | null {
  const det = classifyPostmanDocument(doc)
  if (det && isRecord(doc)) return { rel, kind: det.kind, doc }
  if (
    isRecord(doc) &&
    typeof doc.name === 'string' &&
    Array.isArray(doc.values) &&
    doc.info === undefined
  ) {
    if (GLOBALS_DIR_RE.test(rel)) {
      return { rel, kind: 'globals', doc: { ...doc, _postman_variable_scope: 'globals' } }
    }
    if (ENV_DIR_RE.test(rel)) {
      return { rel, kind: 'environment', doc: { ...doc, _postman_variable_scope: 'environment' } }
    }
  }
  return null
}

/** Read a picked .zip. Throws `V3InputError` (a user-facing message) when it cannot be imported. */
export async function readPostmanArchive(
  buffer: Buffer,
  limits?: ZipLimits,
): Promise<PostmanPickedContent> {
  const files = unwrapSingleTopFolder(await readZipEntries(buffer, limits))

  if (files.some((f) => YAML_RE.test(f.rel))) {
    const v3 = readV3Source(zipSource(files))
    if (v3) return v3
  }

  const set: PostmanDocumentSet = { kind: 'documents', documents: [], ignored: [], warnings: [] }
  for (const f of [...files].sort((a, b) => a.rel.localeCompare(b.rel))) {
    if (!JSON_RE.test(f.rel)) {
      set.ignored.push(f.rel)
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(f.data.toString('utf8').replace(/^\uFEFF/, ''))
    } catch {
      set.warnings.push(`"${f.rel}": not valid JSON; skipped.`)
      continue
    }
    const found = classifyInArchive(f.rel, parsed)
    if (found) set.documents.push(found)
    else set.ignored.push(f.rel)
  }
  if (set.documents.length === 0) throw new V3InputError(NOT_POSTMAN_ZIP_MESSAGE)
  return set
}

function listOf(items: string[]): string {
  const shown = items.slice(0, 25).join(', ')
  return items.length > 25 ? `${shown} (+${items.length - 25} more)` : shown
}

/** Import the JSON files of an archive (see the header). */
export async function importPostmanDocumentSet(
  projectId: string,
  set: PostmanDocumentSet,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
): Promise<PostmanImportResult> {
  const notes = [...set.warnings]
  if (set.ignored.length > 0) {
    notes.push(`Found in the archive and not imported: ${listOf(set.ignored)}.`)
  }
  const withNotes = (r: PostmanImportResult): PostmanImportResult => {
    if (!r.success || notes.length === 0) return r
    return { ...r, warnings: [...notes, ...(r.warnings ?? [])] }
  }

  if (set.documents.length === 1) {
    const only = set.documents[0]
    return withNotes(await importPostman(projectId, JSON.stringify(only.doc), rootFolderId, opts))
  }

  const collections: unknown[] = []
  const environments: unknown[] = []
  const globals: unknown[] = []
  let headerPresets: unknown[] = []
  for (const d of set.documents) {
    switch (d.kind) {
      case 'v1-collection':
      case 'v2-collection':
        collections.push(d.doc)
        break
      case 'environment':
        environments.push(d.doc)
        break
      case 'globals':
        if (Array.isArray(d.doc.values)) globals.push(...d.doc.values)
        break
      case 'legacy-dump':
        if (Array.isArray(d.doc.collections)) collections.push(...d.doc.collections)
        if (Array.isArray(d.doc.environments)) environments.push(...d.doc.environments)
        if (Array.isArray(d.doc.globals)) globals.push(...d.doc.globals)
        if (Array.isArray(d.doc.headerPresets))
          headerPresets = headerPresets.concat(d.doc.headerPresets)
        break
      default:
        // A v3 JSON collection, or one file of a v3 folder: it does not fit
        // in the one dump transaction.
        notes.push(
          `"${d.rel}": a Postman v3 file was not imported with the other files; import it on its own.`,
        )
    }
  }
  if (collections.length === 0 && environments.length === 0 && globals.length === 0) {
    return {
      success: false,
      error:
        'This .zip archive holds only Postman v3 files that cannot be imported together; import them one at a time.',
    }
  }
  return withNotes(
    importLegacyDump(
      projectId,
      { version: 1, collections, environments, globals, headerPresets },
      rootFolderId,
      opts,
    ),
  )
}

/** Import what `import:pickPostmanFolder` or a picked .zip prepared. */
export function importPickedPostman(
  projectId: string,
  content: PostmanPickedContent,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
): Promise<PostmanImportResult> | PostmanImportResult {
  if (content.kind === 'documents') {
    return importPostmanDocumentSet(projectId, content, rootFolderId, opts)
  }
  return importV3FolderContent(projectId, content, rootFolderId, opts)
}
