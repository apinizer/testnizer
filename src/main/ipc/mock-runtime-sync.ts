/**
 * Running mock servers vs. their rows (issue #154 A).
 *
 * The mock managers hold live listeners keyed by row id; the DB is changed
 * behind their back by a project delete (FK cascade) and by project-file
 * imports (git switch / merge / resolve `replace`, the pull's `merge` +
 * `base` prune, and plain upserts that rewrite a row). Every such seam calls
 * `syncRunningMocksWithDb()` once its DB work is done, so a server whose row
 * disappeared stops and one whose row changed serves the new config.
 *
 * Calls are serialised: two imports in quick succession must not interleave
 * a stop of one with a restart of the other. Failures are logged, never
 * thrown — the DB change already happened and the caller's operation stands.
 */

import { reconcileRunningMockServers } from './mock.handler'
import { reconcileRunningMockMcpServers } from './mock-mcp.handler'

let chain: Promise<void> = Promise.resolve()

export function syncRunningMocksWithDb(): Promise<void> {
  chain = chain.then(async () => {
    try {
      await reconcileRunningMockMcpServers()
    } catch (e) {
      console.error('[mock-runtime-sync] Mock MCP reconcile failed:', (e as Error).message)
    }
    try {
      await reconcileRunningMockServers()
    } catch (e) {
      console.error('[mock-runtime-sync] HTTP mock reconcile failed:', (e as Error).message)
    }
  })
  return chain
}
