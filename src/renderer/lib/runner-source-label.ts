/**
 * The run "source" label as shown to the user.
 *
 * The Runner stores the label in English (`Runner`, `Suite: <name>`,
 * `APIs: <name>`) — it is written to `runner_history.source_label` and must
 * stay stable, so only the prefix is translated, at display time. Anything
 * else (a scheduled task name, a label from an older build) is shown as is.
 */
export function displayRunSourceLabel(label: string, t: (key: string) => string): string {
  if (label === 'Runner') return t('runResults.sourceRunner')
  if (label.startsWith('Suite: ')) return `${t('runResults.sourceSuite')}: ${label.slice(7)}`
  if (label.startsWith('APIs: ')) return `${t('runResults.sourceApis')}: ${label.slice(6)}`
  return label
}
