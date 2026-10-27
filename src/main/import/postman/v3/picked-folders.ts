/**
 * Folders and .zip archives picked for a Postman import (issue #276 part 2
 * and its .zip follow-up), held in main behind an opaque handle: the
 * renderer gets the handle and a summary, never a path it could swap nor the
 * archive's bytes. A handle is single-use and expires after 30 minutes; only
 * a few are kept.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import { wrapsEachCollection, type PostmanPickedContent, type PostmanDocumentSet } from '../archive'

interface Picked {
  folderPath: string
  content: PostmanPickedContent
  at: number
}

const TTL_MS = 30 * 60 * 1000
const MAX_KEPT = 8
const picked = new Map<string, Picked>()

function prune(now: number): void {
  for (const [k, v] of picked) if (now - v.at > TTL_MS) picked.delete(k)
  while (picked.size > MAX_KEPT) {
    const oldest = picked.keys().next().value
    if (oldest === undefined) break
    picked.delete(oldest)
  }
}

export function rememberPickedFolder(folderPath: string, content: PostmanPickedContent): string {
  const now = Date.now()
  const handle = randomUUID()
  picked.set(handle, { folderPath, content, at: now })
  prune(now)
  return handle
}

/** The picked folder for `handle` (removed: one import per pick); null when unknown / expired. */
export function takePickedFolder(handle: unknown): Picked | null {
  if (typeof handle !== 'string') return null
  const p = picked.get(handle)
  if (!p) return null
  picked.delete(handle)
  if (Date.now() - p.at > TTL_MS) return null
  return p
}

/** Requests in a v3 item tree. */
function countV3Requests(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let n = 0
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (o.$kind === 'collection' || Array.isArray(o.items)) n += countV3Requests(o.items)
    else n++
  }
  return n
}

/** Requests in a v2 item tree (a folder holds `item[]`). */
function countV2Requests(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let n = 0
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    n += Array.isArray(o.item) ? countV2Requests(o.item) : 1
  }
  return n
}

/** A v1 / v2 collection document → [name, request count]. */
function collectionStats(doc: unknown): [string, number] | null {
  if (!doc || typeof doc !== 'object') return null
  const o = doc as Record<string, unknown>
  if (Array.isArray(o.item)) {
    const info = (o.info ?? {}) as Record<string, unknown>
    return [String(info.name ?? ''), countV2Requests(o.item)]
  }
  if (Array.isArray(o.requests)) return [String(o.name ?? ''), o.requests.length]
  return null
}

/** What the Import modal shows before the destination step. */
export interface PickedFolderSummary {
  folderName: string
  /** A folder picked on disk, or a .zip file. */
  source: 'folder' | 'zip'
  kind: 'workspace' | 'collection'
  collections: string[]
  requestCount: number
  environmentCount: number
  globalsCount: number
  /**
   * The import puts every collection in a folder of its own under the
   * destination: the modal then names the destination after the folder /
   * archive, not after a collection (which would nest "Shop/Shop/…").
   */
  eachInFolder: boolean
}

function documentSetSummary(
  set: PostmanDocumentSet,
): Omit<PickedFolderSummary, 'folderName' | 'source'> {
  const collections: string[] = []
  let requestCount = 0
  let environmentCount = 0
  let globalsCount = 0
  const addCollection = (doc: unknown): void => {
    const s = collectionStats(doc)
    if (!s) return
    collections.push(s[0])
    requestCount += s[1]
  }
  for (const d of set.documents) {
    if (d.kind === 'v1-collection' || d.kind === 'v2-collection') addCollection(d.doc)
    else if (d.kind === 'environment') environmentCount++
    else if (d.kind === 'globals') globalsCount++
    else if (d.kind === 'legacy-dump') {
      if (Array.isArray(d.doc.collections)) d.doc.collections.forEach(addCollection)
      if (Array.isArray(d.doc.environments)) environmentCount += d.doc.environments.length
      if (Array.isArray(d.doc.globals) && d.doc.globals.length > 0) globalsCount++
    } else if (d.kind === 'v3-collection' && set.documents.length === 1) {
      collections.push(String(d.doc.name ?? ''))
      requestCount += countV3Requests(d.doc.items)
    }
  }
  return {
    kind: collections.length > 1 ? 'workspace' : 'collection',
    collections,
    requestCount,
    environmentCount,
    globalsCount,
    eachInFolder: collections.length > 0 && wrapsEachCollection(set),
  }
}

export function pickedFolderSummary(
  folderPath: string,
  content: PostmanPickedContent,
  source: 'folder' | 'zip' = 'folder',
): PickedFolderSummary {
  const base = { folderName: path.basename(folderPath), source }
  if (content.kind === 'documents') return { ...base, ...documentSetSummary(content) }
  return {
    ...base,
    kind: content.kind,
    collections: content.collections.map((c) => String(c.doc.name ?? '')),
    requestCount: content.collections.reduce((n, c) => n + countV3Requests(c.doc.items), 0),
    environmentCount: content.environments.length,
    globalsCount: content.globals.length,
    // `importV3FolderContent` wraps only when there are several collections.
    eachInFolder: content.collections.length > 1,
  }
}
