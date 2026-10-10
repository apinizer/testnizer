/**
 * Cached secret inventory for the Console mask (issues #195 / #196 review).
 *
 * `emitConsoleEntry` masks every entry with the values of the variables marked
 * secret. Reading them is a UNION over `environment_variables` and
 * `global_variables`; a WebSocket / SSE stream emits an entry per frame, so
 * the inventory is cached here instead of queried per entry.
 *
 * Freshness, two layers:
 *  - explicit invalidation from the variable write paths
 *    (`environment.repo.ts` create/update/delete, project import in
 *    `save.handler.ts`) — the edit that marks a variable secret takes effect
 *    on the very next entry;
 *  - a short TTL backstop for writers that bypass the repo (collection
 *    imports write the tables directly).
 *
 * One entry for all projects, on purpose: the inventory is cross-project
 * (`loadSecretInventory`) — a Console entry carries no project id, and
 * over-scrubbing another project's secret costs a `••••••` while
 * under-scrubbing leaks it.
 *
 * History rows keep using `scrubberFor(db)` uncached: one query per request
 * written, and always exact.
 */
import { loadSecretInventory, type SecretDb, type SecretInventory } from './sensitive-scrub'

/** How long a cached inventory is trusted without an invalidation. */
export const SECRET_INVENTORY_TTL_MS = 3000

let cache: { db: SecretDb; at: number; inv: SecretInventory } | null = null

/** Drop the cached inventory — call after any write to a variables table. */
export function invalidateSecretInventory(): void {
  cache = null
}

/** The secret inventory, from cache while fresh. Never throws. */
export function cachedSecretInventory(
  db: SecretDb | null | undefined,
  now: number = Date.now(),
): SecretInventory {
  if (!db) return { values: [], keys: new Set() }
  if (cache && cache.db === db && now - cache.at >= 0 && now - cache.at < SECRET_INVENTORY_TTL_MS) {
    return cache.inv
  }
  const inv = loadSecretInventory(db)
  cache = { db, at: now, inv }
  return inv
}
