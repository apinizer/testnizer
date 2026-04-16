import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import type { TreeNode, HttpMethod } from '../../types'
import RunnerSequence from './RunnerSequence'
import RunnerConfig from './RunnerConfig'
import RunnerResults from './RunnerResults'
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
function collectFolderGroupsFromNode(node: TreeNode, groups: RunnerFolderGroup[], parentPath?: string): void {
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
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, [onDrag])

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

  const [endpoints, setEndpoints] = useState<RunnerEndpointItem[]>([])
  const [folderGroups, setFolderGroups] = useState<RunnerFolderGroup[]>([])
  const [view, setView] = useState<'home' | 'config' | 'results' | 'history' | 'scheduled'>('config')
  const [delay, setDelay] = useState(0)
  const [iterations, setIterations] = useState(1)
  const [environmentId, setEnvironmentId] = useState('')
  const [stopOnError, setStopOnError] = useState(true)
  const [persistResponses, setPersistResponses] = useState(true)
  const [keepVariableValues, setKeepVariableValues] = useState(true)
  const [runFolderName, setRunFolderName] = useState('')

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
  const [runOrigin, setRunOrigin] = useState<'apis' | 'suite' | 'runner'>(folderId ? 'apis' : 'runner')
  const [runSourceLabel, setRunSourceLabel] = useState<string>('Runner')

  // Track pending autoRun data so we can trigger after endpoints are loaded
  const pendingAutoRunRef = useRef<{ endpointIds: string[]; folderName?: string; sourceType?: 'suite' | 'apis' | 'runner' } | null>(null)

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
        } else if (data.autoRun && data.endpointIds) {
          // Store for when endpoints are loaded
          pendingAutoRunRef.current = {
            endpointIds: data.endpointIds,
            folderName: data.folderName,
            sourceType: data.sourceType,
          }
          if (data.folderName) setRunFolderName(data.folderName)
          if (data.sourceType === 'suite') setRunOrigin('suite')
          else if (data.sourceType === 'apis') setRunOrigin('apis')
        } else {
          const typed = data as { results: EndpointRunResult[]; report: RunnerReport; startedAt: number }
          setResults(typed.results)
          setReport(typed.report)
          setRunStartedAt(typed.startedAt)
          setView('results')
        }
      } catch { /* ignore */ }
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
    setFolderGroups((groups) => groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map((ep) => ({ ...ep, selected: targetIds.has(ep.id) })),
    })))

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
      const sourceLabel = origin === 'suite' && labelName
        ? `Suite: ${labelName}`
        : origin === 'apis' && labelName
        ? `APIs: ${labelName}`
        : 'Runner'
      setRunSourceLabel(sourceLabel)
      setRunOrigin(origin)

      window.api?.runner?.execute({
        projectId: activeProjectId || '',
        endpointIds: matched.map((ep) => ep.id),
        environmentId: environmentId || undefined,
        workspaceId: activeWorkspaceId || undefined,
        delay,
        folderName: pending.folderName || runFolderName || undefined,
        sourceLabel,
      }).then((result: unknown) => {
        const res = result as { success: boolean; data?: RunnerReport }
        if (res?.success && res.data) {
          setReport(res.data)
          setResults(res.data.results)
          setCurrentIndex(res.data.totalEndpoints)
          setTotalCount(res.data.totalEndpoints)
        }
      }).finally(() => {
        unsubscribe?.()
        setIsRunning(false)
      })
    }, 100)
  }, [endpoints, activeProjectId, activeWorkspaceId, environmentId, delay, runFolderName, folderId])

  // Collect endpoints and folder groups from the target folder/module
  useEffect(() => {
    if (!folderId) {
      const all: RunnerEndpointItem[] = []
      for (const root of treeData) {
        all.push(...collectEndpointsFromNode(root))
      }
      setEndpoints(all)
      setFolderGroups(collectFolderGroups(treeData))
      setRunFolderName(treeData[0]?.label || 'All')
      return
    }

    const node = findNodeById(treeData, folderId)
    if (node) {
      const eps = collectEndpointsFromNode(node)
      setEndpoints(eps)
      setRunFolderName(node.label)
      if (node.type === 'folder' || node.type === 'module') {
        const groups: RunnerFolderGroup[] = []
        collectFolderGroupsFromNode(node, groups)
        setFolderGroups(groups.length > 0 ? groups : [{ folderId: node.id, folderName: node.label, endpoints: eps }])
      }
    }
  }, [folderId, treeData])

  const toggleEndpoint = useCallback((id: string) => {
    setEndpoints((eps) => eps.map((ep) => ep.id === id ? { ...ep, selected: !ep.selected } : ep))
    setFolderGroups((groups) => groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map((ep) => ep.id === id ? { ...ep, selected: !ep.selected } : ep),
    })))
  }, [])

  const selectAll = useCallback(() => {
    setEndpoints((eps) => eps.map((ep) => ({ ...ep, selected: true })))
    setFolderGroups((groups) => groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map((ep) => ({ ...ep, selected: true })),
    })))
  }, [])

  const deselectAll = useCallback(() => {
    setEndpoints((eps) => eps.map((ep) => ({ ...ep, selected: false })))
    setFolderGroups((groups) => groups.map((g) => ({
      ...g,
      endpoints: g.endpoints.map((ep) => ({ ...ep, selected: false })),
    })))
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

    const sourceLabel = runOrigin === 'suite' && runFolderName
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
  }, [endpoints, activeProjectId, activeWorkspaceId, environmentId, delay, runFolderName, runOrigin])

  const handleStop = useCallback(() => {
    window.api?.runner?.stop()
  }, [])

  const handleNewRun = useCallback(() => {
    setView('config')
    setResults([])
    setReport(null)
    setSelectedResultId(null)
  }, [])

  const handleViewAllRuns = useCallback(() => {
    setView('history')
  }, [])

  const handleViewReport = useCallback((histResults: EndpointRunResult[], histReport: RunnerReport, startedAt: number, sourceLabel?: string) => {
    setResults(histResults)
    setReport(histReport)
    setRunStartedAt(startedAt)
    setSelectedResultId(null)
    setRunSourceLabel(sourceLabel || 'Runner')
    setView('results')
  }, [])

  const handleSchedule = useCallback(async (intervalValue: number, intervalUnit: 'minutes' | 'hours' | 'days') => {
    const selected = endpoints.filter((ep) => ep.selected)
    if (selected.length === 0) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = window.api as any
      const result = await api.scheduler.create({
        projectId: activeProjectId || '',
        name: `Scheduled Run ${new Date().toLocaleString()}`,
        endpointIds: selected.map((ep) => ep.id),
        folderId: folderId || undefined,
        environmentId: environmentId || undefined,
        intervalValue,
        intervalUnit,
        delayMs: delay,
      })
      if (result?.success) {
        setView('scheduled')
      }
    } catch (e) {
      console.error('Failed to create scheduled task:', e)
    }
  }, [endpoints, activeProjectId, folderId, environmentId, delay])

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
          <ScheduledTasksView
            onBack={() => setView('home')}
            onNewRun={handleNewRun}
          />
        ) : view === 'history' ? (
          <RunnerHistory
            onBack={() => setView(results.length > 0 ? 'results' : 'home')}
            onNewRun={handleNewRun}
            onViewReport={handleViewReport}
          />
        ) : view === 'config' ? (
          <>
            {/* Run Sequence (left) — resizable */}
            <div style={{ width: sequenceWidth, flexShrink: 0, overflow: 'hidden', display: 'flex' }}>
              <RunnerSequence
                endpoints={endpoints}
                folderGroups={folderGroups}
                onToggle={toggleEndpoint}
                onSelectAll={selectAll}
                onDeselectAll={deselectAll}
                onReset={selectAll}
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
                onRun={handleRun}
                onSchedule={handleSchedule}
                isRunning={isRunning}
                selectedCount={selectedCount}
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
          />
        )}
      </div>

      {/* Resize divider for variables panel */}
      <ResizeDivider onDrag={handleVariablesResize} />

      {/* Right: All Variables — resizable */}
      <div style={{ width: variablesWidth, flexShrink: 0, overflow: 'hidden', display: 'flex' }}>
        <RunnerVariables environmentId={environmentId} fillParent />
      </div>
    </div>
  )
}
