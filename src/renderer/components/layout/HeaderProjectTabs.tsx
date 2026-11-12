import { useState } from 'react'
import { X } from 'lucide-react'
import { useWorkspaceStore, projectDirtyTabs } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import { useScrollStrip } from '../../lib/use-scroll-strip'
import {
  projectUnsavedNames,
  requestCloseProjectTab,
  discardAndCloseProjectTab,
  saveAndCloseProjectTab,
} from '../../lib/close-project-tab'
import ProjectIcon from '../shared/ProjectIcon'
import UnsavedChangesDialog from '../modals/UnsavedChangesDialog'

interface PendingClose {
  projectId: string
  projectName: string
  unsavedNames: string[]
}

/**
 * The header's open-project tabs (issue #1).
 *
 * Layout (tester finding 7): with many projects the tabs pushed Save / Push /
 * Pull / Branch / user menu off screen. The strip is now the header's only
 * flexible child — `min-w-0 flex-1` — so the right-hand actions never move.
 * The strip itself stays a window-drag area (only the tabs are `no-drag`), as
 * the spacer it replaces was. Tabs shrink first (label truncates, full name in `title`) down to a minimum
 * width; past that the strip scrolls sideways like the request tab strip
 * (`.scroll-strip` + `useScrollStrip`: no scrollbar, wheel scrolls, the active
 * tab is kept in view — issue #241).
 *
 * Close: a project with unsaved requests is never closed silently — the
 * request tab's own unsaved-changes dialog asks (`lib/close-project-tab.ts`).
 */
export default function HeaderProjectTabs() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const openProjectIds = useWorkspaceStore((s) => s.openProjectIds)
  const projects = useWorkspaceStore((s) => s.projects)
  const setActiveProject = useWorkspaceStore((s) => s.setActiveProject)
  const stripRef = useScrollStrip<HTMLDivElement>(activeProjectId)
  const [pending, setPending] = useState<PendingClose | null>(null)
  const [saving, setSaving] = useState(false)
  // Dirty dot. The active project's tabs are the live strip — subscribe to its
  // dirty count (a number, so no re-render loop). A hidden project's tabs are
  // its `tabsByProject` snapshot, which only changes while that project is
  // active or when its header tab closes / it is deleted — each of those also
  // changes `activeProjectId` / `openProjectIds` / the live strip, which this
  // component already subscribes to, so reading it at render stays current.
  const liveDirtyCount = useTabsStore((s) => s.tabs.filter((tab) => tab.isDirty).length)

  const openProjects = openProjectIds
    .map((id) => projects.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)

  function handleClose(projectId: string, projectName: string) {
    if (requestCloseProjectTab(projectId) === 'closed') return
    const unsavedNames = projectUnsavedNames(projectId)
    setPending({ projectId, projectName, unsavedNames })
  }

  async function handleSave() {
    if (!pending) return
    setSaving(true)
    const outcome = await saveAndCloseProjectTab(pending.projectId)
    setSaving(false)
    // A failure was reported; keep the dialog so the user can retry or cancel.
    // Save As (a never-saved draft) opens on that tab with the project in view.
    if (outcome !== 'failed') setPending(null)
  }

  function handleDiscard() {
    if (pending) discardAndCloseProjectTab(pending.projectId)
    setPending(null)
  }

  return (
    <>
      <div
        ref={stripRef}
        data-testid="header-project-tabs"
        role="group"
        aria-label={t('header.projectTabs')}
        className="scroll-strip flex h-full min-w-0 flex-1 items-stretch"
      >
        {openProjects.map((proj) => {
          const isActive = proj.id === activeProjectId
          const name = proj.display_name || proj.name
          const isDirty = isActive ? liveDirtyCount > 0 : projectDirtyTabs(proj.id).length > 0
          return (
            <div
              key={proj.id}
              data-testid="header-project-tab"
              data-active={isActive ? 'true' : 'false'}
              data-dirty={isDirty ? 'true' : 'false'}
              data-project-id={proj.id}
              title={name}
              onClick={() => setActiveProject(proj.id)}
              className={`no-drag group flex h-full min-w-[96px] max-w-[200px] shrink cursor-pointer items-center gap-1.5 border-r border-b-2 border-r-[var(--border)] pl-3 pr-1.5 text-sm font-medium ${
                isActive
                  ? 'border-b-[var(--accent)] text-[var(--text)]'
                  : 'border-b-transparent text-[var(--muted)] hover:bg-[var(--surface)]'
              }`}
            >
              <ProjectIcon
                name={name}
                emoji={proj.icon_emoji || undefined}
                color={proj.icon_color || 'var(--accent)'}
                size={18}
              />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {/* The request tab strip's slot (Workbench): the × and the
                dirty dot share one fixed box, so the tab never changes width
                and the label keeps its truncation. The dot holds the slot
                until hover / keyboard focus shows the ×. */}
              <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {isDirty && (
                  <span
                    data-testid="project-tab-dirty"
                    role="img"
                    aria-label={t('unsaved.title')}
                    className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-[var(--accent)] group-hover:opacity-0 group-has-[:focus-visible]:opacity-0"
                  />
                )}
                <button
                  type="button"
                  data-testid={`header-project-tab-close-${proj.id}`}
                  aria-label={`${t('header.closeProjectTab')}: ${name}`}
                  title={t('header.closeProjectTab')}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClose(proj.id, name)
                  }}
                  className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--hint)] opacity-0 hover:bg-[var(--border)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </div>
          )
        })}
      </div>

      <UnsavedChangesDialog
        open={pending !== null}
        itemName={pending?.projectName ?? ''}
        unsavedNames={pending?.unsavedNames ?? []}
        saving={saving}
        onSave={handleSave}
        onDiscard={handleDiscard}
        onCancel={() => {
          if (!saving) setPending(null)
        }}
      />
    </>
  )
}
