/**
 * The store-free half of the "Open in … tab" buttons (issues #221, #222):
 * the running / stopped label, the starting guard and the `{ running, start }`
 * the `startThenOpen` helpers take (stopped → start first and open only on
 * success; a start error is a toast, no tab). `start` resolves to an error
 * message, or null on success — both the HTTP and the Mock MCP store's
 * `startServer` have that shape. Kept apart from `use-start-then-open.ts` so
 * the Mock MCP header does not load the HTTP mock store.
 */
import { useTranslation } from '../../lib/i18n'

export function useStartThenOpenGate(
  status: string,
  start: () => Promise<string | null>,
  keys: { open: string; startAndOpen: string },
) {
  const { t } = useTranslation()
  const running = status === 'running'
  return {
    label: running ? t(keys.open) : t(keys.startAndOpen),
    starting: status === 'starting',
    gate: { running, start },
  }
}
