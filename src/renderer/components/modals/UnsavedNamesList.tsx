import { useTranslation } from '../../lib/i18n'

/** How many unsaved request names a project-wide dialog lists before "+N more". */
const MAX_LISTED = 5

/**
 * The names of a project's unsaved requests, as the project-close dialog
 * (`UnsavedChangesDialog`) and the project-delete confirm (`DeleteConfirmDialog`)
 * list them. One listing for both, so the two dialogs cannot drift.
 */
export default function UnsavedNamesList({ names }: { names: string[] }) {
  const { t } = useTranslation()
  if (names.length === 0) return null
  return (
    <ul
      data-testid="unsaved-names"
      className="mt-2 list-disc pl-5 text-sm text-[var(--sub)] [overflow-wrap:anywhere]"
    >
      {names.slice(0, MAX_LISTED).map((name, i) => (
        <li key={`${i}-${name}`}>{name}</li>
      ))}
      {names.length > MAX_LISTED && (
        <li className="list-none text-[var(--muted)]">
          {t('unsaved.moreNames', { count: names.length - MAX_LISTED })}
        </li>
      )}
    </ul>
  )
}
