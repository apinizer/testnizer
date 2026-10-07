import { useMemo, useState } from 'react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTranslation } from '../../../lib/i18n'
import { McpConfigError, parseMcpConfig, type ParsedMcpServer } from '../../../lib/mcp-config'
import McpModalFrame from './McpModalFrame'
import { ErrorLine, GhostButton, PrimaryButton } from './ui'

function summary(s: ParsedMcpServer): string {
  return s.transport === 'stdio'
    ? [s.command, ...(s.args ?? [])].join(' ')
    : `${s.transport.toUpperCase()} ${s.url ?? ''}`
}

/**
 * Paste a Claude Desktop / VS Code / Cursor MCP config (or one bare server
 * object) and import a server into the current tab: transport, URL or
 * command line, stdio env, HTTP headers.
 */
export default function McpConfigPasteModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const applyServerConfig = useMcpStore((s) => s.applyServerConfig)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState(0)

  const parsed = useMemo<{ servers: ParsedMcpServer[]; error: string | null }>(() => {
    if (!text.trim()) return { servers: [], error: null }
    try {
      return { servers: parseMcpConfig(text), error: null }
    } catch (e) {
      return { servers: [], error: e instanceof McpConfigError ? e.message : String(e) }
    }
  }, [text])
  const index = picked < parsed.servers.length ? picked : 0
  const chosen = parsed.servers[index]

  const apply = (): void => {
    if (!chosen) return
    applyServerConfig(chosen)
    onClose()
  }

  return (
    <McpModalFrame
      title={t('mcp.config.pasteTitle')}
      testId="mcp-config-paste-modal"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>{t('mcp.config.cancel')}</GhostButton>
          <PrimaryButton onClick={apply} disabled={!chosen} data-testid="mcp-config-apply">
            {t('mcp.config.import')}
          </PrimaryButton>
        </>
      }
    >
      <p className="m-0 text-[12px] text-[var(--muted)]">{t('mcp.config.pasteHint')}</p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPicked(0)
        }}
        rows={10}
        spellCheck={false}
        autoFocus
        data-testid="mcp-config-text"
        placeholder={
          '{\n  "mcpServers": {\n    "my-server": { "command": "npx", "args": ["-y", "my-mcp-server"] }\n  }\n}'
        }
        className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--input-bg)] p-2 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
      />
      {parsed.error && <ErrorLine testId="mcp-config-error">{parsed.error}</ErrorLine>}
      {parsed.servers.length > 1 && (
        <div
          className="flex flex-col gap-1"
          role="radiogroup"
          aria-label={t('mcp.config.pickServer')}
        >
          <span className="text-[12px] font-medium">{t('mcp.config.pickServer')}</span>
          {parsed.servers.map((s, i) => (
            <label
              key={`${s.name}-${i}`}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5"
            >
              <input
                type="radio"
                name="mcp-config-server"
                checked={i === index}
                onChange={() => setPicked(i)}
                data-testid={`mcp-config-server-${i}`}
              />
              <span className="font-medium">{s.name}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-[var(--muted)]">
                {summary(s)}
              </span>
            </label>
          ))}
        </div>
      )}
      {parsed.servers.length === 1 && chosen && (
        <div className="text-[12px] text-[var(--muted)]" data-testid="mcp-config-single">
          <span className="font-medium text-[var(--text)]">{chosen.name}</span> — {summary(chosen)}
        </div>
      )}
    </McpModalFrame>
  )
}
