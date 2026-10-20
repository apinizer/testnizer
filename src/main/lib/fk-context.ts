/**
 * Import paths insert rows one by one with `foreign_keys = ON`. When a
 * reference cannot be satisfied SQLite says only "FOREIGN KEY constraint
 * failed" — no table, no row — and that is what reached the user. Wrap each
 * row's INSERT so the error names the table, the row and the references it
 * carried (the SOURCE file's ids, which is what the user can look up).
 */

const REFERENCE_COLUMNS = ['parent_id', 'folder_id', 'suite_id', 'project_id', 'environment_id']

export function withFkContext<T>(
  table: string,
  sourceRow: Record<string, unknown>,
  run: () => T,
): T {
  try {
    return run()
  } catch (e) {
    const message = (e as Error).message ?? String(e)
    if (!/FOREIGN KEY constraint failed/i.test(message)) throw e
    const name = typeof sourceRow.name === 'string' && sourceRow.name ? ` "${sourceRow.name}"` : ''
    const refs = REFERENCE_COLUMNS.filter((c) => sourceRow[c] != null)
      .map((c) => `${c}=${String(sourceRow[c])}`)
      .join(', ')
    throw new Error(
      `FOREIGN KEY constraint failed in ${table}${name}: it references a row that does not exist` +
        (refs ? ` (${refs})` : '') +
        '.',
    )
  }
}
