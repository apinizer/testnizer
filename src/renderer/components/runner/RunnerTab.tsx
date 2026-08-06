import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { buildExecutePayload, RUNNER_DEFAULTS } from '../../lib/runner-payload'
import { Braces, ChevronRight } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import type { TreeNode, HttpMethod } from '../../types'
import RunnerSequence from './RunnerSequence'
import RunnerConfig, { type SchedulePayload } from './RunnerConfig'
import RunnerResults from './RunnerResults'
import { openEndpointTab, openSuiteItemTab } from '../../lib/open-endpoint-tab'
import { saveDirtyRunItemsBeforeRun } from '../../lib/dirty-run-guard'
import { useUIStore } from '../../stores/ui.store'
import RunnerVariables from './RunnerVariables'
import RunnerHistory from './RunnerHistory'
import ScheduledTasksView from './ScheduledTasksView'
import TestsHome from './TestsHome'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import type { RunPhase } from '../../../shared/runner-verdict'
import { lockDragStyles } from '../../lib/drag-lock'
import { setRunnerBusy } from '../../lib/runner-activity'

/**
 * After a run, refresh the renderer env store from the DB so script-written
 * variables (e.g. a token captured by a post-response `pm.environment.set`)
 * show up in the env editor and resolve on the next Send — the main process
 * already persisted them ("Keep variable values"). Without this the folder /
 * APIs run path left the store stale, so `{{accessToken}}` came back empty and
 * users had to retype it by hand (mirrors runner.store.run, which already did
 * this — RunnerTab's own execute path was the gap).
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

/* ── Types ─────────────────────────────────────────────────── */

export interface RunnerEndpointItem {
  id: string
  name: string
  method: HttpMethod
  url: string
  selected: boolean
  folderName?: string
  /**
   * Lifecycle phase for THIS run (issue #72). Undefined = 'main' (the flow).
   * Setup requests execute once before the flow, teardown once after it — and
   * teardown still executes when the run stops early.
   */
  phase?: RunPhase
}

export interface RunnerFolderGroup {
  folderId: string
  /** Full path ("Module / Auth"), used when the sequence is rendered flat. */
  folderName: string
  /**
   * Leaf name only — what a tree row shows (issue #90). Rendering the full path
   * on every level is what made a nested suite read as a flat list of
   * lookalike labels.
   */
  label: string
  /**
   * Parent folder id, or null at the root. Without this the groups were a flat
   * array whose only clue to the hierarchy was a " / "-joined string, so the
   * structure could be printed but not walked — no expand/collapse, and no way
   * to apply a role to a folder AND everything beneath it.
   */
  parentId: string | null
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

/**
 * Recursively collect folder groups — one group per folder, carrying its parent
 * so the sequence can be rendered as the tree the user organised (issue #90).
 *
 * Folders with no DIRECT requests are collected too, even though they produce
 * no rows themselves: dropping them broke the parent chain, and a child folder
 * whose parent is missing cannot be placed. The sequence prunes branches that
 * hold no requests at all at render time, where it can see the whole subtree.
 */
function collectFolderGroupsFromNode(
  node: TreeNode,
  groups: RunnerFolderGroup[],
  parentPath?: string,
  parentId: string | null = null,
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
  groups.push({
    folderId: node.id,
    folderName: fullName,
    label: node.label,
    parentId,
    endpoints: directEps,
  })
  for (const child of node.children) {
    if (child.type === 'folder' || child.type === 'module') {
      collectFolderGroupsFromNode(child, groups, fullName, node.id)
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
        releaseStyles()
      }
      const releaseStyles = lockDragStyles('col-resize')
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
  // Set when this tab was opened by an entry point that explicitly asked for the
  // run config without a suite/folder scope (the Command Palette's "Open
  // collection runner"). It lets the config screen survive a remount without
  // loosening the scope guard below for everyone else.
  const explicitConfig = useRef(false)
  const [view, setView] = useState<'home' | 'config' | 'results' | 'history' | 'scheduled'>(() => {
    if (viewStorageKey) {
      const stored = sessionStorage.getItem(viewStorageKey)
      if (stored === 'config-explicit') {
        explicitConfig.current = true
        return 'config'
      }
      // 'config' can only be restored when the tab has a concrete scope
      // (suite or APIs folder). Without one, restoring 'config' produces
      // the dreaded "all 200 endpoints from the project" sequence — the
      // exact screen we removed from every entry point. Fall back to
      // 'home' so the user lands on the curated Tests overview instead.
      if (stored === 'config') {
        try {
          const sess = tabId ? sessionStorage.getItem(`runner-report-${tabId}`) : null
          const data = sess ? (JSON.parse(sess) as { sourceType?: string; suiteId?: string }) : null
          const hasSuiteScope = data?.sourceType === 'suite' && typeof data.suiteId === 'string'
          if (hasSuiteScope || folderId) return 'config'
        } catch {
          /* fall through to 'home' */
        }
        return 'home'
      }
      if (
        stored === 'home' ||
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
    // Keep the sentinel for a scopeless explicit config — writing a plain
    // 'config' would make the guard above bounce the next remount to 'home'.
    const scoped = Boolean(folderId)
    sessionStorage.setItem(
      viewStorageKey,
      view === 'config' && explicitConfig.current && !scoped ? 'config-explicit' : view,
    )
  }, [view, viewStorageKey, folderId])
  // Run settings stay LOCAL to this tab on purpose: a runner tab is per-tab
  // (`tabId`-keyed session storage, the React `key` fix from issue #66), so
  // hoisting them into the global store would make two open runner tabs share
  // one set of checkboxes. Only the defaults are shared — see runner-payload.
  const [delay, setDelay] = useState(RUNNER_DEFAULTS.delay)
  const [iterationDelay, setIterationDelay] = useState(RUNNER_DEFAULTS.iterationDelay)
  const [iterations, setIterations] = useState(RUNNER_DEFAULTS.iterations)
  const [iterationData, setIterationData] = useState<Record<string, string>[]>([])
  const [environmentId, setEnvironmentId] = useState('')
  const [stopOnError, setStopOnError] = useState(RUNNER_DEFAULTS.stopOnError)
  const [persistResponses, setPersistResponses] = useState(RUNNER_DEFAULTS.persistResponses)
  const [keepVariableValues, setKeepVariableValues] = useState(RUNNER_DEFAULTS.keepVariableValues)
  // Run-level hook scripts (issue #72). Per-run config, like iterations/delay —
  // deliberately not persisted, see the run-lifecycle notes.
  const [runPreScript, setRunPreScript] = useState('')
  const [runPostScript, setRunPostScript] = useState('')
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
  /** Cleanup has begun — signalled by main, since a finished-step tick can't say so. */
  const [teardownStarted, setTeardownStarted] = useState(false)
  /**
   * Which stop the user has asked for, if any (issue #91).
   *
   * Purely so the click leaves a mark. A graceful Stop cannot interrupt the
   * request already on the wire, so for up to a request's worth of time the
   * screen looked exactly as it did before the click — and "the Stop button
   * does nothing" is precisely how the bug was reported. The buttons read
   * "Stopping…" / "Halting…" from here.
   */
  const [stopRequested, setStopRequested] = useState<'graceful' | 'direct' | null>(null)
  // Publish it so a second "Run" on this folder focuses the live run instead of
  // remounting the tab out from under it (see runner-activity.ts).
  useEffect(() => {
    if (!tabId) return
    setRunnerBusy(tabId, isRunning)
    return () => setRunnerBusy(tabId, false)
  }, [tabId, isRunning])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  // Persist the inspected run snapshot too (not just the selectedResultId).
  // Without this, opening an All Runs detail → switching tabs → coming back
  // restored `view='results'` via runner-view-${tabId} but `results`/`report`
  // stayed at their empty initial state, so the user landed on a blank
  // results page (v1.4.4 §5.6). The one-shot runner-report-${tabId} key
  // can't help because that's consumed by the pre-load effect on the
  // first mount and never repopulated.
  //
  // Read sessionStorage inside each `useState`'s lazy initializer so it
  // happens exactly once, on first mount. An IIFE at component scope would
  // re-run on every render and do an MB-scale JSON.parse per re-render for
  // big runs.
  const runDataStorageKey = tabId ? `runner-run-data-${tabId}` : null
  const readStoredRunData = (): {
    results: EndpointRunResult[]
    report: RunnerReport | null
    startedAt: number | null
  } | null => {
    if (!runDataStorageKey) return null
    try {
      const stored = sessionStorage.getItem(runDataStorageKey)
      if (!stored) return null
      return JSON.parse(stored) as {
        results: EndpointRunResult[]
        report: RunnerReport | null
        startedAt: number | null
      }
    } catch {
      return null
    }
  }
  const [results, setResults] = useState<EndpointRunResult[]>(
    () => readStoredRunData()?.results ?? [],
  )
  const [report, setReport] = useState<RunnerReport | null>(
    () => readStoredRunData()?.report ?? null,
  )
  const [runStartedAt, setRunStartedAt] = useState<number | null>(
    () => readStoredRunData()?.startedAt ?? null,
  )
  // Persist the currently inspected result so leaving + returning to the
  // tab (or switching between Overview / All Runs and back to a results
  // view) does not drop the user back to an unscoped blank state
  // (v1.4.2 T-5.6, T-12.5).
  const resultsStorageKey = tabId ? `runner-results-${tabId}` : null
  const [selectedResultId, setSelectedResultId] = useState<string | null>(() => {
    if (!resultsStorageKey) return null
    try {
      const stored = sessionStorage.getItem(resultsStorageKey)
      if (!stored) return null
      const parsed = JSON.parse(stored) as { selectedResultId?: string | null }
      return parsed.selectedResultId ?? null
    } catch {
      return null
    }
  })
  // Persist `selectedResultId` so the detail panel survives tab switches
  // (v1.4.2 T-5.6). State that the user does not mind being re-derived
  // (results, report) is rebuilt by the runner-report sessionStorage
  // bridge.
  useEffect(() => {
    if (!resultsStorageKey) return
    if (selectedResultId) {
      sessionStorage.setItem(resultsStorageKey, JSON.stringify({ selectedResultId }))
    } else {
      sessionStorage.removeItem(resultsStorageKey)
    }
  }, [selectedResultId, resultsStorageKey])

  // Mirror the full run snapshot (results / report / startedAt) so a tab
  // switch + return doesn't blank the results detail view. Only persists
  // when there's actually a run to remember — clears the key otherwise.
  //
  // Skip while a run is in flight: progress ticks fire `setResults` after
  // every endpoint, and a 200-endpoint run would serialise + write the
  // entire result blob to sessionStorage 200 times (MB-scale writes on
  // the main thread, plus a real risk of `QuotaExceededError` on big
  // runs). We only need the final snapshot — the next `isRunning=false`
  // transition will trigger this effect once with the complete data,
  // because `results`/`report` change on completion too.
  useEffect(() => {
    if (!runDataStorageKey) return
    if (isRunning) return
    if (results.length > 0 || report) {
      try {
        sessionStorage.setItem(
          runDataStorageKey,
          JSON.stringify({ results, report, startedAt: runStartedAt }),
        )
      } catch (err) {
        // QuotaExceededError on a huge run — drop the snapshot rather
        // than crashing the tab. Users still see the live results in
        // memory; only the tab-switch restore path is degraded.
        console.warn('runner: failed to persist run snapshot:', (err as Error).message)
      }
    } else {
      sessionStorage.removeItem(runDataStorageKey)
    }
  }, [isRunning, results, report, runStartedAt, runDataStorageKey])

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
    setTimeout(async () => {
      // Build selected list directly from pending IDs matched against current endpoints
      const matched = endpoints.filter((ep) => targetIds.has(ep.id))
      if (matched.length === 0) return

      // Quick Run bypasses the config screen, so the configured-run dirty guard
      // (handleRun) never fires here. Flush dirty edits the same way so a
      // freshly-edited request isn't executed against its stale saved snapshot.
      await saveDirtyRunItemsBeforeRun(matched.map((ep) => ep.id))

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
        ?.execute(
          // Quick Run is the THIRD caller of `runner:execute`, and it was still
          // assembling its payload by hand — dropping `stopOnError` and
          // `persistResponses` exactly as the runner tab used to. Going through
          // the shared builder makes every future run setting a compile error
          // here too, which is the only thing that stops this recurring.
          buildExecutePayload(
            {
              projectId: activeProjectId || '',
              endpointIds: matched.map((ep) => ep.id),
              environmentId: environmentId || undefined,
              workspaceId: activeWorkspaceId || undefined,
              iterationData: iterationData.length > 0 ? iterationData : undefined,
              folderName: pending.folderName || runFolderName || undefined,
              sourceLabel,
              runTabId: tabId,
            },
            {
              delay,
              iterationDelay,
              iterations,
              stopOnError,
              persistResponses,
              keepVariableValues,
            },
          ),
        )
        .then(async (result: unknown) => {
          const res = result as { success: boolean; data?: RunnerReport }
          if (res?.success && res.data) {
            setReport(res.data)
            setResults(res.data.results)
            setCurrentIndex(res.data.totalEndpoints)
            setTotalCount(res.data.totalEndpoints)
            await refreshEnvAfterRun(res.data, keepVariableValues)
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
    iterationDelay,
    iterations,
    iterationData,
    runFolderName,
    folderId,
    keepVariableValues,
    stopOnError,
    persistResponses,
    tabId,
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
            : [
                {
                  folderId: node.id,
                  folderName: node.label,
                  label: node.label,
                  parentId: null,
                  endpoints: eps,
                },
              ],
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
        // `parent_id` has always been in the row (suite folders nest); the
        // runner simply never read it, which is why a two-level suite arrived
        // here as one flat level of groups (issue #90).
        folders: Array<{ id: string; name: string; parent_id?: string | null }>
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
        // One group per suite folder — including empty ones, so a nested
        // folder's parent chain stays intact. Items at the suite root get no
        // group at all and render at the top level of the sequence, which is
        // where they live in the Tests sidebar.
        const byId = new Map(folders.map((f) => [f.id, f]))
        const pathOf = (id: string): string => {
          const parts: string[] = []
          const seen = new Set<string>()
          let cur: string | null | undefined = id
          while (cur && !seen.has(cur)) {
            seen.add(cur)
            const f = byId.get(cur)
            if (!f) break
            parts.unshift(f.name)
            cur = f.parent_id ?? null
          }
          return parts.join(' / ')
        }
        const groups: RunnerFolderGroup[] = folders.map((f) => ({
          folderId: f.id,
          folderName: pathOf(f.id),
          label: f.name,
          parentId: f.parent_id ?? null,
          endpoints: [],
        }))
        const groupById = new Map(groups.map((g) => [g.folderId, g]))
        for (const it of items) {
          if (!it.folder_id) continue
          groupById.get(it.folder_id)?.endpoints.push(toRunnerItem(it))
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

  const setEndpointPhase = useCallback((id: string, phase: RunPhase) => {
    const apply = (ep: RunnerEndpointItem): RunnerEndpointItem =>
      ep.id === id ? { ...ep, phase } : ep
    setEndpoints((eps) => eps.map(apply))
    setFolderGroups((groups) => groups.map((g) => ({ ...g, endpoints: g.endpoints.map(apply) })))
  }, [])

  /**
   * Every request id at or below `folderId`, including nested folders.
   *
   * Folder-level roles and the folder checkbox both need it (issue #90): a role
   * on a folder that skipped its subfolders would be a trap — the folder reads
   * "Teardown" while half the requests inside it still run in the flow.
   */
  const collectFolderEndpointIds = useCallback(
    (folderId: string, groups: RunnerFolderGroup[]): Set<string> => {
      const childrenOf = new Map<string, RunnerFolderGroup[]>()
      for (const g of groups) {
        const key = g.parentId ?? '__root__'
        const list = childrenOf.get(key)
        if (list) list.push(g)
        else childrenOf.set(key, [g])
      }
      const ids = new Set<string>()
      // Iterative walk with a visited set: `parentId` comes from a DB column,
      // and a cycle there must not hang the UI.
      const queue = groups.filter((g) => g.folderId === folderId)
      const visited = new Set<string>()
      while (queue.length > 0) {
        const g = queue.shift()!
        if (visited.has(g.folderId)) continue
        visited.add(g.folderId)
        for (const ep of g.endpoints) ids.add(ep.id)
        queue.push(...(childrenOf.get(g.folderId) ?? []))
      }
      return ids
    },
    [],
  )

  /**
   * Apply a patch to every request at or below a folder, in BOTH stores.
   *
   * The flat `endpoints` list is what actually runs (`handleRun` splits from
   * it) and `folderGroups` is what the sequence draws, so a folder-level action
   * that touched only one of them would show a role the run then ignored.
   *
   * The id set is resolved from the `folderGroups` in scope rather than inside
   * a `setState` updater — an updater must stay pure, and React may invoke it
   * more than once.
   */
  const patchFolder = useCallback(
    (folderId: string, patch: Partial<RunnerEndpointItem>) => {
      const ids = collectFolderEndpointIds(folderId, folderGroups)
      if (ids.size === 0) return
      const apply = (ep: RunnerEndpointItem): RunnerEndpointItem =>
        ids.has(ep.id) ? { ...ep, ...patch } : ep
      setEndpoints((eps) => eps.map(apply))
      setFolderGroups((groups) => groups.map((g) => ({ ...g, endpoints: g.endpoints.map(apply) })))
    },
    [collectFolderEndpointIds, folderGroups],
  )

  /** Apply a lifecycle role to a whole folder — subfolders included (issue #90). */
  const setFolderPhase = useCallback(
    (folderId: string, phase: RunPhase) => patchFolder(folderId, { phase }),
    [patchFolder],
  )

  /** Select / deselect a folder and everything beneath it. */
  const toggleFolder = useCallback(
    (folderId: string, selected: boolean) => patchFolder(folderId, { selected }),
    [patchFolder],
  )

  /** Split the selection into the three run phases. Order inside each phase
   *  follows the sequence list; the run order is always setup → flow → teardown. */
  const splitByPhase = useCallback((items: RunnerEndpointItem[]) => {
    const ids = (phase: RunPhase) =>
      items.filter((ep) => (ep.phase ?? 'main') === phase).map((ep) => ep.id)
    return { setupIds: ids('setup'), mainIds: ids('main'), teardownIds: ids('teardown') }
  }, [])

  // "Start run" needs at least one FLOW request — a run made only of fixtures
  // and cleanup has nothing to test, and the main process rejects an empty
  // endpointIds list anyway.
  const selectedCount = useMemo(
    () => endpoints.filter((ep) => ep.selected && (ep.phase ?? 'main') === 'main').length,
    [endpoints],
  )

  const handleRun = useCallback(async () => {
    const selected = endpoints.filter((ep) => ep.selected)
    if (selected.length === 0) return
    const { setupIds, mainIds, teardownIds } = splitByPhase(selected)
    if (mainIds.length === 0) return

    // Persist the active tab if it's a dirty member of this run (so the run uses
    // fresh data, not the stale DB snapshot) + warn about other dirty run items.
    await saveDirtyRunItemsBeforeRun(selected.map((ep) => ep.id))

    setView('results')
    setIsRunning(true)
    setResults([])
    setReport(null)
    setCurrentIndex(0)
    setTotalCount(selected.length)
    setRunStartedAt(Date.now())
    setSelectedResultId(null)
    setTeardownStarted(false)
    setStopRequested(null)

    const unsubscribe = window.api?.runner?.onProgress?.((progress: unknown) => {
      const p = progress as { current: number; total: number; result: EndpointRunResult }
      setCurrentIndex(p.current)
      setTotalCount(p.total)
      setResults((prev) => [...prev, p.result])
    })
    // Cleanup has BEGUN — which a progress tick cannot tell us, because one
    // arrives only when a step finishes. The case that most needs "Skip
    // teardown" is a cleanup endpoint that never answers, and that one produces
    // no result at all.
    const unsubscribePhase = window.api?.runner?.onPhase?.((phase: unknown) => {
      if (phase === 'teardown') setTeardownStarted(true)
    })

    const sourceLabel =
      runOrigin === 'suite' && runFolderName
        ? `Suite: ${runFolderName}`
        : runOrigin === 'apis' && runFolderName
          ? `APIs: ${runFolderName}`
          : 'Runner'
    setRunSourceLabel(sourceLabel)

    try {
      const result = await window.api?.runner?.execute(
        buildExecutePayload(
          {
            projectId: activeProjectId || '',
            endpointIds: mainIds,
            setupEndpointIds: setupIds.length > 0 ? setupIds : undefined,
            teardownEndpointIds: teardownIds.length > 0 ? teardownIds : undefined,
            runPreScript: runPreScript.trim() || undefined,
            runPostScript: runPostScript.trim() || undefined,
            environmentId: environmentId || undefined,
            workspaceId: activeWorkspaceId || undefined,
            iterationData: iterationData.length > 0 ? iterationData : undefined,
            folderName: runFolderName || undefined,
            sourceLabel,
            runTabId: tabId,
          },
          { delay, iterationDelay, iterations, stopOnError, persistResponses, keepVariableValues },
        ),
      )

      if (result?.success && result.data) {
        const rep = result.data as RunnerReport
        setReport(rep)
        setResults(rep.results)
        setCurrentIndex(rep.totalEndpoints)
        setTotalCount(rep.totalEndpoints)
        await refreshEnvAfterRun(rep, keepVariableValues)
      }
    } catch {
      // handled by results
    } finally {
      unsubscribe?.()
      unsubscribePhase?.()
      setIsRunning(false)
    }
  }, [
    endpoints,
    activeProjectId,
    activeWorkspaceId,
    environmentId,
    delay,
    iterationDelay,
    iterations,
    iterationData,
    runFolderName,
    runOrigin,
    keepVariableValues,
    // These two were absent while the payload ignored them; now that the payload
    // carries them, leaving them out would freeze whatever value they had when
    // another dep last changed — a stale checkbox reaching the run.
    stopOnError,
    persistResponses,
    runPreScript,
    runPostScript,
    splitByPhase,
  ])

  /**
   * True once the run has reached cleanup. Derived from the results the
   * progress stream has already delivered rather than kept as its own state,
   * so it can't drift from what the user is looking at, and a new run clears it
   * for free (`setResults([])`).
   *
   * This is what turns Stop into an explicit "Skip teardown": main used to
   * infer that intent from a second click landing after teardown began, which
   * made cleanup finish only partway, seemingly at random.
   */
  const inTeardown = useMemo(
    () => teardownStarted || results.some((r) => r.phase === 'teardown'),
    [teardownStarted, results],
  )

  /**
   * Graceful Stop (issue #91): end the flow, let cleanup finish.
   *
   * Note what this does NOT read: `inTeardown`. An earlier version escalated to
   * a hard stop once cleanup had begun, which put a destructive action behind
   * the safe button partway through the run — the exact inference issue #84
   * removed from the main process, smuggled back into the renderer. Intent
   * comes from WHICH button was pressed and from nothing else, so this one can
   * be pressed any number of times, at any moment, and cleanup still completes.
   */
  const handleStop = useCallback(() => {
    setStopRequested('graceful')
    window.api?.runner?.stop({ mode: 'graceful' })
  }, [])

  /**
   * Direct Stop: nothing after this click runs — the request on the wire is
   * aborted, cleanup is abandoned. Deliberately a SEPARATE button from Stop;
   * the old single control had to guess which of the two the user meant.
   */
  const handleStopDirect = useCallback(() => {
    setStopRequested('direct')
    window.api?.runner?.stop({ mode: 'direct' })
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
      // Carry the phase model into the schedule, exactly as `handleRun` does.
      // Sending the flat list would silently demote setup/teardown requests to
      // flow requests, so a scheduled run graded differently from the
      // interactive one it was created from (#72).
      const { setupIds, mainIds, teardownIds } = splitByPhase(selected)
      if (mainIds.length === 0) return

      try {
        const result = await window.api.scheduler.create({
          projectId: activeProjectId || '',
          // Auto-derive a human name. If the runner tab knows the suite or
          // folder it's working with, surface that — otherwise we used to
          // print only the timestamp which made the Scheduled Tasks table
          // unreadable when you had more than a couple of rows.
          name: `${runFolderName || 'Scheduled Run'} — ${new Date().toLocaleString()}`,
          endpointIds: mainIds,
          setupEndpointIds: setupIds.length > 0 ? setupIds : undefined,
          teardownEndpointIds: teardownIds.length > 0 ? teardownIds : undefined,
          runPreScript: runPreScript.trim() || undefined,
          runPostScript: runPostScript.trim() || undefined,
          // Carry the run settings the user configured, so the schedule grades
          // the way the run they just set up would.
          stopOnError,
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
    [
      endpoints,
      activeProjectId,
      folderId,
      environmentId,
      delay,
      runFolderName,
      suiteIdForRunner,
      runPreScript,
      runPostScript,
    ],
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
                onSetPhase={setEndpointPhase}
                onSetFolderPhase={setFolderPhase}
                onToggleFolder={toggleFolder}
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
                iterationDelay={iterationDelay}
                setIterationDelay={setIterationDelay}
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
                runPreScript={runPreScript}
                setRunPreScript={setRunPreScript}
                runPostScript={runPostScript}
                setRunPostScript={setRunPostScript}
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
            onStopDirect={handleStopDirect}
            inTeardown={inTeardown}
            stopRequested={stopRequested}
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
