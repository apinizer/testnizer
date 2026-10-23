/**
 * Postman import entry point (issue #276): ONE call takes any single Postman
 * file — collection v1 / v2.0 / v2.1, environment, globals, legacy data dump —
 * detects what it is (`detect.ts` → `src/shared/postman-detect.ts`) and
 * routes it. The user never answers "which version?". Postman v3 files are
 * recognised and refused with a clear message until the v3 importer lands.
 *
 *   src/main/import/postman/
 *     detect.ts       JSON / YAML parse + the shared classifier
 *     v1.ts           v1 → v2 converter (port of Postman's transformer)
 *     v2.ts           the collection importer (one transaction)
 *     dump.ts         legacy `postman_dump.json`
 *     environment.ts  environment / globals / collection variables → envs
 *     auth.ts body.ts scripts.ts settings.ts examples.ts normalize.ts
 */
import { isPostmanV3Kind } from '../../../shared/postman-detect'
import type { PostmanCollection, PostmanEnvironment } from './types'
import { detectPostman } from './detect'
import { convertV1Collection } from './v1'
import { importPostmanCollection, type PostmanImportOptions, type PostmanImportResult } from './v2'
import { importLegacyDump } from './dump'
import { importPostmanEnvironment } from './environment'

export type { PostmanImportOptions, PostmanImportResult } from './v2'
export { importPostmanEnvironment } from './environment'

export const POSTMAN_V3_MESSAGE =
  'This is a Postman v3 file (Postman 12 YAML / Native Git format). Testnizer imports Postman v3 in a later version — ' +
  'for now, export the collection from Postman as "Collection v2.1" JSON and import that file.'

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
  if (isPostmanV3Kind(detection.kind)) return { success: false, error: POSTMAN_V3_MESSAGE }

  switch (detection.kind) {
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
          'Environment files are imported as project environments; the chosen folder was not used.',
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
