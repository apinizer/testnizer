import { Search, GitBranch, Filter } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import TreeView from '../sidebar/TreeView'
import NewDropdown from '../sidebar/NewDropdown'

export default function LeftPanel() {
  const searchQuery = useWorkspaceStore((s) => s.searchQuery)
  const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery)
  const { t } = useTranslation()

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden"
      style={{
        width: 256,
        minWidth: 256,
        background: 'var(--white)',
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Panel header — 36px */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        style={{
          height: 36,
          padding: '0 10px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span className="flex-1 text-[0.825rem] font-semibold" style={{ color: 'var(--text)' }}>
          {t('leftPanel.apis')}
        </span>

        {/* Branch pill */}
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 text-[0.825rem]"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border2)',
            borderRadius: 12,
            padding: '2px 6px',
            color: 'var(--muted)',
          }}
        >
          <GitBranch size={9} />
          main
        </button>
      </div>

      {/* Search + New dropdown */}
      <div
        className="flex gap-1"
        style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          className="flex flex-1 items-center gap-1"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '3px 6px',
          }}
        >
          <Search size={11} className="shrink-0" style={{ color: 'var(--hint)' }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('leftPanel.search')}
            className="w-full border-none bg-transparent text-[0.875rem] outline-none"
            style={{
              color: 'var(--text)',
              lineHeight: '18px',
            }}
          />
        </div>

        <button
          type="button"
          className="cursor-pointer"
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 4,
            color: 'var(--muted)',
          }}
        >
          <Filter size={11} />
        </button>

        {/* New dropdown (+ button) */}
        <NewDropdown />
      </div>

      {/* Tree */}
      <TreeView />
    </div>
  )
}
