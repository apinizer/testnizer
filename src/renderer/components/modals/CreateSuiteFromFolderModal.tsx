import { useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import Modal from '../shared/Modal'
import MethodBadge from '../shared/MethodBadge'
import { t } from '../../lib/i18n'
import { collectRequestIds, isRequestNode } from '../../lib/folder-request-selection'
import type { TreeNode } from '../../types'

interface CreateSuiteFromFolderModalProps {
  open: boolean
  /** The folder (or project root module) being turned into a suite. */
  folder: TreeNode
  /** Called with the selected request ids, in tree order. Never empty. */
  onConfirm: (selectedIds: string[]) => void
  onCancel: () => void
}

/** One subtree row — a request with a checkbox, or a folder that toggles its subtree. */
function SelectionRow({
  node,
  depth,
  selected,
  onToggleRequest,
  onToggleFolder,
}: {
  node: TreeNode
  depth: number
  selected: Set<string>
  onToggleRequest: (id: string) => void
  onToggleFolder: (node: TreeNode) => void
}) {
  const rowStyle = { paddingLeft: 8 + depth * 16, fontSize: 13, color: 'var(--text)' }
  if (isRequestNode(node)) {
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded py-1 pr-2" style={rowStyle}>
        <input
          type="checkbox"
          data-testid={`suite-select-request-${node.id}`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          checked={selected.has(node.id)}
          onChange={() => onToggleRequest(node.id)}
        />
        {node.method && <MethodBadge method={node.method} small />}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </label>
    )
  }
  const subtreeIds = collectRequestIds(node)
  const allSelected = subtreeIds.length > 0 && subtreeIds.every((id) => selected.has(id))
  const someSelected = subtreeIds.some((id) => selected.has(id))
  return (
    <>
      <label className="flex cursor-pointer items-center gap-2 rounded py-1 pr-2" style={rowStyle}>
        <input
          type="checkbox"
          data-testid={`suite-select-folder-${node.id}`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
          checked={allSelected}
          // `indeterminate` is a DOM property, not an attribute.
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected
          }}
          onChange={() => onToggleFolder(node)}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{node.label}</span>
      </label>
      {(node.children ?? []).map((child) => (
        <SelectionRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggleRequest={onToggleRequest}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </>
  )
}

/**
 * Selection step between "Create Test Suite from this folder" and the actual
 * create (issue #102). Everything starts selected so confirming straight away
 * reproduces the old one-click full-folder behaviour; unchecking narrows the
 * suite to a subset without post-create pruning.
 */
export default function CreateSuiteFromFolderModal({
  open,
  folder,
  onConfirm,
  onCancel,
}: CreateSuiteFromFolderModalProps) {
  const allIds = useMemo(() => collectRequestIds(folder), [folder])
  // Mounted fresh per open (TreeView renders it conditionally), so the
  // initializer is the reset — no effect needed.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(collectRequestIds(folder)))

  const toggleRequest = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleFolder = (node: TreeNode): void =>
    setSelected((prev) => {
      const ids = collectRequestIds(node)
      const next = new Set(prev)
      const all = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next
    })

  const allChecked = selected.size === allIds.length
  const toggleAll = (): void => setSelected(allChecked ? new Set() : new Set(allIds))
  const count = t('suiteFromFolder.selectedCount')
    .replace('{selected}', String(selected.size))
    .replace('{total}', String(allIds.length))

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={t('suiteFromFolder.title')}
      testId="suite-select-modal"
    >
      <div
        className="w-[460px] rounded-lg border shadow-xl"
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 border-b px-5 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-light)', border: '1px solid var(--accent)' }}
          >
            <ListChecks size={16} style={{ color: 'var(--accent-text)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold" style={{ fontSize: 13, color: 'var(--text)' }}>
              {t('suiteFromFolder.title')}: {folder.label}
            </h3>
            <p className="mt-0.5" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {t('suiteFromFolder.subtitle')}
            </p>
          </div>
        </div>

        {/* Toolbar: select all/none + counter */}
        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <button
            type="button"
            data-testid="suite-select-toggle-all"
            onClick={toggleAll}
            className="cursor-pointer rounded px-1 py-0.5 font-medium hover:opacity-80"
            style={{ fontSize: 12.5, color: 'var(--accent-text)' }}
          >
            {allChecked ? t('suiteFromFolder.deselectAll') : t('suiteFromFolder.selectAll')}
          </button>
          <span data-testid="suite-select-count" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {count}
          </span>
        </div>

        {/* Subtree with checkboxes */}
        <div
          className="mx-5 mb-4 mt-1 max-h-[320px] overflow-y-auto rounded-md border py-1"
          style={{ borderColor: 'var(--border)' }}
        >
          {(folder.children ?? []).map((child) => (
            <SelectionRow
              key={child.id}
              node={child}
              depth={0}
              selected={selected}
              onToggleRequest={toggleRequest}
              onToggleFolder={toggleFolder}
            />
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <button
            type="button"
            onClick={onCancel}
            data-testid="suite-select-cancel"
            className="cursor-pointer rounded-md border px-3.5 py-1.5 font-medium transition-colors hover:opacity-80"
            style={{
              fontSize: 13,
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: 'var(--text)',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="suite-select-confirm"
            disabled={selected.size === 0}
            onClick={() => onConfirm(allIds.filter((id) => selected.has(id)))}
            className="rounded-md px-3.5 py-1.5 font-medium text-white transition-colors"
            style={{
              fontSize: 13,
              background: 'var(--accent)',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              opacity: selected.size === 0 ? 0.5 : 1,
            }}
          >
            {t('suiteFromFolder.create')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
