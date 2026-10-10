// The "items left out of the export" message (issue #197). Postman / Insomnia /
// OpenAPI carry HTTP requests only; main returns the rows it could not put in
// the file (`skipped`) and this turns them into one user-facing line — names
// with their protocol, capped so a large collection does not flood the toast.

import {
  collectionExportFormatLabel,
  exportProtocolLabel,
  type CollectionExportFormat,
  type ExportSkippedItem,
} from '../../shared/collection-export'

/** Names listed before the rest collapse into "+N more". */
const MAX_LISTED = 5

/** `null` when nothing was left out — the caller then shows no warning. */
export function formatExportSkipped(
  skipped: ExportSkippedItem[] | undefined,
  format: CollectionExportFormat,
  t: (key: string) => string,
): string | null {
  if (!skipped || skipped.length === 0) return null
  let names = skipped
    .slice(0, MAX_LISTED)
    .map((s) => `${s.name} (${exportProtocolLabel(s.protocol)})`)
    .join(', ')
  if (skipped.length > MAX_LISTED) {
    names += ` ${t('export.skippedMore').replace('{count}', String(skipped.length - MAX_LISTED))}`
  }
  return t('export.skipped')
    .replace('{count}', String(skipped.length))
    .replace('{format}', collectionExportFormatLabel(format))
    .replace('{names}', names)
}
