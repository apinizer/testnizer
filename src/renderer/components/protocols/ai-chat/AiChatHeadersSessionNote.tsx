import type { ReactElement } from 'react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import { hasSessionOnlyCredentialHeader } from '../../../lib/ai-chat-config'
import { useTranslation } from '../../../lib/i18n'

/**
 * Inline note in the AI Chat headers section (issue #187): a credential header
 * (Authorization, *-Key, *-Token…) with a literal value is used for this
 * session only — it is not saved with the request nor kept after a restart.
 * Suggests a `{{variable}}`, which is saved.
 */
export default function AiChatHeadersSessionNote(): ReactElement | null {
  const { t } = useTranslation()
  const show = useAiChatStore((s) => hasSessionOnlyCredentialHeader(s.customHeaders))
  if (!show) return null
  return (
    <p
      data-testid="ai-headers-session-only-note"
      role="status"
      className="px-3 pb-2 text-[var(--orange)]"
      style={{ fontSize: 11 }}
    >
      {t('aiChat.headersSessionOnly')}
    </p>
  )
}
