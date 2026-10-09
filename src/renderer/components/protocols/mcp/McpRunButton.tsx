import type { ReactNode } from 'react'
import { Square } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import type { McpCallKind } from '../../../stores/mcp-call.slice'
import { withChord } from './call-ui'
import { PrimaryButton } from './ui'

const CALL_ID = {
  tool: (s: { toolCallId: string | null }) => s.toolCallId,
  resource: (s: { resourceCallId: string | null }) => s.resourceCallId,
  prompt: (s: { promptCallId: string | null }) => s.promptCallId,
} as const

/**
 * Invoke / Read / Get, which turns into Cancel while its call runs (issue
 * #163) — the HTTP Send → Cancel pattern. The tooltip names the Ctrl/Cmd+Enter
 * chord (issue #165). The test id stays the button's old one.
 */
export default function McpRunButton({
  kind,
  testId,
  icon,
  label,
  disabled,
  onRun,
}: {
  kind: McpCallKind
  testId: string
  icon: ReactNode
  label: string
  /** Disabled when NOT running (not connected, nothing to send…). Cancel is always enabled. */
  disabled: boolean
  onRun: () => void
}) {
  const { t } = useTranslation()
  const running = useMcpStore((s) => CALL_ID[kind](s) !== null)
  const cancelCall = useMcpStore((s) => s.cancelCall)
  return (
    <PrimaryButton
      onClick={() => (running ? void cancelCall(kind) : onRun())}
      disabled={!running && disabled}
      data-testid={testId}
      data-running={running ? 'true' : 'false'}
      title={running ? t('mcp.call.cancel') : withChord(label)}
      className={running ? 'bg-[var(--red)]' : ''}
    >
      {running ? <Square size={12} /> : icon}
      {running ? t('mcp.call.cancel') : label}
    </PrimaryButton>
  )
}
