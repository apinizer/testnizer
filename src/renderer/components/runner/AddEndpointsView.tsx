import { useState, useEffect, useCallback } from 'react'
import { Search, ChevronRight, ChevronDown, FolderOpen, X } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import MethodBadge from '../shared/MethodBadge'

interface EndpointWithFolder {
  id: string
  name: string
  method: string | null
  path: string
  folder_id: string | null
}

interface FolderInfo {
  id: string
  name: string
  parent_id: string | null
}

interface FolderGroup {
  folder: FolderInfo | null
  endpoints: EndpointWithFolder[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => (window as any).api

export default function AddEndpointsView() {
  const { t } = useTranslation()
  const suiteId = useUIStore((s) => s.addEndpointsSuiteId)
  const suiteName = useUIStore((s) => s.addEndpointsSuiteName)
  const close = useCallback(() => useUIStore.getState().setAddEndpointsSuite(null), [])

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  // Subscribe to the tree so this view re-fetches when the user adds a
  // folder/endpoint elsewhere (Bug 3 — new APIs-side folders not surfacing).
  const treeData = useWorkspaceStore((s) => s.treeData)

  const [allEndpoints, setAllEndpoints] = useState<EndpointWithFolder[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  // Load data — re-runs whenever the project tree changes so newly created
  // folders/endpoints in the APIs workbench become available without
  // closing and reopening this view.
  useEffect(() => {
    if (!activeProjectId || !suiteId) return

    // Load imported endpoints AND manually saved requests in parallel, then
    // merge — the picker has to surface both so suites can include manually
    // created requests too (Bug 7).
    Promise.all([
      api().endpoint.listByProject(activeProjectId) as Promise<{
        success: boolean
        data?: EndpointWithFolder[]
      }>,
      api().savedRequest.list(activeProjectId) as Promise<{
        success: boolean
        data?: Array<{
          id: string
          name: string
          method: string | null
          url: string
          folder_id: string | null
        }>
      }>,
    ]).then(([epResult, savedResult]) => {
      const fromEndpoints = epResult?.success && epResult.data ? epResult.data : []
      const fromSaved =
        savedResult?.success && savedResult.data
          ? savedResult.data.map((r) => ({
              id: r.id,
              name: r.name,
              method: r.method,
              path: r.url,
              folder_id: r.folder_id,
            }))
          : []
      setAllEndpoints([...fromEndpoints, ...fromSaved])
    })

    // Load folders
    api()
      .folder.list(activeProjectId)
      .then((r: { success: boolean; data?: FolderInfo[] }) => {
        if (r?.success && r.data) {
          setFolders(r.data)
          // Expand all by default (only on first load; keep user's later choices)
          setExpandedFolders((prev) => {
            if (Object.keys(prev).length > 0) return prev
            const exp: Record<string, boolean> = {}
            for (const f of r.data!) exp[f.id] = true
            exp['_root'] = true
            return exp
          })
        }
      })

    // Load existing endpoints in suite
    api()
      .testSuite.listEndpoints(suiteId)
      .then((r: { success: boolean; data?: Array<{ id: string }> }) => {
        if (r?.success && r.data) setExistingIds(new Set(r.data.map((e: { id: string }) => e.id)))
      })
  }, [activeProjectId, suiteId, treeData])

  // Filter endpoints not already in suite
  const availableEndpoints = allEndpoints.filter((e) => !existingIds.has(e.id))

  // Build folder lookup early so search can resolve folder names
  const folderMap = new Map<string, FolderInfo>()
  for (const f of folders) folderMap.set(f.id, f)

  // Walk up the folder chain and collect all ancestor names (so a search match
  // on a parent folder also surfaces endpoints that live in its descendants).
  const folderPathTokens = (folderId: string | null): string => {
    if (!folderId) return ''
    const tokens: string[] = []
    let cur: string | null = folderId
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const f = folderMap.get(cur)
      if (!f) break
      tokens.push(f.name)
      cur = f.parent_id
    }
    return tokens.join(' / ').toLowerCase()
  }

  // Search filter — matches endpoint name, endpoint path, or any folder
  // name in the endpoint's folder ancestry.
  const searchLc = search.trim().toLowerCase()
  const filtered = searchLc
    ? availableEndpoints.filter(
        (e) =>
          e.name.toLowerCase().includes(searchLc) ||
          e.path.toLowerCase().includes(searchLc) ||
          folderPathTokens(e.folder_id).includes(searchLc),
      )
    : availableEndpoints

  // Build folder display name with parent path
  const getFolderDisplayName = (folderId: string): string => {
    const folder = folderMap.get(folderId)
    if (!folder) return folderId
    if (folder.parent_id) {
      const parent = folderMap.get(folder.parent_id)
      if (parent) return `${parent.name} / ${folder.name}`
    }
    return folder.name
  }

  const groups: FolderGroup[] = []
  // Group endpoints that have a folder
  const folderIds = [...new Set(filtered.filter((e) => e.folder_id).map((e) => e.folder_id!))]
  for (const fid of folderIds) {
    const folder = folderMap.get(fid)
    const eps = filtered.filter((e) => e.folder_id === fid)
    if (eps.length > 0) {
      groups.push({
        folder: folder
          ? { ...folder, name: getFolderDisplayName(fid) }
          : { id: fid, name: fid, parent_id: null },
        endpoints: eps,
      })
    }
  }
  // Endpoints without folder — show flat, no group header
  const rootEndpoints = filtered.filter((e) => !e.folder_id)

  const toggleEndpoint = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleFolder = (folderId: string | null) => {
    const eps = folderId
      ? filtered.filter((e) => e.folder_id === folderId)
      : filtered.filter((e) => !e.folder_id)
    const allSelected = eps.every((e) => selected.has(e.id))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const ep of eps) {
        if (allSelected) next.delete(ep.id)
        else next.add(ep.id)
      }
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((e) => e.id)))
  }

  const handleAdd = async () => {
    if (selected.size === 0 || !suiteId) return
    setLoading(true)
    await api().testSuite.addEndpoints({ suite_id: suiteId, endpoint_ids: Array.from(selected) })
    setLoading(false)
    close()
  }

  if (!suiteId) return null

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between border-b px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            {t('addEndpoints.addTo')} "{suiteName}"
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {t('addEndpoints.subtitle')}
          </div>
        </div>
        <button
          type="button"
          onClick={close}
          className="flex cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-1"
          style={{ color: 'var(--muted)' }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Search + select all */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-5 py-2.5"
        style={{ borderColor: 'var(--border)' }}
      >
        <div
          className="flex flex-1 items-center gap-2 rounded-lg px-3 py-1.5"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Search size={14} style={{ color: 'var(--hint)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('addEndpoints.searchPlaceholder')}
            autoFocus
            className="flex-1 border-none bg-transparent outline-none"
            style={{ fontSize: 14, color: 'var(--text)' }}
          />
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={filtered.length > 0 && selected.size === filtered.length}
            onChange={selectAll}
            className="cursor-pointer"
          />
          <span style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            {selected.size > 0
              ? `${selected.size} ${t('addEndpoints.selected')}`
              : t('addEndpoints.selectAll')}
          </span>
        </label>
      </div>

      {/* Endpoint list grouped by folder */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {groups.length === 0 && rootEndpoints.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16"
            style={{ color: 'var(--hint)' }}
          >
            <div style={{ fontSize: 14 }}>
              {allEndpoints.length === 0
                ? t('addEndpoints.noEndpoints')
                : availableEndpoints.length === 0
                  ? t('addEndpoints.allAlreadyIn')
                  : t('addEndpoints.noMatches')}
            </div>
          </div>
        ) : (
          <>
            {/* Folder groups */}
            {groups.map((group) => {
              const key = group.folder?.id || '_root'
              const expanded = expandedFolders[key] !== false
              const folderEps = group.endpoints
              const allChecked = folderEps.every((e) => selected.has(e.id))
              const someChecked = folderEps.some((e) => selected.has(e.id))

              return (
                <div key={key} className="mb-1">
                  {/* Folder header */}
                  <div
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface)]"
                    onClick={() => setExpandedFolders((s) => ({ ...s, [key]: !expanded }))}
                  >
                    <span style={{ color: 'var(--hint)' }}>
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someChecked && !allChecked
                      }}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleFolder(group.folder?.id || null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="cursor-pointer"
                    />
                    <FolderOpen size={14} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {group.folder?.name || t('addEndpoints.ungrouped')}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--hint)' }}>({folderEps.length})</span>
                  </div>

                  {/* Endpoints */}
                  {expanded && (
                    <div className="ml-4">
                      {folderEps.map((ep) => (
                        <label
                          key={ep.id}
                          className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(ep.id)}
                            onChange={() => toggleEndpoint(ep.id)}
                            className="cursor-pointer"
                          />
                          {ep.method && <MethodBadge method={ep.method} small />}
                          <span
                            className="flex-1 truncate"
                            style={{ fontSize: 13, color: 'var(--text)' }}
                          >
                            {ep.name}
                          </span>
                          <span
                            className="truncate"
                            style={{ fontSize: 13, color: 'var(--hint)', maxWidth: 240 }}
                          >
                            {ep.path}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Root endpoints (no folder) — show flat */}
            {rootEndpoints.map((ep) => (
              <label
                key={ep.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--surface)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(ep.id)}
                  onChange={() => toggleEndpoint(ep.id)}
                  className="cursor-pointer"
                />
                {ep.method && <MethodBadge method={ep.method} small />}
                <span className="flex-1 truncate" style={{ fontSize: 13, color: 'var(--text)' }}>
                  {ep.name}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: 13, color: 'var(--hint)', maxWidth: 240 }}
                >
                  {ep.path}
                </span>
              </label>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex shrink-0 items-center justify-between border-t px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          {filtered.length}{' '}
          {filtered.length !== 1 ? t('addEndpoints.endpoints') : t('addEndpoints.endpoint')}{' '}
          {t('addEndpoints.available')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={close}
            className="cursor-pointer rounded-lg border px-4 py-1.5"
            style={{
              background: 'var(--white)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          >
            {t('addEndpoints.cancel')}
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selected.size === 0 || loading}
            className="cursor-pointer rounded-lg border-none px-5 py-1.5 font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)', fontSize: 13 }}
          >
            {t('addEndpoints.add')}{' '}
            {selected.size > 0
              ? `${selected.size} ${selected.size > 1 ? t('addEndpoints.endpoints') : t('addEndpoints.endpoint')}`
              : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
