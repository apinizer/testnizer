/**
 * Postman import entry point (issue #276): ONE call takes any single Postman
 * file — collection v1 / v2.0 / v2.1, environment, globals, legacy data dump —
 * detects what it is (`detect.ts` → `src/shared/postman-detect.ts`) and
 * routes it. The user never answers "which version?". A monolithic Postman v3
 * JSON collection is imported here too (`v3/`); a single file out of a v3
 * collection folder (a request, a folder definition) is refused with a
 * pointer to "Import folder…" — it needs its folder.
 *
 *   src/main/import/postman/
 *     detect.ts       JSON / YAML parse + the shared classifier
 *     v1.ts           v1 → v2 converter (port of Postman's transformer)
 *     v2.ts           the collection importer (one transaction)
 *     dump.ts         legacy `postman_dump.json`
 *     environment.ts  environments → envs; globals / collection variables → project variables
 *     auth.ts body.ts scripts.ts settings.ts examples.ts normalize.ts
 *     v3/             Postman v3: monolith JSON + collection folder (issue #276 part 2)
 */
import type { PostmanCollection, PostmanEnvironment } from './types'
import { detectPostman } from './detect'
import { convertV1Collection } from './v1'
import { importPostmanCollection, type PostmanImportOptions, type PostmanImportResult } from './v2'
import { importLegacyDump } from './dump'
import { importPostmanEnvironment } from './environment'
import { importV3CollectionDocument } from './v3'

export type { PostmanImportOptions, PostmanImportResult } from './v2'
export { importPostmanEnvironment } from './environment'

/** A single file out of a v3 collection folder: it only makes sense with its folder. */
export const POSTMAN_V3_PART_MESSAGE =
  'This is one file of a Postman v3 collection folder (Postman 12 YAML format). ' +
  'Use "Import folder…" and pick the collection folder (the one holding ".resources") or the workspace folder.'

export const NOT_POSTMAN_MESSAGE =
  "This file is not a Postman collection. You can't upload this file type from here."

/**
 * Import any single Postman file into `projectId`. `rootFolderId` is the
 * folder the user picked (null = project root). Environments / globals never
 * go into a folder.
 */
export async function importPostman(
  projectId: string,
  content: string,
  rootFolderId: string | null = null,
  opts: PostmanImportOptions = {},
): Promise<PostmanImportResult> {
  let parsed: ReturnType<typeof detectPostman>
  try {
    parsed = detectPostman(content)
  } catch (e) {
    const looksJson = /^\s*[{[]/.test(content.replace(/^\uFEFF/, ''))
    return {
      success: false,
      error:
        (looksJson
          ? 'Failed to parse Postman collection JSON: '
          : 'Failed to parse Postman file (JSON or YAML): ') + (e as Error).message,
    }
  }
  const { doc, detection } = parsed
  if (!detection) return { success: false, error: NOT_POSTMAN_MESSAGE }

  switch (detection.kind) {
    case 'v3-collection':
      return importV3CollectionDocument(projectId, doc, rootFolderId, opts)
    case 'v3-definition':
    case 'v3-request':
    case 'v3-resource':
      return { success: false, error: POSTMAN_V3_PART_MESSAGE }
    case 'v3-unknown':
      return {
        success: false,
        error: `This Postman v3 file has an unknown $kind "${detection.v3Kind ?? ''}".`,
      }
    case 'v2-collection': {
      const collection = doc as PostmanCollection
      if (typeof collection.info?.name !== 'string') {
        return { success: false, error: NOT_POSTMAN_MESSAGE }
      }
      return importPostmanCollection(projectId, collection, rootFolderId, opts)
    }
    case 'v1-collection': {
      const pre: string[] = [
        'Converted from Postman collection v1 (Postman itself no longer opens v1 files).',
      ]
      const collection = convertV1Collection(doc, pre)
      return importPostmanCollection(projectId, collection, rootFolderId, opts, pre)
    }
    case 'legacy-dump':
      return importLegacyDump(projectId, doc as Record<string, unknown>, rootFolderId, opts)
    case 'environment':
    case 'globals': {
      const r = await importPostmanEnvironment(projectId, doc as PostmanEnvironment)
      if (!r.success) return { success: false, error: r.error }
      const warnings = [...(r.warnings ?? [])]
      if (rootFolderId) {
        warnings.push(
          detection.kind === 'globals'
            ? "Postman globals are imported into the project's Globals; the chosen folder was not used."
            : 'Environment files are imported as project environments; the chosen folder was not used.',
        )
      }
      return {
        success: true,
        collectionId: projectId,
        endpointCount: 0,
        folderCount: 0,
        endpointIds: [],
        environmentId: r.environmentId,
        environmentName: r.environmentName,
        warnings: warnings.length > 0 ? warnings : undefined,
      }
    }
    default:
      return { success: false, error: NOT_POSTMAN_MESSAGE }
  }
}
