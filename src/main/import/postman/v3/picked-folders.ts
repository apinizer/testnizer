/**
 * Folders picked for a Postman v3 import (issue #276 part 2), held in main
 * behind an opaque handle: the renderer gets the handle and a summary, never
 * a path it could swap. A handle is single-use and expires after 30 minutes;
 * only a few are kept.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import type { V3FolderContent } from './folder-reader'

interface Picked {
  folderPath: string
  content: V3FolderContent
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

export function rememberPickedFolder(folderPath: string, content: V3FolderContent): string {
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

function countRequests(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let n = 0
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    if (o.$kind === 'collection' || Array.isArray(o.items)) n += countRequests(o.items)
    else n++
  }
  return n
}

/** What the Import modal shows before the destination step. */
export interface PickedFolderSummary {
  folderName: string
  kind: 'workspace' | 'collection'
  collections: string[]
  requestCount: number
  environmentCount: number
  globalsCount: number
}

export function pickedFolderSummary(
  folderPath: string,
  content: V3FolderContent,
): PickedFolderSummary {
  return {
    folderName: path.basename(folderPath),
    kind: content.kind,
    collections: content.collections.map((c) => String(c.doc.name ?? '')),
    requestCount: content.collections.reduce((n, c) => n + countRequests(c.doc.items), 0),
    environmentCount: content.environments.length,
    globalsCount: content.globals.length,
  }
}
