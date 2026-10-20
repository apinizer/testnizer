/**
 * Hook behind every "Open in … tab" header button of a mock server (issue
 * #221): SSE (`MockOpenInSse.tsx`) and AI Chat (`MockOpenInAiChat.tsx`).
 */
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import type { MockServer } from '../../types'

/**
 * The start-then-open state every "Open in … tab" button shares (SSE in
 * `MockOpenInSse.tsx`, AI Chat in `MockOpenInAiChat.tsx`): the running / stopped label, the
 * starting guard and the `{ running, start }` the `startAndOpenMockIn…Tab`
 * helpers take (stopped → start first and open only on success; a start
 * error is a toast, no tab).
 */
export function useStartThenOpen(
  server: MockServer,
  status: string,
  keys: { open: string; startAndOpen: string },
) {
  const { t } = useTranslation()
  const startServer = useMockStore((s) => s.startServer)
  const running = status === 'running'
  return {
    label: running ? t(keys.open) : t(keys.startAndOpen),
    starting: status === 'starting',
    gate: { running, start: () => startServer(server.id) },
  }
}
