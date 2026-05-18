import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Braces, ChevronRight } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { TreeNode, HttpMethod } from '../../types'
import RunnerSequence from './RunnerSequence'
import RunnerConfig, { type SchedulePayload } from './RunnerConfig'
import RunnerResults from './RunnerResults'
import { openEndpointTab, openSuiteItemTab } from '../../lib/open-endpoint-tab'
import { useUIStore } from '../../stores/ui.store'
import RunnerVariables from './RunnerVariables'
import RunnerHistory from './RunnerHistory'
import ScheduledTasksView from './ScheduledTasksView'
import TestsHome from './TestsHome'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'

/* ── Types ─────────────────────────────────────────────────── */

export interface RunnerEndpointItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  selected: boolean
  folderName?: string
}

export interface RunnerFolderGroup {
  folderId: string
  folderName: string
  endpoints: RunnerEndpointItem[]
}

/* ── Helpers ───────────────────────────────────────────────── */

function collectEndpointsFromNode(node: TreeNode): RunnerEndpointItem[] {
  const result: RunnerEndpointItem[] = []
  if ((node.type === 'endpoint' || node.type === 'request') && node.method && node.path) {
    result.push({
      id: node.id,
      name: node.label,
      method: node.method as HttpMethod,
      url: node.path,
      selected: true,
    })
  }
  if (node.children) {
    for (const child of node.children) {
      result.push(...collectEndpointsFromNode(child))
    }
  }
  return result
}

/** Recursively collect folder groups — each folder becomes its own group with full path */
function collectFolderGroupsFromNode(
  node: TreeNode,
  groups: RunnerFolderGroup[],
  parentPath?: string,
): void {
  if (!node.children) return
  const fullName = parentPath ? `${parentPath} / ${node.label}` : node.label
  const directEps: RunnerEndpointItem[] = []
  for (const child of node.children) {
    if ((child.type === 'endpoint' || child.type === 'request') && child.method && child.path) {
      directEps.push({
        id: child.id,
        name: child.label,
        method: child.method as HttpMethod,
        url: child.path,
        selected: true,
      })
    }
  }
  if (directEps.length > 0) {
    groups.push({ folderId: node.id, folderName: fullName, endpoints: directEps })
  }
  for (const child of node.children) {
    if (child.type === 'folder' || child.type === 'module') {
      collectFolderGroupsFromNode(child, groups, fullName)
    }
  }
}

function collectFolderGroups(nodes: TreeNode[]): RunnerFolderGroup[] {
  const groups: RunnerFolderGroup[] = []
  for (const root of nodes) {
    if (root.type === 'module' || root.type === 'folder') {
      collectFolderGroupsFromNode(root, groups)
    }
  }
  return groups
}

function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

/* ── Resizable divider ─────────────────────────────────────── */

function ResizeDivider({ onDrag }: { onDrag: (dx: number) => void }) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastX = e.clientX
      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - lastX
        lastX = ev.clientX
        onDrag(dx)
      }
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [onDrag],
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className="shrink-0"
      style={{
        width: 5,
        cursor: 'col-resize',
        background: 'transparent',
        position: 'relative',
        zIndex: 10,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 2,
          width: 1,
          background: 'var(--border)',
        }}
      />
    </div>
  )
}

/* ── RunnerTab ─────────────────────────────────────────────── */

interface RunnerTabProps {
  folderId?: string
  tabId?: string
  sessionKey?: string
}

export default function RunnerTab({ folderId, tabId, sessionKey }: RunnerTabProps) {
  const treeData = useWorkspaceStore((s) => s.treeData)
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  // Share the right-panel collapse flag with the API workbench so the
  // "All variables" toggle behaves identically across screens.
  const rightPanelCollapsed = useUIStore((s) => s.rightPanelCollapsed)
  const setRightPanelCollapsed = useUIStore((s) => s.setRightPanelCollapsed)

  const [endpoints, setEndpoints] = useState<RunnerEndpointItem[]>([])
  const [folderGroups, setFolderGroups] = useState<RunnerFolderGroup[]>([])
  // Persist runner view + selected run id under the tab so tab switches don't
  // bounce the user back to "config" (v1.3.1 §5.11 E11). The key intentionally
  // mirrors the runner-report sessionStorage prefix so cleanup stays local
  // to RunnerTab.
  const viewStorageKey = tabId ? `runner-view-${tabId}` : null
  const [view, setView] = useState<'home' | 'config' | 'results' | 'history' | 'scheduled'>(() => {
    if (viewStorageKey) {
      const stored = sessionStorage.getItem(viewStorageKey)
      if (
        stored === 'home' ||
        stored === 'config' ||
        stored === 'results' ||
        stored === 'history' ||
        stored === 'scheduled'
      ) {
        return stored
      }
    }
    // Default landing page is the Tests overview (TestsHome), not the runner
    // config. Dropping straight into the run-config screen — with the full
    // APIs collection auto-selected — was disorienting: users open the Tests
    // sidebar expecting an Overview / Recent runs / Test Suites summary,
    // not a 200-endpoint "ready to fire" list. The session-restore branch
    // above still works for tab switches mid-flight (B13). Explicit entry
    // points (TestsHome "New Run", suite right-click, ScheduledTasks picker)
    // flip to 'config' themselves once the user actually asks to run.
    return 'home'
  })
  // Persist the current view whenever it changes so a remount lands here.
  useEffect(() => {
    if (!viewStorageKey) return
    sessionStorage.setItem(viewStorageKey, view)
  }, [view, viewStorageKey])
  const [delay, setDelay] = useState(0)
  const [iterations, setIterations] = useState(1)
  const [iterationData, setIterationData] = useState<Record<string, string>[]>([])
  const [environmentId, setEnvironmentId] = useState('')
  const [stopOnError, setStopOnError] = useState(true)
  const [persistResponses, setPersistResponses] = useState(true)
  const [keepVariableValues, setKeepVariableValues] = useState(true)
  const [runFolderName, setRunFolderName] = useState('')
  // Default radio selection for the RunnerConfig "Choose how to run" block.
  // We bump configRunModeKey whenever a fresh "New Run" lands on the config
  // view, so RunnerConfig snaps the radio back to the requested default even
  // if the user had toggled it earlier. Entering from Scheduled Tasks means
  // the user clearly wants the schedule path — defaulting to 'manual' there
  // hides the schedule fields and forces an extra click.
  const [defaultRunMode, setDefaultRunMode] = useState<'manual' | 'schedule'>('manual')
  const [configRunModeKey, setConfigRunModeKey] = useState(0)

  // Resizable panel widths
  const containerRef = useRef<HTMLDivElement>(null)
  const [sequenceWidth, setSequenceWidth] = useState(360)
  const [variablesWidth, setVariablesWidth] = useState(260)

  // Run state
  const [isRunning, setIsRunning] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [results, setResults] = useState<EndpointRunResult[]>([])
  const [report, setReport] = useState<RunnerReport | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)

  // Origin tracking: 'apis' if opened via right-click Run on APIs tree, 'suite' if from Test Suite, 'runner' otherwise
  const [runOrigin, setRunOrigin] = useState<'apis' | 'suite' | 'runner'>(
    folderId ? 'apis' : 'runner',
  )
  const [runSourceLabel, setRunSourceLabel] = useState<string>('Runner')

  // Track pending autoRun data so we can trigger after endpoints are loaded
  const pendingAutoRunRef = useRef<{
    endpointIds: string[]
    folderName?: string
    sourceType?: 'suite' | 'apis' | 'runner'
  } | null>(null)

  // When the tab was opened from a Test Suite, hold onto the suite's endpoint
  // IDs for the lifetime of the tab — the tree-collection effect must keep
  // filtering even after the initial auto-run completes (Bug 2). Lazy init
  // reads sessionStorage so the filter is correct on the FIRST render, but
  // the value is also re-derived in the sessionStorage effect below whenever
  // the tab is reused with a fresh sessionKey (switching between suites).
  const [suiteFilterIds, setSuiteFilterIds] = useState<Set<string> | null>(() => {
    if (!tabId) return null
    try {
      const stored = sessionStorage.getItem(`runner-report-${tabId}`)
      if (!stored) return null
      const data = JSON.parse(stored) as {
        sourceType?: string
        endpointIds?: string[]
      }
      // Only auto-run paths bring endpointIds; the browse-only suite click
      // leaves them undefined and the suite-items effect handles the list.
      if (data.sourceType === 'suite' && Array.isArray(data.endpointIds)) {
        return new Set(data.endpointIds)
      }
    } catch {
      /* ignore */
    }
    return null
  })

  // When suite items are passed (post-refactor self-contained model), they're
  // NOT in the APIs treeData — they live in `test_suite_items`. Hold the
  // suite id so the dedicated effect below can fetch + render them directly,
  // bypassing the tree filter that only works for endpoint ids.
  const [suiteIdForRunner, setSuiteIdForRunner] = useState<string | null>(() => {
    if (!tabId) return null
    try {
      const stored = sessionStorage.getItem(`runner-report-${tabId}`)
      if (!stored) return null
      const data = JSON.parse(stored) as { sourceType?: string; suiteId?: string }
      if (data.sourceType === 'suite' && typeof data.suiteId === 'string') {
        return data.suiteId
      }
    } catch {
      /* ignore */
    }
    return null
  })

  // Check for pre-loaded report data or viewAllRuns from sidebar
  useEffect(() => {
    if (!tabId) return
    const key = `runner-report-${tabId}`
    const stored = sessionStorage.getItem(key)
    if (stored) {
      sessionStorage.removeItem(key)
      try {
        const data = JSON.parse(stored)
        if (data.viewHome) {
          setView('home')
        } else if (data.viewAllRuns) {
          setView('history')
        } else if (data.viewScheduledTasks) {
          setView('scheduled')
        } else if (data.sourceType === 'suite' && typeof data.suiteId === 'string') {
          // Suite mode covers both:
          //   - auto-run from "Run Suite" (carries endpointIds)
          //   - browse-only from clicking the suite name (no endpointIds)
          // The suite-items effect fetches everything from `suiteId`; the
          // pending ref only fires when auto-run is requested.
          if (data.autoRun && Array.isArray(data.endpointIds)) {
            pendingAutoRunRef.current = {
              endpointIds: data.endpointIds,
              folderName: data.folderName,
              sourceType: 'suite',
            }
          }
          if (data.folderName) setRunFolderName(data.folderName)
          setRunOrigin('suite')
          setSuiteFilterIds(
            Array.isArray(data.endpointIds) ? new Set(data.endpointIds as string[]) : null,
          )
          setSuiteIdForRunner(data.suiteId)
          // When the suite was opened explicitly to schedule it (ScheduledTasksView
          // → "New Run" → pick suite), snap the radio in RunnerConfig to
          // "Schedule runs" so the user doesn't have to toggle it manually.
          if (data.scheduleMode) {
            setDefaultRunMode('schedule')
            setConfigRunModeKey((k) => k + 1)
          }
          // Force the config view — the runner tab is reused, and a previous
          // session (TestsHome, All Runs, prior results) may have parked it
          // on another view. Auto-run paths flip to 'results' on their own.
          setView('config')
        } else if (data.autoRun && data.endpointIds) {
          pendingAutoRunRef.current = {
            endpointIds: data.endpointIds,
            folderName: data.folderName,
            sourceType: data.sourceType,
          }
          if (data.folderName) setRunFolderName(data.folderName)
          if (data.sourceType === 'apis') {
            setRunOrigin('apis')
            setSuiteFilterIds(null)
            setSuiteIdForRunner(null)
          } else {
            setSuiteFilterIds(null)
            setSuiteIdForRunner(null)
          }
        } else {
          const typed = data as {
            results: EndpointRunResult[]
            report: RunnerReport
            startedAt: number
          }
          setResults(typed.results)
          setReport(typed.report)
          setRunStartedAt(typed.startedAt)
          setView('results')
        }
      } catch {
        /* ignore */
      }
    }
  }, [tabId, sessionKey])

  // Auto-run: once endpoints are loaded and we have pending autoRun, select & run
  useEffect(() => {
    const pending = pendingAutoRunRef.current
    if (!pending || endpoints.length === 0) return
    pendingAutoRunRef.current = null

    const targetIds = new Set(pending.endpointIds)
    // Select only the target endpoints
    setEndpoints((eps) => eps.map((ep) => ({ ...ep, selected: targetIds.has(ep.id) })))
    setFolderGroups((groups) =>
      groups.map((g) => ({
        ...g,
        endpoints: g.endpoints.map((ep) => ({ ...ep, selected: targetIds.has(ep.id) })),
      })),
    )

    // Trigger run after a tick so state is updated
    setTimeout(() => {
      // Build selected list directly from pending IDs matched against current endpoints
      const matched = endpoints.filter((ep) => targetIds.has(ep.id))
      if (matched.length === 0) return

      setView('results')
      setIsRunning(true)
      setResults([])
      setReport(null)
      setCurrentIndex(0)
      setTotalCount(matched.length)
      setRunStartedAt(Date.now())
      setSelectedResultId(null)

      const unsubscribe = window.api?.runner?.onProgress?.((progress: unknown) => {
        const p = progress as { current: number; total: number; result: EndpointRunResult }
        setCurrentIndex(p.current)
        setTotalCount(p.total)
        setResults((prev) => [...prev, p.result])
      })

      const labelName = pending.folderName || runFolderName
      const origin = pending.sourceType || (folderId ? 'apis' : 'runner')
      const sourceLabel =
        origin === 'suite' && labelName
          ? `Suite: ${labelName}`
          : origin === 'apis' && labelName
            ? `APIs: ${labelName}`
            : 'Runner'
      setRunSourceLabel(sourceLabel)
      setRunOrigin(origin)

      window.api?.runner
        ?.execute({
          projectId: activeProjectId || '',
          endpointIds: matched.map((ep) => ep.id),
          environmentId: environmentId || undefined,
          workspaceId: activeWorkspaceId || undefined,
          delay,
          iterations,
          iterationData: iterationData.length > 0 ? iterationData : undefined,
          folderName: pending.folderName || runFolderName || undefined,
          sourceLabel,
        })
        .then((result: unknown) => {
          const res = result as { success: boolean; data?: RunnerReport }
          if (res?.success && res.data) {
            setReport(res.data)
            setResults(res.data.results)
            setCurrentIndex(res.data.totalEndpoints)
            setTotalCount(res.data.totalEndpoints)
          }
        })
        .finally(() => {
          unsubscribe?.()
          setIsRunning(false)
        })
    }, 100)
  }, [
    endpoints,
    activeProjectId,
    activeWorkspaceId,
    environmentId,
    delay,
    iterations,
    iterationData,
    runFolderName,
    folderId,
  ])

  // Collect endpoints and folder groups from the target folder/module.
  // When the tab was opened from a Test Suite, only the suite's endpoints
  // are surfaced — otherwise the user would see (and be able to re-run)
  // every endpoint in the project (Bug 2).
  useEffect(() => {
    // Suite-with-suiteId path is handled by the dedicated effect below —
    // suite items live in their own table, not in the APIs treeData.
    if (suiteIdForRunner) return

    if (!folderId) {
      const all: RunnerEndpointItem[] = []
      for (const root of treeData) {
        all.push(...collectEndpointsFromNode(root))
      }
      const eps = suiteFilterIds ? all.filter((ep) => suiteFilterIds.has(ep.id)) : all
      setEndpoints(eps)
      setFolderGroups(suiteFilterIds ? [] : collectFolderGroups(treeData))
      setRunFolderName(suiteFilterIds ? runFolderName || 'Suite' : treeData[0]?.label || 'All')
      return
    }

    const node = findNodeById(treeData, folderId)
    if (node) {
      const collected = collectEndpointsFromNode(node)
      const eps = suiteFilterIds ? collected.filter((ep) => suiteFilterIds.has(ep.id)) : collected
      setEndpoints(eps)
      setRunFolderName(node.label)
      if (node.type === 'folder' || node.type === 'module') {
        const groups: RunnerFolderGroup[] = []
        collectFolderGroupsFromNode(node, groups)
        setFolderGroups(
          groups.length > 0
            ? groups
            : [{ folderId: node.id, folderName: node.label, endpoints: eps }],
        )
      }
    }
  }, [folderId, treeData, suiteFilterIds, suiteIdForRunner])

  // Test-Suite path: items live in `test_suite_items`, not in APIs treeData,
  // so fetch them directly and build the run sequence from suite-item rows.
  // Folders (when present) become the group labels — same shape Postman uses.
  useEffect(() => {
    if (!suiteIdForRunner) return
    let cancelled = false

    const fetchAndApply = async () => {
      const res = await window.api?.testSuite?.listEndpoints?.(suiteIdForRunner)
      if (cancelled || !res?.success || !res.data) return
      const { items = [], folders = [] } = res.data as {
        items: Array<{
          id: string
          name: string
          method: string | null
          url: string | null
          folder_id: string | null
        }>
        folders: Array<{ id: string; name: string }>
      }

      const toRunnerItem = (it: (typeof items)[number]): RunnerEndpointItem => ({
        id: it.id,
        name: it.name,
        method: (it.method || 'GET').toUpperCase() as HttpMethod,
        url: it.url || '',
        selected: true,
      })

      setEndpoints(items.map(toRunnerItem))

      if (folders.length > 0) {
        const folderById = new Map(folders.map((f) => [f.id, f.name]))
        const groups: RunnerFolderGroup[] = []
        const groupByFolderId = new Map<string | 'root', RunnerFolderGroup>()
        for (const it of items) {
          const key = it.folder_id ?? 'root'
          const folderName =
            key === 'root' ? runFolderName || 'Suite' : folderById.get(it.folder_id!) || 'Folder'
          let group = groupByFolderId.get(key)
          if (!group) {
            group = { folderId: String(key), folderName, endpoints: [] }
            groupByFolderId.set(key, group)
            groups.push(group)
          }
          group.endpoints.push(toRunnerItem(it))
        }
        setFolderGroups(groups)
      } else {
        setFolderGroups([])
      }
    }

    fetchAndApply()

    // Refetch whenever a suite item is renamed / reordered / created via any
    // sibling component (TestsPanel sidebar, URL-bar Save, tab rename). The
    // same event drives the sidebar refresh, so both surfaces stay in sync.
    const refetch = () => {
      void fetchAndApply()
    }
    window.addEventListener('tests:suite-item-changed', refetch)
    return () => {
      cancelled = true
      window.removeEventListener('tests:suite-item-changed', refetch)
    }
  }, [suiteIdForRunner, runFolderName])

  const toggleEndpoint = useCallback((id: string) => {
    setEndpoints((eps) => eps.map((ep) => (ep.id === id ? { ...ep, selected: !ep.selected } : ep)))
    setFolderGroups((groups) =>
      groups.map((g) => ({
        ...g,
        endpoints: g.endpoints.map((ep) => (ep.id === id ? { ...ep, selected: !ep.selected } : ep)),
      })),
    )
  }, [])

  const selectAll = useCallback(() => {
    setEndpoints((eps) => eps.map((ep) => ({ ...ep, selected: true })))
    setFolderGroups((groups) =>
      groups.map((g) => ({
        ...g,
        endpoints: g.endpoints.map((ep) => ({ ...ep, selected: true })),
      })),
    )
  }, [])

  const deselectAll = useCallback(() => {
    setEndpoints((eps) => eps.map((ep) => ({ ...ep, selected: false })))
    setFolderGroups((groups) =>
      groups.map((g) => ({
        ...g,
        endpoints: g.endpoints.map((ep) => ({ ...ep, selected: false })),
      })),
    )
  }, [])

  const selectedCount = useMemo(() => endpoints.filter((ep) => ep.selected).length, [endpoints])

  const handleRun = useCallback(async () => {
    const selected = endpoints.filter((ep) => ep.selected)
    if (selected.length === 0) return

    setView('results')
    setIsRunning(true)
    setResults([])
    setReport(null)
    setCurrentIndex(0)
    setTotalCount(selected.length)
    setRunStartedAt(Date.now())
    setSelectedResultId(null)

    const unsubscribe = window.api?.runner?.onProgress?.((progress: unknown) => {
      const p = progress as { current: number; total: number; result: EndpointRunResult }
      setCurrentIndex(p.current)
      setTotalCount(p.total)
      setResults((prev) => [...prev, p.result])
    })

    const sourceLabel =
      runOrigin === 'suite' && runFolderName
        ? `Suite: ${runFolderName}`
        : runOrigin === 'apis' && runFolderName
          ? `APIs: ${runFolderName}`
          : 'Runner'
    setRunSourceLabel(sourceLabel)

    try {
      const result = await window.api?.runner?.execute({
        projectId: activeProjectId || '',
        endpointIds: selected.map((ep) => ep.id),
        environmentId: environmentId || undefined,
        workspaceId: activeWorkspaceId || undefined,
        delay,
        iterations,
        iterationData: iterationData.length > 0 ? iterationData : undefined,
        folderName: runFolderName || undefined,
        sourceLabel,
      })

      if (result?.success && result.data) {
        const rep = result.data as RunnerReport
        setReport(rep)
        setResults(rep.results)
        setCurrentIndex(rep.totalEndpoints)
        setTotalCount(rep.totalEndpoints)
      }
    } catch {
      // handled by results
    } finally {
      unsubscribe?.()
      setIsRunning(false)
    }
  }, [
    endpoints,
    activeProjectId,
    activeWorkspaceId,
    environmentId,
    delay,
    iterations,
    iterationData,
    runFolderName,
    runOrigin,
  ])

  const handleStop = useCallback(() => {
    window.api?.runner?.stop()
  }, [])

  const handleNewRun = useCallback((mode?: 'manual' | 'schedule' | unknown) => {
    // Defensive guard: this callback is wired to several <button onClick>
    // sites (TestsHome, RunnerResults, RunnerHistory). React passes the
    // SyntheticEvent as the first argument from those bindings — without
    // this guard we'd stash a MouseEvent into `defaultRunMode`, which then
    // poisons `RunnerConfig` state and renders a blank workbench (B5).
    const safeMode: 'manual' | 'schedule' = mode === 'schedule' ? 'schedule' : 'manual'
    setDefaultRunMode(safeMode)
    setConfigRunModeKey((k) => k + 1)
    setView('config')
    setResults([])
    setReport(null)
    setSelectedResultId(null)
    // Reset the suite scope. "New Run" is a fresh start — the user
    // explicitly wants the APIs-tree picker, not the previously-loaded
    // suite. Without this, picking a suite via the ScheduledTasks dropdown
    // pinned `suiteIdForRunner` on the tab, so a later "Pick endpoints
    // from APIs…" still rendered the suite's items.
    setSuiteFilterIds(null)
    setSuiteIdForRunner(null)
    setRunOrigin('runner')
    setRunFolderName('')
  }, [])

  const handleViewAllRuns = useCallback(() => {
    setView('history')
  }, [])

  const handleViewReport = useCallback(
    (
      histResults: EndpointRunResult[],
      histReport: RunnerReport,
      startedAt: number,
      sourceLabel?: string,
    ) => {
      setResults(histResults)
      setReport(histReport)
      setRunStartedAt(startedAt)
      setSelectedResultId(null)
      setRunSourceLabel(sourceLabel || 'Runner')
      setView('results')
    },
    [],
  )

  const handleSchedule = useCallback(
    async (payload: SchedulePayload) => {
      const selected = endpoints.filter((ep) => ep.selected)
      if (selected.length === 0) return

      try {
        const result = await window.api.scheduler.create({
          projectId: activeProjectId || '',
          // Auto-derive a human name. If the runner tab knows the suite or
          // folder it's working with, surface that — otherwise we used to
          // print only the timestamp which made the Scheduled Tasks table
          // unreadable when you had more than a couple of rows.
          name: `${runFolderName || 'Scheduled Run'} — ${new Date().toLocaleString()}`,
          endpointIds: selected.map((ep) => ep.id),
          folderId: folderId || undefined,
          environmentId: environmentId || undefined,
          intervalValue: payload.intervalValue,
          intervalUnit: payload.intervalUnit,
          delayMs: delay,
          scheduleType: payload.scheduleType,
          scheduleTime: payload.scheduleTime,
          scheduleDays: payload.scheduleDays,
          scheduleCron: payload.scheduleCron,
          suiteId: suiteIdForRunner || undefined,
        })
        if (result?.success) {
          setView('scheduled')
        } else {
          console.error('Failed to create scheduled task:', result?.error)
        }
      } catch (e) {
        console.error('Failed to create scheduled task:', e)
      }
    },
    [endpoints, activeProjectId, folderId, environmentId, delay, runFolderName, suiteIdForRunner],
  )

  const handleSequenceResize = useCallback((dx: number) => {
    setSequenceWidth((w) => Math.max(200, Math.min(600, w + dx)))
  }, [])

  const handleVariablesResize = useCallback((dx: number) => {
    setVariablesWidth((w) => Math.max(180, Math.min(400, w - dx)))
  }, [])

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden">
      {/* Left + Middle */}
      <div className="flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {view === 'home' ? (
          <TestsHome
            onViewAllRuns={() => setView('history')}
            onViewScheduled={() => setView('scheduled')}
            onNewRun={handleNewRun}
            onViewReport={handleViewReport}
          />
        ) : view === 'scheduled' ? (
          <ScheduledTasksView onBack={() => setView('home')} />
        ) : view === 'history' ? (
          <RunnerHistory
            onBack={() => setView(results.length > 0 ? 'results' : 'home')}
            onNewRun={handleNewRun}
            onViewReport={handleViewReport}
          />
        ) : view === 'config' ? (
          <>
            {/* Run Sequence (left) — resizable */}
            <div
              style={{ width: sequenceWidth, flexShrink: 0, overflow: 'hidden', display: 'flex' }}
            >
              <RunnerSequence
                endpoints={endpoints}
                folderGroups={folderGroups}
                onToggle={toggleEndpoint}
                onSelectAll={selectAll}
                onDeselectAll={deselectAll}
                onReset={selectAll}
                onReorder={
                  suiteIdForRunner
                    ? async (draggedId, insertBeforeId) => {
                        // Persist through the suite move IPC (single
                        // transaction renumber). The shared event drives both
                        // the sidebar reload and the runner's suite-items
                        // effect — one signal, both surfaces stay in sync.
                        await window.api?.testSuiteItem?.move({
                          id: draggedId,
                          targetSuiteId: suiteIdForRunner,
                          targetFolderId: null,
                          insertBeforeId,
                        })
                        window.dispatchEvent(new CustomEvent('tests:suite-item-changed'))
                      }
                    : undefined
                }
              />
            </div>
            <ResizeDivider onDrag={handleSequenceResize} />
            {/* Config (middle) */}
            <div className="flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
              <RunnerConfig
                delay={delay}
                setDelay={setDelay}
                iterations={iterations}
                setIterations={setIterations}
                environmentId={environmentId}
                setEnvironmentId={setEnvironmentId}
                stopOnError={stopOnError}
                setStopOnError={setStopOnError}
                persistResponses={persistResponses}
                setPersistResponses={setPersistResponses}
                keepVariableValues={keepVariableValues}
                setKeepVariableValues={setKeepVariableValues}
                iterationData={iterationData}
                setIterationData={setIterationData}
                onRun={handleRun}
                onSchedule={handleSchedule}
                isRunning={isRunning}
                selectedCount={selectedCount}
                initialRunMode={defaultRunMode}
                initialRunModeKey={configRunModeKey}
                // Scheduling lives on Test Suites. APIs / folder runs are
                // one-shots; hiding the Schedule radio prevents stranded
                // "Scheduled: ad-hoc" tasks that no one knows where to find.
                canSchedule={!!suiteIdForRunner}
              />
            </div>
          </>
        ) : (
          <RunnerResults
            results={results}
            report={report}
            isRunning={isRunning}
            currentIndex={currentIndex}
            totalCount={totalCount}
            runStartedAt={runStartedAt}
            sourceLabel={runSourceLabel}
            onStop={handleStop}
            onNewRun={handleNewRun}
            onRunAgain={handleRun}
            onViewAllRuns={handleViewAllRuns}
            selectedResultId={selectedResultId}
            onSelectResult={setSelectedResultId}
            onOpenEndpoint={(itemId) => {
              // Suite runs carry test_suite_items ids — those open as suite
              // item tabs and the sidebar stays on Tests. APIs / Runner runs
              // carry endpoint ids and route to the APIs workbench instead.
              if (runOrigin === 'suite') {
                void openSuiteItemTab(itemId)
              } else {
                useUIStore.getState().setActiveSidebarPage('apis')
                void openEndpointTab(itemId)
              }
            }}
          />
        )}
      </div>

      {/* Right: All Variables — collapsible (mirrors the API request screen's
          right-panel toggle so users get the same hide/show behaviour
          everywhere). Resize handle is hidden while collapsed. */}
      {!rightPanelCollapsed && <ResizeDivider onDrag={handleVariablesResize} />}
      {rightPanelCollapsed ? (
        <div
          className="flex shrink-0 flex-col items-center gap-1 border-l border-[var(--border)] bg-[var(--bg)] py-2"
          style={{ width: 40 }}
        >
          <button
            type="button"
            onClick={() => setRightPanelCollapsed(false)}
            title="Show variables"
            aria-label="Show variables panel"
            className="flex cursor-pointer items-center justify-center rounded p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--accent)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <Braces size={16} />
          </button>
        </div>
      ) : (
        <div
          style={{
            width: variablesWidth,
            flexShrink: 0,
            overflow: 'hidden',
            display: 'flex',
            position: 'relative',
          }}
        >
          <RunnerVariables environmentId={environmentId} fillParent />
          {/* Collapse button — top-right of the variables panel */}
          <button
            type="button"
            onClick={() => setRightPanelCollapsed(true)}
            title="Collapse panel"
            aria-label="Collapse variables panel"
            className="absolute right-1 top-1 z-10 flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
