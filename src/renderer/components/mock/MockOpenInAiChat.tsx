/**
 * "Open in AI Chat tab" / "Start & open in AI Chat tab" of an AI mock server
 * (issue #221, design Ek D §D.3.3–D.3.5) — the AI twin of
 * `MockSseHeaderButton` (`MockOpenInSse.tsx`): same place in the editor
 * header, same `GhostButton` + `ExternalLink`, same start-then-open path
 * (`useStartThenOpen`). There is no per-endpoint AI Chat button: the header
 * one is enough (§D.3.3).
 *
 *  - `MockAiChatHeaderButton` — the OpenAI-compatible chat endpoint
 *    (`chatTargetEndpoint`) on the Custom provider; none → disabled with the
 *    reason, or hidden when the server is Anthropic-only.
 *  - `MockAiChatAnthropicButton` (issue #222) — the Anthropic `…/messages`
 *    endpoint (`anthropicTargetEndpoint`) on the Anthropic provider; shown
 *    only when the server has one.
 *
 * Neither sends a saved provider key to the mock (`openMockInAiChatTab`).
 */
import { ExternalLink } from 'lucide-react'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import type { MockEndpoint, MockServer } from '../../types'
import { GhostButton } from '../mock-mcp/ui'
import {
  anthropicTargetEndpoint,
  chatTargetEndpoint,
  mockEndpointUrl,
  startAndOpenMockInAiChatTab,
} from './mock-open-in-tab'
import { useStartThenOpen } from './use-start-then-open'

const EMPTY_ENDPOINTS: readonly MockEndpoint[] = []

function useOpenInAiChat(
  server: MockServer,
  status: string,
  provider: 'custom' | 'anthropic',
  keys: { open: string; startAndOpen: string },
) {
  const { label, starting, gate } = useStartThenOpen(server, status, keys)
  return {
    label,
    starting,
    open: (path: string): void => {
      void startAndOpenMockInAiChatTab({
        name: server.name,
        url: mockEndpointUrl(server, path),
        provider,
        ...gate,
      })
    },
  }
}

export function MockAiChatHeaderButton({ server, status }: { server: MockServer; status: string }) {
  const { t } = useTranslation()
  const endpoints = useMockStore((s) => s.endpointsByServer[server.id]) ?? EMPTY_ENDPOINTS
  const target = chatTargetEndpoint(endpoints)
  const { label, starting, open } = useOpenInAiChat(server, status, 'custom', {
    open: 'mock.openInAiChat',
    startAndOpen: 'mock.startAndOpenInAiChat',
  })
  const reason = target ? null : t('mock.noChatEndpoint')
  // An Anthropic-only server has the Anthropic button; "add /chat/completions
  // first" would read as a fault there (issue #222).
  if (!target && anthropicTargetEndpoint(endpoints)) return null

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

export function MockAiChatAnthropicButton({
  server,
  status,
}: {
  server: MockServer
  status: string
}) {
  const endpoints = useMockStore((s) => s.endpointsByServer[server.id]) ?? EMPTY_ENDPOINTS
  const target = anthropicTargetEndpoint(endpoints)
  const { label, starting, open } = useOpenInAiChat(server, status, 'anthropic', {
    open: 'mock.openInAiChatAnthropic',
    startAndOpen: 'mock.startAndOpenInAiChatAnthropic',
  })
  if (!target) return null

  return (
    <GhostButton
      data-testid="mock-open-in-ai-chat-anthropic"
      onClick={() => open(target.path)}
      disabled={starting}
      title={label}
      aria-label={label}
    >
      <ExternalLink size={12} />
      {label}
    </GhostButton>
  )
}
