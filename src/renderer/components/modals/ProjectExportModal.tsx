// Export-format picker for a whole project (issue #208): Testnizer JSON ·
// Postman v2.1 · OpenAPI 3 · Insomnia. Opened from File → Export, Settings →
// Storage / Data and the Home project card via `useProjectExportStore`; the
// APIs tree root offers the same list as a context submenu. Both call the one
// shared action, `exportProjectAs`.

import { useState } from 'react'
import { Upload } from 'lucide-react'
import Modal from '../shared/Modal'
import { useTranslation } from '../../lib/i18n'
import { Z } from '../../lib/z-index'
import {
  PROJECT_EXPORT_FORMATS,
  exportProjectAs,
  type ProjectExportFormat,
} from '../../lib/project-export'
import { useProjectExportStore, type ProjectExportTarget } from '../../stores/project-export.store'

export default function ProjectExportModal() {
  const target = useProjectExportStore((s) => s.target)
  // Closing clears `target`, so every opening mounts a fresh picker that
  // starts on Testnizer JSON (the lossless choice).
  return target ? <ProjectExportPicker target={target} /> : null
}

function ProjectExportPicker({ target }: { target: ProjectExportTarget }) {
  const { t } = useTranslation()
  const closePicker = useProjectExportStore((s) => s.closePicker)
  const [format, setFormat] = useState<ProjectExportFormat>('testnizer')

  function handleExport() {
    const { projectId, projectName } = target
    // Close first: the native save dialog should not sit on top of the picker.
    // The shared action reports success / failure / skipped items by toast.
    closePicker()
    void exportProjectAs(projectId, format, projectName)
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) closePicker()
      }}
      title={t('projectExport.title')}
      testId="project-export-modal"
      // Opened from inside Settings (itself a modal) as well — sit above it.
      zIndex={Z.MODAL + 2}
    >
      <div className="w-[440px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--white)] shadow-2xl">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--text)]">{t('projectExport.title')}</div>
          {target.projectName && (
            <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{target.projectName}</div>
          )}
        </header>

        <div
          role="radiogroup"
          aria-label={t('projectExport.formatLabel')}
          className="flex flex-col gap-2 p-4"
        >
          {PROJECT_EXPORT_FORMATS.map((f) => {
            const selected = f.id === format
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`project-export-format-${f.id}`}
                onClick={() => setFormat(f.id)}
                className={`flex w-full cursor-pointer flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                    : 'border-[var(--border)] bg-transparent hover:bg-[var(--item-hover)]'
                }`}
              >
                <span
                  className={`text-sm font-medium ${selected ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                >
                  {t(f.labelKey)}
                </span>
                <span className="text-xs text-[var(--muted)]">{t(f.descKey)}</span>
              </button>
            )
          })}
        </div>

        <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={closePicker}
            className="cursor-pointer rounded-[7px] border border-[var(--border)] bg-transparent px-4 py-1.5 text-[var(--text)]"
          >
            {t('projectExport.cancel')}
          </button>
          <button
            type="button"
            data-testid="project-export-confirm"
            onClick={handleExport}
            className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border-none bg-[var(--accent)] px-4 py-1.5 font-semibold text-white"
          >
            <Upload size={13} />
            {t('projectExport.export')}
          </button>
        </footer>
      </div>
    </Modal>
  )
}
