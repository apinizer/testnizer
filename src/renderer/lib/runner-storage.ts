/**
 * Session-storage keys for the runner tab — built in ONE place, and always
 * scoped to a project.
 *
 * The shared runner tab is a singleton by design: `openOrReuseRunnerTab` puts
 * every entry point (Tests panel, Tests welcome, history, scheduled tasks) on
 * one tab called `runner-main`. Tabs themselves are per-project — the workspace
 * store swaps each project's set on switch — but the id is a constant, so two
 * projects' runner tabs were the SAME id, and every key derived from it was
 * therefore shared between them. Nothing cleaned up: `replaceAllTabs` only
 * swaps the array, `cleanupTabState` never touched sessionStorage, and the
 * re-arm effect sets the view without clearing results.
 *
 * The visible consequence was one project's run results, report and suite
 * scope showing up in another project's Runner. Scoping the keys fixes it at
 * the level where the collision actually happens; the tab id can stay the
 * singleton it is meant to be.
 *
 * Both the writer (`open-runner-tab.ts`) and the reader (`RunnerTab.tsx`) go
 * through here — a second place building these strings by hand is how the two
 * sides drift apart, and a key that only one side scopes reads as "state
 * silently lost" instead.
 */
import { useWorkspaceStore } from '../stores/workspace.store'

export type RunnerStorageKind = 'report' | 'report-spent' | 'view' | 'run-data' | 'results'

/**
 * Project used for scoping. `none` covers the Home screen, where no project is
 * active — a real project id never collides with it.
 */
function activeProjectScope(): string {
  return useWorkspaceStore.getState().activeProjectId ?? 'none'
}

/**
 * `null` when there is no tab to scope to, so callers keep their existing
 * "no tab, no storage" branches instead of writing to a key with `undefined`
 * baked into it.
 */
export function runnerKey(kind: RunnerStorageKind, tabId: string | undefined): string | null {
  if (!tabId) return null
  return `runner-${kind}-${activeProjectScope()}-${tabId}`
}
