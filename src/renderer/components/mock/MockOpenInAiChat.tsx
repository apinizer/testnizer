/**
 * "Open in AI Chat tab" / "Start & open in AI Chat tab" of an AI mock server
 * (issue #221, design Ek D §D.3.3–D.3.5) — the AI twin of
 * `MockSseHeaderButton` (`MockOpenInSse.tsx`): same place in the editor
 * header, same `GhostButton` + `ExternalLink`, same start-then-open path
 * (`useStartThenOpen`). Targets the chat endpoint (`chatTargetEndpoint`);
 * none → disabled with the reason. There is no per-endpoint AI Chat button:
 * the header one is enough (§D.3.3).
 */
import { ExternalLink } from 'lucide-react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import type { MockEndpoint, MockServer } from '../../types'
import { GhostButton } from '../mock-mcp/ui'
import {
  chatTargetEndpoint,
  mockEndpointUrl,
  startAndOpenMockInAiChatTab,
} from './mock-open-in-tab'
import { useStartThenOpen } from './use-start-then-open'

const EMPTY_ENDPOINTS: readonly MockEndpoint[] = []

export function MockAiChatHeaderButton({ server, status }: { server: MockServer; status: string }) {
  const { t } = useTranslation()
  const endpoints = useMockStore((s) => s.endpointsByServer[server.id]) ?? EMPTY_ENDPOINTS
  const target = chatTargetEndpoint(endpoints)
  const { label, starting, gate } = useStartThenOpen(server, status, {
    open: 'mock.openInAiChat',
    startAndOpen: 'mock.startAndOpenInAiChat',
  })
  const reason = target ? null : t('mock.noChatEndpoint')

  function open(path: string): void {
    void startAndOpenMockInAiChatTab({
      name: server.name,
      url: mockEndpointUrl(server, path),
      ...gate,
    })
  }

  return (
    <GhostButton
      data-testid="mock-open-in-ai-chat"
      onClick={() => target && open(target.path)}
      disabled={!target || starting}
      title={reason ?? label}
      aria-label={reason ? `${label}. ${reason}` : label}
    >
      <ExternalLink size={12} />
      {label}
    </GhostButton>
  )
}
