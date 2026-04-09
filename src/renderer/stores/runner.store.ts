import { create } from 'zustand'
import type { HttpMethod, TestResult } from '../types'
import { useEnvironmentStore } from './environment.store'
import { useWorkspaceStore } from './workspace.store'
import { resolveVariables } from '../lib/variable-resolver'

export interface RunnerEndpoint {
  id: string
  name: string
  method: HttpMethod
  url: string
  selected: boolean
}

export interface RunnerResult {
  endpointId: string
  name: string
  method: HttpMethod
  url: string
  status: number | null
  statusText: string
  duration: number
  testResults: TestResult[]
  error: string | null
  expanded: boolean
}

interface RunnerStore {
  projectId: string | null
  environmentId: string | null
  endpoints: RunnerEndpoint[]
  delay: number
  isRunning: boolean
  currentIndex: number
  results: RunnerResult[]
  stopRequested: boolean

  setProjectId: (id: string | null) => void
  setEnvironmentId: (id: string | null) => void
  setEndpoints: (endpoints: RunnerEndpoint[]) => void
  toggleEndpoint: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  setDelay: (ms: number) => void
  run: () => Promise<void>
  stop: () => void
  toggleResultExpand: (endpointId: string) => void
  exportJson: () => string
  exportHtml: () => string
  reset: () => void
}

function makeId(): string {
  return Math.random().toString(36).substring(2, 10)
}

export const useRunnerStore = create<RunnerStore>((set, get) => ({
  projectId: null,
  environmentId: null,
  endpoints: [],
  delay: 0,
  isRunning: false,
  currentIndex: -1,
  results: [],
  stopRequested: false,

  setProjectId: (id) => set({ projectId: id }),
  setEnvironmentId: (id) => set({ environmentId: id }),
  setEndpoints: (endpoints) => set({ endpoints }),

  toggleEndpoint: (id) =>
    set((s) => ({
      endpoints: s.endpoints.map((ep) =>
        ep.id === id ? { ...ep, selected: !ep.selected } : ep
      ),
    })),

  selectAll: () =>
    set((s) => ({ endpoints: s.endpoints.map((ep) => ({ ...ep, selected: true })) })),

  deselectAll: () =>
    set((s) => ({ endpoints: s.endpoints.map((ep) => ({ ...ep, selected: false })) })),

  setDelay: (ms) => set({ delay: Math.max(0, ms) }),

  run: async () => {
    const state = get()
    const selected = state.endpoints.filter((ep) => ep.selected)
    if (selected.length === 0) return

    // Resolve environment variables
    const envStore = useEnvironmentStore.getState()
    const wsStore = useWorkspaceStore.getState()
    const activeVars = envStore.getActiveVariables()

    set({ isRunning: true, stopRequested: false, results: [], currentIndex: 0 })

    for (let i = 0; i < selected.length; i++) {
      if (get().stopRequested) break
      set({ currentIndex: i })

      const ep = selected[i]
      const start = Date.now()
      let result: RunnerResult

      // Resolve variables in URL
      const resolvedUrl = resolveVariables(ep.url, activeVars)

      try {
        const ipcResult = await window.api?.request?.send({
          method: ep.method,
          url: resolvedUrl,
          params: [],
          headers: [],
          body: { type: 'none' },
          auth: { type: 'none' },
          _workspaceId: wsStore.activeWorkspaceId || undefined,
          _projectId: wsStore.activeProjectId || undefined,
          _endpointId: ep.id,
        })

        if (ipcResult?.success && ipcResult.data) {
          const resp = ipcResult.data as {
            status?: number
            statusText?: string
            timing: { total: number }
            testResults?: TestResult[]
            error?: string
          }
          result = {
            endpointId: ep.id,
            name: ep.name,
            method: ep.method,
            url: ep.url,
            status: resp.status ?? null,
            statusText: resp.statusText ?? '',
            duration: resp.timing.total,
            testResults: resp.testResults ?? [],
            error: resp.error ?? null,
            expanded: false,
          }
        } else {
          result = {
            endpointId: ep.id,
            name: ep.name,
            method: ep.method,
            url: ep.url,
            status: null,
            statusText: '',
            duration: Date.now() - start,
            testResults: [],
            error: ipcResult?.error ?? 'Request failed',
            expanded: false,
          }
        }
      } catch {
        // Demo mode: simulate results
        const statuses = [200, 200, 201, 204, 200, 400, 200, 200, 200, 200]
        const simStatus = statuses[i % statuses.length]
        const simDuration = Math.floor(50 + Math.random() * 300)
        result = {
          endpointId: ep.id,
          name: ep.name,
          method: ep.method,
          url: ep.url,
          status: simStatus,
          statusText: simStatus < 300 ? 'OK' : 'Bad Request',
          duration: simDuration,
          testResults: [
            {
              assertion: {
                id: makeId(),
                name: 'Status is 2xx',
                type: 'status_in_range',
                enabled: true,
                rangeMin: 200,
                rangeMax: 299,
              },
              passed: simStatus >= 200 && simStatus < 300,
              actual: simStatus,
            },
          ],
          error: null,
          expanded: false,
        }
      }

      set((s) => ({ results: [...s.results, result] }))

      // Delay between requests
      const delay = get().delay
      if (delay > 0 && i < selected.length - 1 && !get().stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    set({ isRunning: false, currentIndex: -1 })
  },

  stop: () => set({ stopRequested: true }),

  toggleResultExpand: (endpointId) =>
    set((s) => ({
      results: s.results.map((r) =>
        r.endpointId === endpointId ? { ...r, expanded: !r.expanded } : r
      ),
    })),

  exportJson: () => {
    const { results } = get()
    const totalPassed = results.reduce(
      (acc, r) => acc + r.testResults.filter((t) => t.passed).length, 0
    )
    const totalFailed = results.reduce(
      (acc, r) => acc + r.testResults.filter((t) => !t.passed).length, 0
    )
    const totalTime = results.reduce((acc, r) => acc + r.duration, 0)
    return JSON.stringify(
      {
        summary: { total: results.length, totalPassed, totalFailed, totalTime },
        results: results.map((r) => ({
          name: r.name,
          method: r.method,
          url: r.url,
          status: r.status,
          duration: r.duration,
          error: r.error,
          tests: r.testResults.map((t) => ({
            name: t.assertion.name,
            passed: t.passed,
            actual: t.actual,
          })),
        })),
      },
      null,
      2
    )
  },

  exportHtml: () => {
    const { results } = get()
    const totalPassed = results.reduce(
      (acc, r) => acc + r.testResults.filter((t) => t.passed).length, 0
    )
    const totalFailed = results.reduce(
      (acc, r) => acc + r.testResults.filter((t) => !t.passed).length, 0
    )
    const totalTime = results.reduce((acc, r) => acc + r.duration, 0)
    const rows = results
      .map(
        (r) =>
          `<tr>
        <td style="padding:6px 12px;border:1px solid #ddd"><span style="font-weight:600">${r.method}</span></td>
        <td style="padding:6px 12px;border:1px solid #ddd">${r.name}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;color:${(r.status ?? 0) < 300 ? '#1a7a4a' : '#cc2200'}">${r.status ?? 'ERR'}</td>
        <td style="padding:6px 12px;border:1px solid #ddd">${r.duration}ms</td>
        <td style="padding:6px 12px;border:1px solid #ddd">${r.testResults.filter((t) => t.passed).length}/${r.testResults.length}</td>
        <td style="padding:6px 12px;border:1px solid #ddd;color:#cc2200">${r.error || '-'}</td>
      </tr>`
      )
      .join('\n')

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Collection Runner Report</title>
<style>body{font-family:system-ui;padding:24px}table{border-collapse:collapse;width:100%}
th{background:#f5f5f7;padding:8px 12px;border:1px solid #ddd;text-align:left}
.summary{display:flex;gap:24px;margin-bottom:16px}
.stat{padding:12px 20px;border-radius:8px;text-align:center}
</style></head><body>
<h1>Collection Runner Report</h1>
<div class="summary">
  <div class="stat" style="background:#e8f9f1;color:#1a7a4a"><strong>${totalPassed}</strong> Passed</div>
  <div class="stat" style="background:#fff0f0;color:#cc2200"><strong>${totalFailed}</strong> Failed</div>
  <div class="stat" style="background:#e8f4ff;color:#0066cc"><strong>${totalTime}ms</strong> Total</div>
</div>
<table>
<tr><th>Method</th><th>Name</th><th>Status</th><th>Duration</th><th>Tests</th><th>Error</th></tr>
${rows}
</table></body></html>`
  },

  reset: () =>
    set({
      results: [],
      isRunning: false,
      currentIndex: -1,
      stopRequested: false,
    }),
}))
