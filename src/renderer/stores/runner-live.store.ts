/**
 * The run in flight, per runner tab.
 *
 * Workbench mounts only the ACTIVE tab, so anything a run needs after its tab
 * loses focus cannot live in RunnerTab: the progress subscription, Stop and the
 * end-of-run handling all died with the component while main kept running, and
 * coming back showed a blank results view. This owns the whole lifecycle; the
 * component only draws it. Same shape as `response.store` (issue #76).
 *
 * A slice exists from `startLiveRun` until RunnerTab has adopted the finished
 * run (`takeFinishedRun`). Past runs opened from All Runs never come here.
 *
 * Keyed through `runnerKey`, i.e. by project + tab: `runner-main` exists in every
 * project, and project A's run must not appear in project B's tab.
 */
import { create } from 'zustand'
import type {
  EndpointRunResult,
  RunnerExecuteOptions,
  RunnerPhaseEvent,
  RunnerProgress,
  RunnerReport,
} from '../../shared/runner-types'
import type { RunOrigin } from '../lib/reveal-run-result'
import { runnerKey } from '../lib/runner-storage'
import { useEnvironmentStore } from './environment.store'

export type StopMode = 'graceful' | 'direct'

export interface LiveRun {
  running: boolean
  results: EndpointRunResult[]
  report: RunnerReport | null
  /** The run could not start or broke off: what main said. */
  error: string | null
  currentIndex: number
  totalCount: number
  startedAt: number
  sourceLabel: string
  origin: RunOrigin
  /** Cleanup has begun — a progress tick cannot say so before its first step ends. */
  teardownStarted: boolean
  stopRequested: StopMode | null
}

interface RunnerLiveState {
  runs: Record<string, LiveRun>
}

export const useRunnerLiveStore = create<RunnerLiveState>(() => ({ runs: {} }))

function patchRun(key: string, patch: (run: LiveRun) => Partial<LiveRun>): void {
  useRunnerLiveStore.setState((s) => {
    const run = s.runs[key]
    return run ? { runs: { ...s.runs, [key]: { ...run, ...patch(run) } } } : s
  })
}

/** The store key of a tab in the active project (a tabless runner shares one slot). */
export function liveRunKey(tabId: string | undefined): string {
  return runnerKey('run-data', tabId ?? 'detached') as string
}

export function markLiveRunStop(tabId: string | undefined, mode: StopMode): void {
  patchRun(liveRunKey(tabId), () => ({ stopRequested: mode }))
}

/** Hand a finished run to the mounted tab and forget it. Null while still running. */
export function takeFinishedRun(key: string): LiveRun | null {
  const run = useRunnerLiveStore.getState().runs[key]
  if (!run || run.running) return null
  useRunnerLiveStore.setState((s) => {
    const runs = { ...s.runs }
    delete runs[key]
    return { runs }
  })
  return run
}

/** The tab-switch / reload snapshot RunnerTab reads back on mount. */
export function persistRunSnapshot(
  key: string,
  snapshot: {
    results: EndpointRunResult[]
    report: RunnerReport | null
    startedAt: number | null
    origin: RunOrigin
  },
): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(snapshot))
  } catch (err) {
    // QuotaExceededError on a huge run: only the restore path is degraded.
    console.warn('runner: failed to persist run snapshot:', (err as Error).message)
  }
}

/**
 * After a run, refresh the renderer env store from the DB so script-written
 * variables (e.g. a token captured by a post-response `pm.environment.set`)
 * show up in the env editor and resolve on the next Send — the main process
 * already persisted them ("Keep variable values").
 */
export async function refreshEnvAfterRun(
  report: RunnerReport | undefined,
  keepVariableValues: boolean,
): Promise<void> {
  if (!report || !keepVariableValues) return
  const wrote =
    Object.keys(report.envUpdates ?? {}).length > 0 ||
    Object.keys(report.globalUpdates ?? {}).length > 0
  if (!wrote) return
  const env = useEnvironmentStore.getState()
  await Promise.all([env.fetchEnvironments(), env.fetchGlobalVariables()])
}

export interface StartLiveRun {
  tabId: string | undefined
  payload: RunnerExecuteOptions
  totalCount: number
  sourceLabel: string
  origin: RunOrigin
}

/**
 * The ONE way a runner tab starts a run (the Run button and Quick Run). Resolves
 * when the run has ended, whether or not any component is still mounted. A second
 * start on a busy tab is ignored.
 */
export async function startLiveRun(o: StartLiveRun): Promise<void> {
  const { tabId, payload } = o
  const key = liveRunKey(tabId)
  if (useRunnerLiveStore.getState().runs[key]?.running) return

  // Only this run's events: main broadcasts, and a run in another tab or a
  // scheduled one (no tab) ticks on the same channel.
  const ownEvent = (e: { runTabId?: string; projectId?: string }): boolean =>
    e.runTabId === tabId && e.projectId === payload.projectId

  useRunnerLiveStore.setState((s) => ({
    runs: {
      ...s.runs,
      [key]: {
        running: true,
        results: [],
        report: null,
        error: null,
        currentIndex: 0,
        totalCount: o.totalCount,
        startedAt: Date.now(),
        sourceLabel: o.sourceLabel,
        origin: o.origin,
        teardownStarted: false,
        stopRequested: null,
      },
    },
  }))
  // The previous run's snapshot must not come back as this one, and a tab left
  // before its view effect ran must still land on the results.
  sessionStorage.removeItem(key)
  const viewKey = runnerKey('view', tabId)
  if (viewKey) sessionStorage.setItem(viewKey, 'results')

  const offProgress = window.api?.runner?.onProgress?.((progress: unknown) => {
    const p = progress as RunnerProgress
    if (!ownEvent(p)) return
    patchRun(key, (run) => ({
      currentIndex: p.current,
      totalCount: p.total,
      results: [...run.results, p.result],
    }))
  })
  const offPhase = window.api?.runner?.onPhase?.((event: unknown) => {
    const e = event as RunnerPhaseEvent
    if (ownEvent(e) && e.phase === 'teardown') patchRun(key, () => ({ teardownStarted: true }))
  })

  try {
    const result = (await window.api?.runner?.execute(payload)) as
      | { success: boolean; data?: RunnerReport | null; error?: string }
      | undefined
    if (result?.success && result.data) {
      const report = result.data
      patchRun(key, () => ({
        report,
        results: report.results,
        currentIndex: report.totalEndpoints,
        totalCount: report.totalEndpoints,
      }))
      await refreshEnvAfterRun(report, payload.keepVariableValues ?? false)
    } else if (result && !result.success) {
      patchRun(key, () => ({ error: result.error ?? null }))
    }
  } catch (err) {
    patchRun(key, () => ({ error: (err as Error).message }))
  } finally {
    offProgress?.()
    offPhase?.()
    const run = useRunnerLiveStore.getState().runs[key]
    if (run && tabId && (run.results.length > 0 || run.report)) {
      persistRunSnapshot(key, {
        results: run.results,
        report: run.report,
        startedAt: run.startedAt,
        origin: run.origin,
      })
    }
    patchRun(key, () => ({ running: false }))
  }
}
