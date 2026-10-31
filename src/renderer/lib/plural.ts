/**
 * Issue #309 — the ONE way to write "<n> <noun>" ("1 entries" bug class).
 *
 * Every counter is an i18n pair `<key>One` / `<key>` (both with `{count}`;
 * the convention the G-14 fix started with `mock.entryCountOne` /
 * `mock.entryCount`). Callers pass the two already-translated strings so every
 * key stays a literal `t('…')` the key-coverage test can see:
 *
 *   formatCount(n, t('tools.diff.lineCountOne'), t('tools.diff.lineCount'))
 *
 * Turkish has no plural after a number, so its two strings are usually equal.
 */
export function formatCount(n: number, one: string, other: string): string {
  return (n === 1 ? one : other).replace('{count}', String(n))
}
