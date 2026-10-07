import { useState } from 'react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useTabsStore } from '../../../stores/tabs.store'
import { useEnvironmentStore } from '../../../stores/environment.store'
import { useTranslation } from '../../../lib/i18n'
import { resolveVariables } from '../../../lib/variable-resolver'
import { kvRowsToRecord } from '../../../lib/mcp-store-helpers'
import {
  formatMcpConfig,
  MCP_CONFIG_HOSTS,
  serverFromTabFields,
  slugifyServerName,
  type McpConfigHost,
} from '../../../lib/mcp-config'
import CopyButton from '../../shared/CopyButton'
import McpModalFrame from './McpModalFrame'
import { GhostButton } from './ui'

/**
 * Render the current tab as a Claude Desktop / VS Code / Cursor config.
 * `{{var}}` placeholders are resolved from the active environment — the
 * output is meant to work as pasted, so it may contain secrets.
 */
export default function McpConfigExportModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [host, setHost] = useState<McpConfigHost>('claude-desktop')
  const transport = useMcpStore((s) => s.transport)
  const url = useMcpStore((s) => s.url)
  const customHeaders = useMcpStore((s) => s.customHeaders)
  const envVars = useMcpStore((s) => s.envVars)
  const serverName = useMcpStore((s) => s.serverName)
  const tabName = useTabsStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.name)

  const vars = useEnvironmentStore.getState().getActiveVariables()
  const server = serverFromTabFields({
    name: slugifyServerName(serverName ?? tabName),
    transport,
    url: resolveVariables(url, vars),
    headers: transport === 'stdio' ? undefined : kvRowsToRecord(customHeaders, vars),
    env: transport === 'stdio' ? kvRowsToRecord(envVars, vars) : undefined,
  })
  const text = formatMcpConfig(server, host)
  const viaBridge = host === 'claude-desktop' && transport !== 'stdio'

  return (
    <McpModalFrame
      title={t('mcp.config.exportTitle')}
      testId="mcp-config-export-modal"
      onClose={onClose}
      footer={<GhostButton onClick={onClose}>{t('mcp.config.close')}</GhostButton>}
    >
      <div className="flex items-center gap-1" role="tablist">
        {MCP_CONFIG_HOSTS.map((h) => (
          <button
            key={h.id}
            type="button"
            role="tab"
            aria-selected={host === h.id}
            data-testid={`mcp-export-host-${h.id}`}
            onClick={() => setHost(h.id)}
            className={`cursor-pointer rounded-md border px-3 py-1 text-[12px] ${
              host === h.id
                ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent-text)]'
                : 'border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--surface)]'
            }`}
          >
            {h.label}
          </button>
        ))}
        <span className="ml-auto">
          <CopyButton
            text={text}
            ariaLabel={t('mcp.config.copy')}
            label={t('mcp.config.copy')}
            className="rounded-md border px-3 py-1 text-[12px]"
          />
        </span>
      </div>
      {viaBridge && (
        <p className="m-0 text-[12px] text-[var(--muted)]" data-testid="mcp-export-bridge-note">
          {t('mcp.config.bridgeNote')}
        </p>
      )}
      <pre
        data-testid="mcp-export-code"
        className="m-0 max-h-[50vh] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-[12px] text-[var(--text)]"
      >
        {text}
      </pre>
      <p className="m-0 text-[11px] text-[var(--muted)]">{t('mcp.config.secretsNote')}</p>
    </McpModalFrame>
  )
}
