import { KeyRound, Plug, Unplug, X } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import type { McpTransport } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { describeCapabilities } from '../../../lib/mcp-store-helpers'
import { describeDiscover } from '../../../lib/mcp-protocol'
import VariableAutocompleteInput from '../../shared/VariableAutocompleteInput'
import McpConfigMenu from './McpConfigMenu'
import McpProtocolSelect from './McpProtocolSelect'
import McpStatusPill from './McpStatusPill'

const URL_INPUT =
  'h-8 w-full min-w-0 rounded-md border border-[var(--border)] px-2.5 font-mono text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]'

/**
 * Row 1: status pill, transport, protocol, URL / command (grows, never below
 * 280px), Connect, config menu. Row 2, only when connected: the server's name
 * + version and the protocol badge; an error goes in a box under it
 * (WebSocket bar parity, issue #171). The identity used to share row 1, which
 * overflowed at a 1200px window and clipped the badge off-screen. The URL
 * field is the `{{var}}`-aware input HTTP uses — variables resolve at Connect.
 */
export default function McpConnectionBar() {
  const { t } = useTranslation()
  const transport = useMcpStore((s) => s.transport)
  const setTransport = useMcpStore((s) => s.setTransport)
  const url = useMcpStore((s) => s.url)
  const setUrl = useMcpStore((s) => s.setUrl)
  const state = useMcpStore((s) => s.connectionState)
  const errorMessage = useMcpStore((s) => s.errorMessage)
  const serverName = useMcpStore((s) => s.serverName)
  const serverVersion = useMcpStore((s) => s.serverVersion)
  const protocolVersion = useMcpStore((s) => s.protocolVersion)
  const capabilities = useMcpStore((s) => s.capabilities)
  const instructions = useMcpStore((s) => s.instructions)
  const era = useMcpStore((s) => s.era)
  const discover = useMcpStore((s) => s.discover)
  const connect = useMcpStore((s) => s.connect)
  const disconnect = useMcpStore((s) => s.disconnect)
  const unauthorized = useMcpStore((s) => s.unauthorized)
  const openOAuthAuthorization = useMcpStore((s) => s.openOAuthAuthorization)

  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'
  const busy = isConnected || isConnecting
  const capsText = describeCapabilities(capabilities)
  const supported = describeDiscover(discover)
  // Spec terms (server/discover, initialize) live here, in the tooltip only (issue #167).
  const tooltip = [
    era &&
      `${t('mcp.era.title')}: ${era === 'modern' ? t('mcp.era.modern') : t('mcp.era.legacyLong')}`,
    supported.length > 0 && `${t('mcp.era.supportedVersions')}: ${supported.join(', ')}`,
    capsText && `${t('mcp.server.capabilities')}: ${capsText}`,
    instructions && `${t('mcp.server.instructions')}: ${instructions}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const transports: { value: McpTransport; label: string }[] = [
    { value: 'http', label: t('mcp.transport.http') },
    { value: 'sse', label: t('mcp.transport.sse') },
    { value: 'stdio', label: t('mcp.transport.stdio') },
  ]
  const showError = state === 'error' && (!!errorMessage || unauthorized)

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
      {/* Wraps instead of clipping when the pane is narrower than the row; at a
          1200px window everything fits on one line with the URL at >= 280px. */}
      <div data-testid="mcp-connection-row" className="flex flex-wrap items-center gap-2">
        <McpStatusPill state={state} />
        <select
          value={transport}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
          disabled={busy}
          data-testid="mcp-transport"
          className="h-8 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {transports.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <McpProtocolSelect disabled={busy} />
        {/* A disabled fieldset disables the inner <input> (the shared input has no `disabled` prop). */}
        <fieldset
          disabled={busy}
          className="m-0 flex min-w-[280px] flex-1 basis-[280px] border-0 p-0 disabled:opacity-60"
        >
          <VariableAutocompleteInput
            value={url}
            onChange={setUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void connect()
            }}
            data-testid="mcp-url"
            spellCheck={false}
            autoComplete="off"
            placeholder={
              transport === 'stdio'
                ? 'npx -y @modelcontextprotocol/server-everything'
                : 'https://mcp.example.com/mcp'
            }
            className={URL_INPUT}
          />
        </fieldset>
        <button
          type="button"
          onClick={() => void (busy ? disconnect() : connect())}
          disabled={!busy && !url.trim()}
          data-testid="mcp-connect"
          className={`flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-none px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
            busy ? 'bg-[var(--mb-delete-fg)]' : 'bg-[var(--accent)]'
          }`}
        >
          {isConnecting ? <X size={14} /> : isConnected ? <Unplug size={14} /> : <Plug size={14} />}
          {isConnecting ? t('mcp.cancel') : isConnected ? t('mcp.disconnect') : t('mcp.connect')}
        </button>
        <McpConfigMenu disabled={busy} />
      </div>
      {isConnected && (serverName || protocolVersion) && (
        <div
          data-testid="mcp-server-info"
          className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--muted)]"
        >
          {serverName && (
            <span data-testid="mcp-server-name" className="min-w-0 truncate">
              {serverName}
              {serverVersion ? ` ${serverVersion}` : ''}
            </span>
          )}
          {protocolVersion && (
            <span
              data-testid="mcp-protocol-version"
              data-era={era ?? undefined}
              title={tooltip || undefined}
              className={`shrink-0 cursor-help rounded border bg-[var(--surface)] px-1.5 font-mono text-[11px] ${
                era === 'modern'
                  ? 'border-[var(--accent)] text-[var(--accent-text)]'
                  : 'border-[var(--border)] text-[var(--text)]'
              }`}
            >
              {/* Never "(legacy)": a 2025 server is simply "MCP 2025-11-25" (issue #167). */}
              {`MCP ${protocolVersion}`}
            </span>
          )}
        </div>
      )}
      {showError && (
        <div
          data-testid="mcp-error-box"
          className="flex items-start gap-2 rounded-md border border-[var(--mb-delete-br)] bg-[var(--mb-delete-bg)] px-3 py-1.5"
        >
          {errorMessage && (
            <span
              data-testid="mcp-error"
              className="min-w-0 flex-1 break-words text-[12px] text-[var(--red)]"
            >
              {errorMessage}
            </span>
          )}
          {unauthorized && (
            <button
              type="button"
              onClick={openOAuthAuthorization}
              data-testid="mcp-oauth-open"
              className="ml-auto flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--accent-text)] hover:bg-[var(--surface)]"
            >
              <KeyRound size={12} />
              {t('mcp.oauth.authorize')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
