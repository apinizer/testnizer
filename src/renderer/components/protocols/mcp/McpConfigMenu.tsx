import { useState } from 'react'
import { ClipboardPaste, FileOutput } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpConfigPasteModal from './McpConfigPasteModal'
import McpConfigExportModal from './McpConfigExportModal'
import { GhostButton } from './ui'

/**
 * "Paste config…" (Claude Desktop / VS Code / Cursor JSON → this tab) and
 * "Export config" (this tab → a host's JSON). Paste is disabled while
 * connected because it rewrites the connection settings. Icon-only (the
 * label is the tooltip + accessible name) so the connection row keeps its
 * room for the URL at a 1200px window instead of clipping these off the
 * right edge.
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
        aria-label={t('mcp.config.paste')}
      >
        <ClipboardPaste size={14} />
      </GhostButton>
      <GhostButton
        onClick={() => setExportOpen(true)}
        data-testid="mcp-config-export"
        title={t('mcp.config.exportTitle')}
        aria-label={t('mcp.config.export')}
      >
        <FileOutput size={14} />
      </GhostButton>
      {pasteOpen && <McpConfigPasteModal onClose={() => setPasteOpen(false)} />}
      {exportOpen && <McpConfigExportModal onClose={() => setExportOpen(false)} />}
    </>
  )
}
