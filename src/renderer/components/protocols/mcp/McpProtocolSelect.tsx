import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { MCP_LEGACY_VERSIONS, MCP_MODERN_VERSION } from '../../../lib/mcp-protocol'

/**
 * Protocol era negotiation for the next Connect (issue #152): Auto probes
 * with `server/discover` and falls back to `initialize`; Legacy is the plain
 * 2025 handshake; 2026-07-28 pins the modern era; a 2025-era revision pins
 * `initialize` to exactly that version. Saved with the request (Ctrl+S).
 */
export default function McpProtocolSelect({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const protocol = useMcpStore((s) => s.protocol)
  const setProtocol = useMcpStore((s) => s.setProtocol)
  const known = protocol === 'auto' || protocol === 'legacy' || protocol === MCP_MODERN_VERSION
  const pinned = (MCP_LEGACY_VERSIONS as readonly string[]).includes(protocol)

  return (
    <select
      value={protocol}
      onChange={(e) => setProtocol(e.target.value)}
      disabled={disabled}
      data-testid="mcp-protocol"
      aria-label={t('mcp.protocol.label')}
      title={t('mcp.protocol.hint')}
      className="h-8 max-w-[220px] cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="auto">{t('mcp.protocol.auto')}</option>
      <option value="legacy">{t('mcp.protocol.legacy')}</option>
      <option value={MCP_MODERN_VERSION}>{MCP_MODERN_VERSION}</option>
      <optgroup label={t('mcp.protocol.pinGroup')}>
        {MCP_LEGACY_VERSIONS.map((v) => (
          <option key={v} value={v}>
            {t('mcp.protocol.pin').replace('{version}', v)}
          </option>
        ))}
      </optgroup>
      {!known && !pinned && <option value={protocol}>{protocol}</option>}
    </select>
  )
}
