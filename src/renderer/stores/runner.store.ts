import { create } from 'zustand'
import type { HttpMethod } from '../types'

// ─── Types matching main process runner ─────────────────────

export interface RunnerEndpoint {
  id: string
  name: string
  method: HttpMethod
  url: string
  selected: boolean
}

export interface AssertionResult {
  name: string
  passed: boolean
  actual?: string | number
  error?: string
}

export interface EndpointRunResult {
  endpointId: string
  endpointName: string
  folderName?: string
  method: string
  url: string
  status: number | null
  statusText: string
  duration: number
  passed: number
  failed: number
  skipped: number
  assertions: AssertionResult[]
  error?: string
  responseSize?: number
  responseBody?: string
  responseHeaders?: Record<string, string>
  requestHeaders?: Record<string, string>
  requestBody?: string
}

export interface RunnerReport {
  projectId: string
  startedAt: number
  completedAt: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
  totalAssertions: number
  passedAssertions: number
  failedAssertions: number
  results: EndpointRunResult[]
}

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
  delay: 1000,
  iterations: 1,
  iterationData: [],
  stopOnError: true,
  persistResponses: true,
  keepVariableValues: true,
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
      const result = await window.api?.runner?.execute({
        projectId,
        endpointIds: selected.map((ep) => ep.id),
        environmentId,
        workspaceId,
        delay: state.delay,
        iterations: state.iterations,
        stopOnError: state.stopOnError,
        persistResponses: state.persistResponses,
      })

      acceptProgress = false

      if (result?.success && result.data) {
        const report = result.data as RunnerReport
        set({
          report,
          results: report.results,
          currentIndex: report.totalEndpoints,
          totalCount: report.totalEndpoints,
        })
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
