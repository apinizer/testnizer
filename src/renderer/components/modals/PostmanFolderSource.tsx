import { FolderOpen, Loader2 } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'

/** A picked Postman v3 folder (`importExport.pickPostmanFolder`). */
export interface PostmanFolderPickInfo {
  handle: string
  folderName: string
  kind: 'workspace' | 'collection'
  collections: string[]
  requestCount: number
  environmentCount: number
  globalsCount: number
}

/**
 * Step 2 of the Import modal, Postman card (issue #276 part 2): pick a
 * Postman v3 collection or workspace folder. Main shows the folder dialog and
 * checks the folder; the modal only ever holds the opaque handle.
 */
export function PostmanFolderSource({ loading, onPick }: { loading: boolean; onPick: () => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 font-medium text-[var(--text)]">
        <FolderOpen size={15} aria-hidden="true" />
        {t('import.postmanFolder.label')}
      </label>
      <button
        type="button"
        data-testid="import-postman-folder"
        onClick={onPick}
        disabled={loading}
        className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border2)] bg-transparent py-4 text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <FolderOpen size={16} aria-hidden="true" />
        )}
        {t('import.postmanFolder.button')}
      </button>
      <div className="mt-1.5 text-[var(--hint)]">{t('import.postmanFolder.hint')}</div>
    </div>
  )
}

/** Step 3: what the picked folder holds. */
export function PostmanFolderSummary({ pick }: { pick: PostmanFolderPickInfo }) {
  const { t } = useTranslation()
  const summary = t('import.postmanFolder.summary')
    .replace('{collections}', String(pick.collections.length))
    .replace('{requests}', String(pick.requestCount))
    .replace('{environments}', String(pick.environmentCount))
  return (
    <div
      data-testid="import-postman-folder-summary"
      className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <FolderOpen size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
      <div className="min-w-0 text-[var(--text)]">
        <div>
          {t('import.postmanFolder.ready')} <span className="font-semibold">{pick.folderName}</span>
        </div>
        <div className="text-[var(--sub)]">
          {summary}
          {pick.globalsCount > 0 ? ` · ${t('import.postmanFolder.globals')}` : ''}
        </div>
        {pick.collections.length > 1 && (
          <div className="truncate text-[var(--sub)]" title={pick.collections.join(', ')}>
            {t('import.postmanFolder.eachInFolder')}
          </div>
        )}
      </div>
    </div>
  )
}
