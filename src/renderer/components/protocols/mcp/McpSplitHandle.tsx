import { PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from '../../../lib/i18n'

/** Drag divider for the MCP editor splits (issue #211); the group sets the cursor. */
export default function McpSplitHandle({
  direction,
  testId,
}: {
  direction: 'horizontal' | 'vertical'
  testId: string
}) {
  const { t } = useTranslation()
  const size = direction === 'horizontal' ? 'w-1' : 'h-1'
  return (
    <PanelResizeHandle
      data-testid={testId}
      title={t('shell.dragToResize')}
      className={`${size} shrink-0 bg-[var(--border)] transition-colors hover:bg-[var(--accent)] data-[resize-handle-state=drag]:bg-[var(--accent)]`}
    />
  )
}
