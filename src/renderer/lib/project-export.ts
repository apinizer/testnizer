// One project-export action for every entry point (issue #208): the APIs tree
// root, File → Export, Settings → Storage / Data and the Home project card all
// call `exportProjectAs`, so the format list, the file name, cancel handling
// and the "items left out" warning live in one place.
//
// Three main-process paths sit behind it:
//  - `testnizer` → `save:exportProject` — main builds the project JSON (secrets
//    stripped, issue #177), opens the save dialog and writes the file; a
//    dismissed dialog comes back as `{ success: false, error: 'Cancelled' }`.
//  - `postman-v3-folder` → `export:postmanV3Folder` — main asks where to create
//    the Postman v3 folder and writes it (issue #277); cancelled = `data: null`.
//  - `postman` / `openapi` / `insomnia` → `export:*` returns the file TEXT plus
//    `skipped` (items the format cannot hold, issue #197), then
//    `export:saveFile` opens the dialog; a dismissed dialog comes back as
//    `{ success: true, data: null }` — NOT as an error.
// Both cancel shapes are silent; the skipped warning only follows a file that
// was actually written.

import type { CollectionExportFormat, ExportSkippedItem } from '../../shared/collection-export'
import { formatExportSkipped } from './export-skipped'
import { t as translate } from './i18n'
import { toast } from './toast'
import { useWorkspaceStore } from '../stores/workspace.store'

export type ProjectExportFormat = 'testnizer' | CollectionExportFormat | 'postman-v3-folder'

export interface ProjectExportFormatOption {
  id: ProjectExportFormat
  /** Menu / picker label. */
  labelKey: string
  /** One-line explanation shown in the picker. */
  descKey: string
}

/** Order shown everywhere: native snapshot first, then the collection formats. */
export const PROJECT_EXPORT_FORMATS: readonly ProjectExportFormatOption[] = [
  {
    id: 'testnizer',
    labelKey: 'projectExport.format.testnizer',
    descKey: 'projectExport.format.testnizerDesc',
  },
  {
    id: 'postman',
    labelKey: 'projectExport.format.postman',
    descKey: 'projectExport.format.postmanDesc',
  },
  {
    id: 'postman-v3-folder',
    labelKey: 'projectExport.format.postmanV3Folder',
    descKey: 'projectExport.format.postmanV3FolderDesc',
  },
  {
    id: 'postman-v3',
    labelKey: 'projectExport.format.postmanV3Json',
    descKey: 'projectExport.format.postmanV3JsonDesc',
  },
  {
    id: 'openapi',
    labelKey: 'projectExport.format.openapi',
    descKey: 'projectExport.format.openapiDesc',
  },
  {
    id: 'insomnia',
    labelKey: 'projectExport.format.insomnia',
    descKey: 'projectExport.format.insomniaDesc',
  },
]

/** File-name suffix per collection format — all JSON, so the dialog picks the JSON filter. */
const FILE_SUFFIX: Record<CollectionExportFormat, string> = {
  postman: '.postman_collection.json',
  'postman-v3': '.postman_collection.v3.json',
  openapi: '.openapi.json',
  insomnia: '.insomnia.json',
}

/**
 * Suggested file name for a collection export. The `export:saveFile` path does
 * not run main's `safeFileName`, so characters a file system rejects are
 * replaced here.
 */
export function projectExportFileName(
  projectName: string | null | undefined,
  format: CollectionExportFormat,
): string {
  const base =
    (projectName ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '') || 'project'
  return `${base}${FILE_SUFFIX[format]}`
}

/** Display name of a project from the workspace store, when the caller has none. */
export function projectDisplayName(projectId: string): string | undefined {
  const p = useWorkspaceStore.getState().projects.find((x) => x.id === projectId)
  return p ? p.display_name || p.name : undefined
}

/** Last segment of a POSIX or Windows path — the renderer has no `path` module. */
export function exportedFileName(fullPath: string): string {
  return fullPath.split(/[\\/]/).pop() || fullPath
}

/**
 * Success toast. The title names only the file (issue #208 follow-up): the
 * whole absolute path wrapped to four lines and covered the Settings modal's
 * Save Changes button. The full path stays as a one-line, truncated
 * description so it is still there for anyone who needs the folder.
 */
function exportedToast(path: string | null | undefined): void {
  if (!path) {
    toast.success(translate('toast.exported'))
    return
  }
  toast.success(translate('projectExport.successFile').replace('{file}', exportedFileName(path)), {
    description: path,
    classNames: { content: 'min-w-0', description: 'truncate' },
  })
}

function failedToast(error: string): void {
  toast.error(`${translate('toast.exportFailed')}: ${error}`)
}

type CollectionExportCall = (projectId: string) => Promise<{
  success: boolean
  data?: string
  error?: string
  skipped?: ExportSkippedItem[]
  notes?: string[]
}>

/**
 * What a Postman v3 export could not carry (a timeout, a Socket.IO token, …)
 * — one warning toast, the first lines as its description.
 */
function notesToast(notes: string[] | undefined): void {
  if (!notes || notes.length === 0) return
  toast.warning(translate('export.v3Notes').replace('{count}', String(notes.length)), {
    description: notes.slice(0, 3).join('\n') + (notes.length > 3 ? '\n…' : ''),
  })
}

function collectionExporter(format: CollectionExportFormat): CollectionExportCall | undefined {
  const ie = window.api?.importExport
  if (!ie) return undefined
  switch (format) {
    case 'postman':
      return ie.exportPostman
    case 'openapi':
      return ie.exportOpenApi
    case 'insomnia':
      return ie.exportInsomnia
    case 'postman-v3':
      return ie.exportPostmanV3Json
  }
}

/**
 * Export a whole project in `format`. Resolves `true` when a file was written,
 * `false` on cancel or failure (the user has already been told about a
 * failure). Never throws.
 */
export async function exportProjectAs(
  projectId: string,
  format: ProjectExportFormat,
  projectName?: string,
): Promise<boolean> {
  try {
    if (format === 'testnizer') {
      const res = await window.api?.save?.exportProject?.(projectId)
      if (res?.success) {
        exportedToast(res.data?.path)
        return true
      }
      if (res?.error && res.error !== 'Cancelled') failedToast(res.error)
      return false
    }

    if (format === 'postman-v3-folder') {
      const res = await window.api?.importExport?.exportPostmanV3Folder?.(projectId)
      if (!res?.success) {
        failedToast(res?.error || 'export API unavailable')
        return false
      }
      // `{ success: true, data: null }` = the folder dialog was dismissed.
      if (!res.data) return false
      exportedToast(res.data)
      const skippedMsg = formatExportSkipped(res.skipped, 'postman-v3', translate)
      if (skippedMsg) toast.warning(skippedMsg)
      notesToast(res.notes)
      return true
    }

    const exporter = collectionExporter(format)
    if (!exporter) {
      failedToast('export API unavailable')
      return false
    }
    const built = await exporter(projectId)
    if (!built?.success || typeof built.data !== 'string') {
      failedToast(built?.error || 'empty export')
      return false
    }
    const name = projectName ?? projectDisplayName(projectId)
    const saved = await window.api.importExport.saveFile(
      built.data,
      projectExportFileName(name, format),
    )
    if (!saved?.success) {
      if (saved?.error && saved.error !== 'Cancelled') failedToast(saved.error)
      return false
    }
    // `{ success: true, data: null }` = the save dialog was dismissed.
    if (!saved.data) return false
    exportedToast(saved.data)
    const skippedMsg = formatExportSkipped(built.skipped, format, translate)
    if (skippedMsg) toast.warning(skippedMsg)
    notesToast(built.notes)
    return true
  } catch (err) {
    console.error('Project export failed:', err)
    failedToast((err as Error)?.message || String(err))
    return false
  }
}
