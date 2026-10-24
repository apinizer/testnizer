/**
 * Postman v3 import (issue #276 part 2): a monolithic v3 JSON file
 * (`$kind: collection` + `items`) or a Native Git folder (one collection, or
 * a whole workspace with environments and globals).
 *
 * Both inputs become monolith-shaped collection documents (the folder via
 * `folder-reader.ts`), are converted to the v2.1 walk shape (`to-v2.ts`) and
 * written by the ONE collection importer (`importCollectionTx`), with
 * `native.ts` writing GraphQL / gRPC / WebSocket / Socket.IO / MCP / AI Chat
 * requests. Everything — every collection, environment and globals file of a
 * workspace — is written in ONE transaction: a failure leaves nothing behind.
 */
import { getDb } from '../../../db/database'
import { invalidateSecretInventory } from '../../../lib/secret-inventory-cache'
import type { PostmanEnvironment } from '../types'
import { descriptionText, toText } from '../normalize'
import {
  importCollectionTx,
  newCounters,
  type PostmanImportOptions,
  type PostmanImportResult,
} from '../v2'
import { writeEnvironmentDocument } from '../environment'
import { convertV3Collection } from './to-v2'
import { insertNativeItem } from './native'
import { assertBounded, V3InputError } from './safe-parse'
import type { V3EnvironmentFile, V3FolderContent } from './folder-reader'
import { isRecord, type Doc } from './shapes'
import { randomUUID } from 'crypto'

const MAX_LISTED = 25

/** v3 environment / globals YAML (`name`, `values` list or map) → the export shape `writeEnvironmentDocument` reads. */
export function v3EnvironmentDoc(
  file: V3EnvironmentFile,
  scope: 'environment' | 'globals',
): PostmanEnvironment {
  const stem = file.rel
    .slice(file.rel.lastIndexOf('/') + 1)
    .replace(/\.(environment|globals)\.ya?ml$/i, '')
    .replace(/\.ya?ml$/i, '')
  const doc = file.doc
  const values: NonNullable<PostmanEnvironment['values']> = []
  const raw = doc.values ?? doc.variables
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (!isRecord(v) || typeof v.key !== 'string') continue
      values.push({
        key: v.key,
        value: v.value === undefined ? '' : toText(v.value),
        enabled: v.enabled !== false && v.disabled !== true,
        type: typeof v.type === 'string' ? v.type : undefined,
        description: descriptionText(v.description) ?? undefined,
        ...(v.secret === true ? { secret: true } : {}),
        ...(v.source !== undefined ? ({ source: v.source } as Record<string, unknown>) : {}),
      })
    }
  } else if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw))
      values.push({ key, value: toText(value), enabled: true })
  }
  return {
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name : stem,
    values,
    _postman_variable_scope: scope,
  }
}

function listOf(items: string[]): string {
  const shown = items.slice(0, MAX_LISTED).join(', ')
  return items.length > MAX_LISTED ? `${shown} (+${items.length - MAX_LISTED} more)` : shown
}

interface V3ImportInput {
  collections: Doc[]
  environments: V3EnvironmentFile[]
  globals: V3EnvironmentFile[]
}

function runImport(
  projectId: string,
  input: V3ImportInput,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
  warnings: string[],
): PostmanImportResult {
  const db = getDb()
  const now = Date.now()
  const counters = newCounters(now)
  const projectRow = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as
    | { workspace_id: string }
    | undefined
  if (!projectRow) return { success: false, error: 'Project not found: ' + projectId }

  // Convert first (pure): conversion warnings come before write warnings.
  const conversions = input.collections.map((doc) => convertV3Collection(doc, warnings))
  let environmentId: string | undefined
  let environmentName: string | undefined
  const suggestedEnvVars: Record<string, string> = {}

  db.transaction(() => {
    const several = conversions.length > 1
    for (const conv of conversions) {
      // Several collections (a workspace): each in its own new folder, which
      // can then take the collection's auth and scripts.
      let target = rootFolderId
      if (several) {
        target = randomUUID()
        db.prepare(
          'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)',
        ).run(target, projectId, rootFolderId, conv.collection.info.name, counters.folderCount)
        counters.folderCount++
      }
      const out = importCollectionTx(
        db,
        projectId,
        conv.collection,
        target,
        {
          ...opts,
          nativeItem: (item, ctx) => {
            const native = conv.nativeOf.get(item)
            if (!native) return null
            return insertNativeItem({
              ...ctx,
              name: toText(item.name) || native.kind,
              description: descriptionText(item.description),
              native,
            })
          },
        },
        counters,
        warnings,
        now,
      )
      Object.assign(suggestedEnvVars, out.suggestedEnvVars)
      if (out.environmentId && !environmentId) {
        environmentId = out.environmentId
        environmentName = out.environmentName
      }
    }
    for (const env of input.environments) {
      const r = writeEnvironmentDocument(
        db,
        projectId,
        projectRow.workspace_id,
        v3EnvironmentDoc(env, 'environment'),
        'environment',
        warnings,
        now,
      )
      if (!r.success) {
        warnings.push(`"${env.rel}": ${r.error ?? 'not imported'}.`)
      } else if (!environmentId) {
        environmentId = r.environmentId
        environmentName = r.environmentName
      }
    }
    for (const g of input.globals) {
      const r = writeEnvironmentDocument(
        db,
        projectId,
        projectRow.workspace_id,
        v3EnvironmentDoc(g, 'globals'),
        'globals',
        warnings,
        now,
      )
      if (r.success && !environmentId) {
        environmentId = r.environmentId
        environmentName = r.environmentName
      }
    }
  })()
  invalidateSecretInventory()

  if (counters.endpointCount === 0 && counters.folderCount === 0 && !environmentId) {
    warnings.push('No requests, folders or environments found in the Postman v3 input.')
  }
  return {
    success: true,
    collectionId: projectId,
    endpointCount: counters.endpointCount,
    folderCount: counters.folderCount,
    endpointIds: counters.endpointIds,
    ...(counters.exampleCount > 0 ? { exampleCount: counters.exampleCount } : {}),
    ...(environmentId ? { environmentId, environmentName } : {}),
    suggestedEnvVars: Object.keys(suggestedEnvVars).length > 0 ? suggestedEnvVars : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/** A parsed monolithic v3 JSON collection (`$kind: collection` + `items`). */
export function importV3CollectionDocument(
  projectId: string,
  doc: unknown,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
): PostmanImportResult {
  try {
    assertBounded(doc, 'Postman v3 collection')
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
  if (!isRecord(doc)) return { success: false, error: 'Not a Postman v3 collection.' }
  return runImport(
    projectId,
    { collections: [doc], environments: [], globals: [] },
    rootFolderId,
    opts,
    ['Imported from a Postman v3 collection (JSON).'],
  )
}

/** A folder read by `readV3Folder`. */
export function importV3FolderContent(
  projectId: string,
  content: V3FolderContent,
  rootFolderId: string | null,
  opts: PostmanImportOptions,
): PostmanImportResult {
  const warnings: string[] = [...content.warnings]
  if (content.ignored.length > 0) {
    warnings.push(`Found in the folder and not imported: ${listOf(content.ignored)}.`)
  }
  if (rootFolderId && content.collections.length === 0) {
    warnings.push(
      'Environment files are imported as project environments; the chosen folder was not used.',
    )
  }
  return runImport(
    projectId,
    {
      collections: content.collections.map((c) => c.doc),
      environments: content.environments,
      globals: content.globals,
    },
    rootFolderId,
    opts,
    warnings,
  )
}

export { V3InputError }
export { readV3Folder } from './folder-reader'
