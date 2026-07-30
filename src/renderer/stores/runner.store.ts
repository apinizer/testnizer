import { create } from 'zustand'
import type { EndpointRunResult, RunnerReport } from '../../shared/runner-types'
import { buildExecutePayload, RUNNER_DEFAULTS } from '../lib/runner-payload'
import type { HttpMethod } from '../types'
import { useEnvironmentStore } from './environment.store'
import { saveDirtyRunItemsBeforeRun } from '../lib/dirty-run-guard'

// ─── Types matching main process runner ─────────────────────

export interface RunnerEndpoint {
  id: string
  name: string
  method: HttpMethod
  url: string
  selected: boolean
}

/**
 * Re-exported from the shared runner contract so the ~15 renderer modules that
 * import these from the store keep working. The local copies they replace had
 * already drifted from main's (see src/shared/runner-types.ts).
 */
export type {
  AssertionResult,
  EndpointRunResult,
  RunnerReport,
  RunStopReason,
  ScriptConsoleLog,
} from '../../shared/runner-types'

type RunnerView = 'config' | 'results'

interface RunnerStore {
  // Config
  endpoints: RunnerEndpoint[]
  delay: number
  iterations: number
  iterationData: Record<string, string>[]
  stopOnError: boolean
  persistResponses: boolean
  keepVariableValues: boolean
  saveCookies: boolean

  // State
  view: RunnerView
  isRunning: boolean
  currentIndex: number
  totalCount: number
  results: EndpointRunResult[]
  report: RunnerReport | null
  runStartedAt: number | null

  // Actions
  setEndpoints: (endpoints: RunnerEndpoint[]) => void
  toggleEndpoint: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  setDelay: (ms: number) => void
  setIterations: (n: number) => void
  setIterationData: (rows: Record<string, string>[]) => void
  setStopOnError: (v: boolean) => void
  setPersistResponses: (v: boolean) => void
  setKeepVariableValues: (v: boolean) => void
  setSaveCookies: (v: boolean) => void
  setView: (v: RunnerView) => void
  run: (projectId: string, workspaceId?: string, environmentId?: string) => Promise<void>
  stop: () => void
  reset: () => void
}

export const useRunnerStore = create<RunnerStore>((set, get) => ({
  // Config
  endpoints: [],
  // NOTE: this surface keeps a 1s inter-request delay (it predates the runner
  // tab and its users expect the gentler pacing); everything else comes from the
  // shared defaults so the two surfaces cannot drift apart again.
  delay: 1000,
  iterations: RUNNER_DEFAULTS.iterations,
  iterationData: [],
  stopOnError: RUNNER_DEFAULTS.stopOnError,
  persistResponses: RUNNER_DEFAULTS.persistResponses,
  keepVariableValues: RUNNER_DEFAULTS.keepVariableValues,
  saveCookies: true,

  // State
  view: 'config',
  isRunning: false,
  currentIndex: 0,
  totalCount: 0,
  results: [],
  report: null,
  runStartedAt: null,

  // Actions
  setEndpoints: (endpoints) => set({ endpoints }),

  toggleEndpoint: (id) =>
    set((s) => ({
      endpoints: s.endpoints.map((ep) => (ep.id === id ? { ...ep, selected: !ep.selected } : ep)),
    })),

  selectAll: () =>
    set((s) => ({ endpoints: s.endpoints.map((ep) => ({ ...ep, selected: true })) })),

  deselectAll: () =>
    set((s) => ({ endpoints: s.endpoints.map((ep) => ({ ...ep, selected: false })) })),

  setDelay: (ms) => set({ delay: Math.max(0, ms) }),
  setIterations: (n) => set({ iterations: Math.max(1, n) }),
  setIterationData: (rows) => set({ iterationData: Array.isArray(rows) ? rows : [] }),
  setStopOnError: (v) => set({ stopOnError: v }),
  setPersistResponses: (v) => set({ persistResponses: v }),
  setKeepVariableValues: (v) => set({ keepVariableValues: v }),
  setSaveCookies: (v) => set({ saveCookies: v }),
  setView: (v) => set({ view: v }),

  run: async (projectId, workspaceId, environmentId) => {
    const state = get()
    const selected = state.endpoints.filter((ep) => ep.selected)
    if (selected.length === 0) return

    // Persist the active tab if it's a dirty member of this run (so the run uses
    // fresh data, not the stale DB snapshot) + warn about other dirty run items.
    await saveDirtyRunItemsBeforeRun(selected.map((ep) => ep.id))

    // total = endpoints × iterations so progress % reflects the real run.
    const expectedTotal = selected.length * Math.max(1, state.iterations)

    set({
      view: 'results',
      isRunning: true,
      results: [],
      report: null,
      currentIndex: 0,
      totalCount: expectedTotal,
      runStartedAt: Date.now(),
    })

    // Stop accepting progress events once the final report has arrived; the
    // queued events would otherwise duplicate-append into `results` and race
    // with the final report's `results: report.results` overwrite.
    let acceptProgress = true

    const unsubscribe = window.api?.runner?.onProgress?.((progress: unknown) => {
      if (!acceptProgress) return
      const p = progress as { current: number; total: number; result: EndpointRunResult }
      set((s) => ({
        currentIndex: p.current,
        totalCount: p.total,
        results: [...s.results, p.result],
      }))
    })

    try {
      const result = await window.api?.runner?.execute(
        buildExecutePayload(
          {
            projectId,
            endpointIds: selected.map((ep) => ep.id),
            environmentId,
            workspaceId,
            // This surface has no setup/teardown or hook-script UI, so those
            // stay undefined — but VISIBLY so, in a payload the shared builder
            // produced, rather than by omission. Omission is what let the runner
            // tab drop `stopOnError` unnoticed.
            iterationData: state.iterationData.length > 0 ? state.iterationData : undefined,
            sourceLabel: 'Runner',
          },
          {
            delay: state.delay,
            iterations: state.iterations,
            stopOnError: state.stopOnError,
            persistResponses: state.persistResponses,
            keepVariableValues: state.keepVariableValues,
          },
        ),
      )

      acceptProgress = false

      if (result?.success && result.data) {
        const report = result.data as RunnerReport
        set({
          report,
          results: report.results,
          currentIndex: report.totalEndpoints,
          totalCount: report.totalEndpoints,
        })
        // Scripts may have written env/global variables that the main process
        // already persisted to the DB (Keep variable values). Refresh the env
        // store so the env editor and the next "Send" see them without a manual
        // reload (issue #12).
        const wroteVars =
          Object.keys(report.envUpdates ?? {}).length > 0 ||
          Object.keys(report.globalUpdates ?? {}).length > 0
        if (wroteVars && state.keepVariableValues) {
          const envStore = useEnvironmentStore.getState()
          await Promise.all([envStore.fetchEnvironments(), envStore.fetchGlobalVariables()])
        }
      }
    } catch {
      // Error handled via results — but ensure we stop accepting late progress
      // even when execute() rejects so zombie events don't surface.
      acceptProgress = false
    } finally {
      try {
        unsubscribe?.()
      } catch {
        // ignore
      }
      set({ isRunning: false })
    }
  },

  stop: () => {
    window.api?.runner?.stop()
  },

  reset: () =>
    set({
      view: 'config',
      results: [],
      report: null,
      isRunning: false,
      currentIndex: 0,
      totalCount: 0,
      runStartedAt: null,
    }),
}))
