import { useState } from 'react'
import { ClipboardPaste, FileOutput } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpConfigPasteModal from './McpConfigPasteModal'
import McpConfigExportModal from './McpConfigExportModal'
import { GhostButton } from './ui'

/**
 * "Paste config…" (Claude Desktop / VS Code / Cursor JSON → this tab) and
 * "Export config" (this tab → a host's JSON). Paste is disabled while
 * connected because it rewrites the connection settings.
 */
export default function McpConfigMenu({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <>
      <GhostButton
        onClick={() => setPasteOpen(true)}
        disabled={disabled}
        data-testid="mcp-config-paste"
        title={t('mcp.config.pasteTitle')}
      >
        <ClipboardPaste size={13} />
        {t('mcp.config.paste')}
      </GhostButton>
      <GhostButton
        onClick={() => setExportOpen(true)}
        data-testid="mcp-config-export"
        title={t('mcp.config.exportTitle')}
      >
        <FileOutput size={13} />
        {t('mcp.config.export')}
      </GhostButton>
      {pasteOpen && <McpConfigPasteModal onClose={() => setPasteOpen(false)} />}
      {exportOpen && <McpConfigExportModal onClose={() => setExportOpen(false)} />}
    </>
  )
}
