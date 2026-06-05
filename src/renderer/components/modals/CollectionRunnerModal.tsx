import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useRunnerStore } from '../../stores/runner.store'
import type { HttpMethod, TreeNode } from '../../types'
import Modal from '../shared/Modal'
import RunnerConfigView from './RunnerConfigView'
import RunnerResultsView from './RunnerResultsView'

function collectEndpoints(
  nodes: TreeNode[],
): { id: string; name: string; method: HttpMethod; path: string }[] {
  const result: { id: string; name: string; method: HttpMethod; path: string }[] = []
  for (const node of nodes) {
    // Imported endpoints (`endpoint`) and manually saved requests (`request`)
    // both resolve via runner `getRunnableEntity` — omitting `request` left
    // the collection runner with zero selectable rows after Ctrl+S saves.
    if ((node.type === 'endpoint' || node.type === 'request') && node.method && node.path) {
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
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setEndpoints = useRunnerStore((s) => s.setEndpoints)
  const reset = useRunnerStore((s) => s.reset)
  const isRunning = useRunnerStore((s) => s.isRunning)
  const view = useRunnerStore((s) => s.view)

  useEffect(() => {
    if (show) {
      const collected = collectEndpoints(treeData)
      setEndpoints(
        collected.map((ep) => ({
          id: ep.id,
          name: ep.name,
          method: ep.method,
          url: ep.path,
          selected: true,
        })),
      )
      reset()
    }
  }, [show, treeData, setEndpoints, reset])

  if (!show) return null

  return (
    <Modal
      open={show}
      onOpenChange={(o) => {
        if (!o && !isRunning) setShow(false)
      }}
      title="Collection Runner"
      testId="collection-runner-modal"
      preventClose={isRunning}
    >
      <div
        className="flex h-[90vh] w-[1100px] max-w-[95vw] flex-col overflow-hidden rounded-[14px] bg-[var(--white)]"
        style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        {/* Tab bar */}
        <div className="flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-2 border-r border-[var(--border)] px-4 py-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
              <path d="M3 9h6" />
              <path d="M3 15h6" />
            </svg>
            <span className="font-semibold text-[var(--text)]">Runner</span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              if (!isRunning) setShow(false)
            }}
            className="cursor-pointer border-none bg-transparent p-2 text-[var(--hint)] hover:text-[var(--text)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        {view === 'config' ? (
          <RunnerConfigView
            projectId={activeProjectId || ''}
            workspaceId={activeWorkspaceId || undefined}
          />
        ) : (
          <RunnerResultsView onNewRun={() => reset()} onClose={() => setShow(false)} />
        )}
      </div>
    </Modal>
  )
}
