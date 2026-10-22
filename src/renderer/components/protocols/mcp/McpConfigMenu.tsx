import { useState } from 'react'
import { ClipboardPaste, FileOutput } from 'lucide-react'
import { useTranslation } from '../../../lib/i18n'
import McpConfigPasteModal from './McpConfigPasteModal'
import McpConfigExportModal from './McpConfigExportModal'
import { CB_ICON_BUTTON } from '../connection-bar-ui'

/**
 * "Paste config…" (Claude Desktop / VS Code / Cursor JSON → this tab) and
 * "Export config" (this tab → a host's JSON). Paste is disabled while
 * connected because it rewrites the connection settings. Icon-only (the
 * label is the tooltip + accessible name) so the connection row keeps its
 * room for the URL at a 1200px window instead of clipping these off the
 * right edge. Square bar-height buttons (≥ 28×28, `connection-bar-ui.ts`);
 * they sit in the URL group, which never splits, so they stay on the URL's
 * line at the 16px font size too.
 */
export default function McpConfigMenu({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setPasteOpen(true)}
        disabled={disabled}
        data-testid="mcp-config-paste"
        title={t('mcp.config.pasteTitle')}
        aria-label={t('mcp.config.paste')}
        className={CB_ICON_BUTTON}
      >
        <ClipboardPaste size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setExportOpen(true)}
        data-testid="mcp-config-export"
        title={t('mcp.config.exportTitle')}
        aria-label={t('mcp.config.export')}
        className={CB_ICON_BUTTON}
      >
        <FileOutput size={14} aria-hidden="true" />
      </button>
      {pasteOpen && <McpConfigPasteModal onClose={() => setPasteOpen(false)} />}
      {exportOpen && <McpConfigExportModal onClose={() => setExportOpen(false)} />}
    </>
  )
}
