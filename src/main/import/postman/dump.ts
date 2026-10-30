/**
 * Postman legacy data dump (`postman_dump.json`, Settings → Data → Export
 * all) → Testnizer (issue #276). Shape, from Postman's own legacy writer:
 * `{version: 1, collections: [v1…], environments: [{name, values}],
 * headerPresets: […], globals: [{key, value, enabled, type}]}`.
 *
 * Every collection becomes its own folder (named after the collection, under
 * the folder the user picked) so each collection's auth and scripts cascade
 * to its requests only; every environment becomes a project environment and
 * the globals become the "Globals" environment. One transaction for the whole
 * dump — a failure leaves nothing behind.
 */
import { randomUUID } from 'crypto'
import { getDb } from '../../db/database'
import { invalidateSecretInventory } from '../../lib/secret-inventory-cache'
import { classifyPostmanDocument } from '../../../shared/postman-detect'
import type { PostmanCollection, PostmanEnvironment } from './types'
import { toText } from './normalize'
import { convertV1Collection } from './v1'
import {
  importCollectionTx,
  newCounters,
  type PostmanImportOptions,
  type PostmanImportResult,
} from './v2'
import { writeEnvironmentDocument } from './environment'

type Obj = Record<string, unknown>
const isRecord = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export function importLegacyDump(
  projectId: string,
  dump: Obj,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
): PostmanImportResult {
  const warnings: string[] = []
  const db = getDb()
  const now = Date.now()
  const counters = newCounters(now)
  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  if (!projectRow) return { success: false, error: 'Project not found: ' + projectId }

  const collections = Array.isArray(dump.collections) ? dump.collections : []
  const environments = Array.isArray(dump.environments) ? dump.environments : []
  const globals = Array.isArray(dump.globals) ? dump.globals : []
  let environmentCount = 0

  db.transaction(() => {
    const insertFolder = db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth, pre_script, post_script)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
    )
    collections.forEach((raw, i) => {
      const det = classifyPostmanDocument(raw)
      let collection: PostmanCollection
      if (det?.kind === 'v1-collection') collection = convertV1Collection(raw, warnings)
      else if (det?.kind === 'v2-collection') collection = raw as PostmanCollection
      else {
        warnings.push(
          `Data dump: collection #${i + 1} is not a Postman collection and was skipped.`,
        )
        return
      }
      const wrapperId = randomUUID()
      insertFolder.run(
        wrapperId,
        projectId,
        rootFolderId,
        toText(collection.info?.name) || `Collection ${i + 1}`,
        counters.folderCount,
      )
      counters.folderCount++
      importCollectionTx(db, projectId, collection, wrapperId, opts, counters, warnings, now)
    })
    for (const env of environments) {
      if (!isRecord(env)) continue
      const r = writeEnvironmentDocument(
        db,
        projectId,
        projectRow.workspace_id,
        env as unknown as PostmanEnvironment,
        'environment',
        warnings,
        now,
      )
      if (r.success) environmentCount++
      else warnings.push(`Data dump: an environment was skipped (${r.error}).`)
    }
    if (globals.length > 0) {
      writeEnvironmentDocument(
        db,
        projectId,
        projectRow.workspace_id,
        { name: 'Globals', values: globals as PostmanEnvironment['values'] },
        'globals',
        warnings,
        now,
      )
      environmentCount++
    }
  })()
  invalidateSecretInventory()

  if (Array.isArray(dump.headerPresets) && dump.headerPresets.length > 0) {
    warnings.push(
      `Data dump: ${dump.headerPresets.length} header preset(s) were not imported (Testnizer has no header presets).`,
    )
  }
  if (counters.endpointCount === 0 && counters.folderCount === 0 && environmentCount === 0) {
    warnings.push('The Postman data dump contained no collections or environments.')
  }
  return {
    success: true,
    collectionId: projectId,
    endpointCount: counters.endpointCount,
    folderCount: counters.folderCount,
    endpointIds: counters.endpointIds,
    ...(counters.exampleCount > 0 ? { exampleCount: counters.exampleCount } : {}),
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}
