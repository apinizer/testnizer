import { KeyRound, Plug, Unplug, X } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import type { McpTransport } from '../../../types/mcp'
import { useTranslation } from '../../../lib/i18n'
import { describeCapabilities } from '../../../lib/mcp-store-helpers'
import McpConfigMenu from './McpConfigMenu'

/** Transport, URL / command, Connect, config menu and the connected server's identity. */
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
  const connect = useMcpStore((s) => s.connect)
  const disconnect = useMcpStore((s) => s.disconnect)
  const unauthorized = useMcpStore((s) => s.unauthorized)
  const openOAuthAuthorization = useMcpStore((s) => s.openOAuthAuthorization)

  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'
  const busy = isConnected || isConnecting
  const capsText = describeCapabilities(capabilities)
  const tooltip = [
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

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
      <select
        value={transport}
        onChange={(e) => setTransport(e.target.value as McpTransport)}
        disabled={busy}
        data-testid="mcp-transport"
        className="h-8 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--white)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {transports.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy) void connect()
        }}
        disabled={busy}
        data-testid="mcp-url"
        spellCheck={false}
        placeholder={
          transport === 'stdio'
            ? 'npx -y @modelcontextprotocol/server-everything'
            : 'https://mcp.example.com/mcp'
        }
        className="h-8 min-w-[200px] flex-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2.5 font-mono text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] disabled:bg-[var(--bg)]"
      />
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
      {isConnected && (
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--muted)]">
          {serverName && (
            <span data-testid="mcp-server-name" className="truncate">
              {serverName}
              {serverVersion ? ` ${serverVersion}` : ''}
            </span>
          )}
          {protocolVersion && (
            <span
              data-testid="mcp-protocol-version"
              title={tooltip || undefined}
              className="shrink-0 cursor-help rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 font-mono text-[11px] text-[var(--text)]"
            >
              MCP {protocolVersion}
            </span>
          )}
        </span>
      )}
      {state === 'error' && errorMessage && (
        <span data-testid="mcp-error" className="text-[12px] text-[var(--red)]">
          {errorMessage}
        </span>
      )}
      {state === 'error' && unauthorized && (
        <button
          type="button"
          onClick={openOAuthAuthorization}
          data-testid="mcp-oauth-open"
          className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-transparent px-2 text-[12px] text-[var(--accent-text)] hover:bg-[var(--surface)]"
        >
          <KeyRound size={12} />
          {t('mcp.oauth.authorize')}
        </button>
      )}
    </div>
  )
}
