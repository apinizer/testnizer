import { useEffect } from 'react'
import { X, Play, Square, Download } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useRunnerStore } from '../../stores/runner.store'
import type { HttpMethod, TreeNode } from '../../types'
import RunnerConfigPanel from './RunnerConfigPanel'
import RunnerResultsPanel from './RunnerResultsPanel'

function collectEndpoints(nodes: TreeNode[]): { id: string; name: string; method: HttpMethod; path: string }[] {
  const result: { id: string; name: string; method: HttpMethod; path: string }[] = []
  for (const node of nodes) {
    if (node.type === 'endpoint' && node.method && node.path) {
      result.push({
        id: node.id,
        name: node.label,
        method: node.method as HttpMethod,
        path: node.path,
      })
    }
    if (node.children) {
      result.push(...collectEndpoints(node.children))
    }
  }
  return result
}

export default function CollectionRunnerModal() {
  const show = useUIStore((s) => s.showCollectionRunner)
  const setShow = useUIStore((s) => s.setShowCollectionRunner)
  const treeData = useWorkspaceStore((s) => s.treeData)
  const projects = useWorkspaceStore((s) => s.projects)
  const environments = useEnvironmentStore((s) => s.environments)
  const setEndpoints = useRunnerStore((s) => s.setEndpoints)
  const reset = useRunnerStore((s) => s.reset)
  const isRunning = useRunnerStore((s) => s.isRunning)
  const run = useRunnerStore((s) => s.run)
  const stop = useRunnerStore((s) => s.stop)
  const exportJson = useRunnerStore((s) => s.exportJson)
  const exportHtml = useRunnerStore((s) => s.exportHtml)
  const results = useRunnerStore((s) => s.results)

  useEffect(() => {
    if (show) {
      const collected = collectEndpoints(treeData)
      setEndpoints(
        collected.map((ep) => ({
          id: ep.id,
          name: ep.name,
          method: ep.method,
          url: `https://api.example.com${ep.path}`,
          selected: true,
        }))
      )
      reset()
    }
  }, [show, treeData, setEndpoints, reset])

  if (!show) return null

  function handleExportJson() {
    const json = exportJson()
    downloadFile(json, 'collection-runner-report.json', 'application/json')
  }

  function handleExportHtml() {
    const html = exportHtml()
    downloadFile(html, 'collection-runner-report.html', 'text/html')
  }

  function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.28)' }}
      onClick={() => { if (!isRunning) setShow(false) }}
    >
      <div
        className="flex h-[85vh] w-[1000px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] bg-[var(--white)]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-5 py-3">
          <div className="text-[0.875rem] font-bold text-[var(--text)]">Collection Runner</div>
          <div className="flex items-center gap-2">
            {results.length > 0 && !isRunning && (
              <>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[0.875rem] text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
                >
                  <Download size={12} />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={handleExportHtml}
                  className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[0.875rem] text-[var(--muted)] transition-colors hover:bg-[var(--surface)]"
                >
                  <Download size={12} />
                  Export HTML
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => { if (!isRunning) setShow(false) }}
              className="cursor-pointer p-1 text-[var(--hint)] hover:text-[var(--text)]"
              style={{ background: 'transparent', border: 'none' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Config panel */}
          <RunnerConfigPanel projects={projects} environments={environments} />

          {/* Results panel */}
          <RunnerResultsPanel />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="flex items-center gap-3">
            {isRunning ? (
              <button
                type="button"
                onClick={stop}
                className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-[#cc2200] px-4 py-[7px] text-[0.875rem] font-semibold text-white transition-colors hover:opacity-90"
              >
                <Square size={13} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={run}
                className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-[var(--accent)] px-4 py-[7px] text-[0.875rem] font-semibold text-white transition-colors hover:opacity-90"
              >
                <Play size={13} />
                Run Collection
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => { if (!isRunning) setShow(false) }}
            className="cursor-pointer rounded-[7px] border-[1.5px] border-[var(--border2)] bg-[var(--white)] px-3 py-1.5 text-[0.875rem] text-[#555] transition-colors hover:bg-[var(--bg)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
