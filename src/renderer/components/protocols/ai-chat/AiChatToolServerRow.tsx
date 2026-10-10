import type { ReactElement } from 'react'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import {
  loadServerTools,
  trustServerTools,
  removeToolServer,
  toggleTool,
  updateToolServer,
} from '../../../stores/ai-chat-tools'
import { serverLabel, type AiToolServerConfig } from '../../../lib/ai-chat-tools-config'
import { makeId } from '../../../lib/utils'
import { useTranslation } from '../../../lib/i18n'
import KeyValueTable from '../../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../../lib/http-headers'
import AiChatTrustCard from './AiChatTrustCard'
import type { KeyValuePair } from '../../../types'

const INPUT =
  'rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]'

/** Header / env rows of an ad-hoc server, edited through the server config. */
function KvEditor({
  server,
  field,
  addLabel,
}: {
  server: AiToolServerConfig
  field: 'headers' | 'envVars'
  addLabel: string
}): ReactElement {
  const rows = server[field] ?? []
  const write = (next: KeyValuePair[]): void => updateToolServer(server.id, { [field]: next })
  return (
    <KeyValueTable
      rows={rows}
      onUpdate={(id, patch) => write(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))}
      onRemove={(id) => write(rows.filter((r) => r.id !== id))}
      onAdd={() => write([...rows, { id: makeId(), key: '', value: '', enabled: true }])}
      onReplaceAll={write}
      addLabel={addLabel}
      {...(field === 'headers' ? { keyAutocompleteEntries: STANDARD_HTTP_HEADERS } : {})}
    />
  )
}

/** One MCP server of the Tools tab: on/off, connection (ad hoc), tool list with per-tool on/off. */
export default function AiChatToolServerRow({
  server,
}: {
  server: AiToolServerConfig
}): ReactElement {
  const { t } = useTranslation()
  const entry = useAiChatStore((s) => s.toolCatalog?.[server.id])
  const off = new Set(server.disabledTools)
  const trustToken = entry?.untrusted?.trustToken
  const adhoc = server.source === 'adhoc'

  return (
    <div className="rounded-md border border-[var(--border)]" data-testid="ai-tool-server">
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={server.enabled}
          onChange={(e) => updateToolServer(server.id, { enabled: e.target.checked })}
          aria-label={t('aiChat.tools.serverEnabled')}
          data-testid="ai-tool-server-enabled"
        />
        <span className="flex-1 truncate font-medium text-[var(--text)]" style={{ fontSize: 12.5 }}>
          {serverLabel(server)}
        </span>
        <span
          className="rounded px-1.5 text-[var(--muted)]"
          style={{ fontSize: 10.5, background: 'var(--surface)' }}
        >
          {adhoc ? t('aiChat.tools.adhoc') : t('aiChat.tools.savedRequest')}
        </span>
        {server.missing && (
          <span
            className="text-[var(--red)]"
            style={{ fontSize: 10.5 }}
            data-testid="ai-tool-server-missing"
          >
            {t('aiChat.tools.missing')}
          </span>
        )}
        <button
          type="button"
          onClick={() => void loadServerTools(server.id)}
          disabled={entry?.loading}
          className="flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-[var(--white)] px-2 py-0.5 text-[var(--text)] disabled:opacity-50"
          style={{ fontSize: 11.5 }}
          data-testid="ai-tool-server-load"
        >
          {entry?.loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {t('aiChat.tools.loadTools')}
        </button>
        <button
          type="button"
          onClick={() => removeToolServer(server.id)}
          title={t('aiChat.tools.removeServer')}
          aria-label={t('aiChat.tools.removeServer')}
          className="cursor-pointer border-none bg-transparent p-1 text-[var(--muted)] hover:text-[var(--red)]"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {adhoc && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] p-3">
          <div className="flex gap-2">
            <input
              value={server.name}
              onChange={(e) => updateToolServer(server.id, { name: e.target.value })}
              placeholder={t('aiChat.tools.serverName')}
              className={`${INPUT} w-40`}
              style={{ fontSize: 12 }}
            />
            <select
              value={server.transport ?? 'http'}
              onChange={(e) =>
                updateToolServer(server.id, {
                  transport: e.target.value as AiToolServerConfig['transport'],
                })
              }
              className={INPUT}
              style={{ fontSize: 12 }}
              aria-label={t('aiChat.tools.transport')}
            >
              <option value="http">Streamable HTTP</option>
              <option value="sse">SSE</option>
              <option value="stdio">stdio</option>
            </select>
            <input
              value={server.url ?? ''}
              onChange={(e) => updateToolServer(server.id, { url: e.target.value })}
              placeholder={
                server.transport === 'stdio'
                  ? t('aiChat.tools.commandPlaceholder')
                  : t('aiChat.tools.urlPlaceholder')
              }
              spellCheck={false}
              className={`${INPUT} flex-1 font-mono`}
              style={{ fontSize: 12 }}
              data-testid="ai-tool-server-url"
            />
          </div>
          <KvEditor
            server={server}
            field={server.transport === 'stdio' ? 'envVars' : 'headers'}
            addLabel={
              server.transport === 'stdio' ? t('aiChat.tools.addEnv') : t('aiChat.addHeader')
            }
          />
        </div>
      )}

      {entry?.error && (
        <p
          className="border-t border-[var(--border)] px-3 py-2 text-[var(--red)]"
          style={{ fontSize: 11.5 }}
        >
          {entry.error}
        </p>
      )}
      {entry?.untrusted && (
        <div className="border-t border-[var(--border)] p-3">
          <AiChatTrustCard
            commandLine={entry.untrusted.commandLine}
            envNames={entry.untrusted.envNames}
            {...(entry.untrusted.env ? { env: entry.untrusted.env } : {})}
            {...(trustToken ? { onTrust: () => void trustServerTools(server.id, trustToken) } : {})}
          />
        </div>
      )}
      {entry?.tools && (
        <ul
          className="flex flex-col gap-1 border-t border-[var(--border)] px-3 py-2"
          data-testid="ai-tool-list"
        >
          {entry.tools.length === 0 && (
            <li className="text-[var(--muted)]" style={{ fontSize: 11.5 }}>
              {t('aiChat.tools.noTools')}
            </li>
          )}
          {entry.tools.map((tool) => (
            <li key={tool.name} className="flex items-start gap-2" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!off.has(tool.name)}
                onChange={(e) => toggleTool(server.id, tool.name, e.target.checked)}
                aria-label={tool.name}
              />
              <span className="font-mono text-[var(--text)]">{tool.name}</span>
              {tool.description && (
                <span className="truncate text-[var(--muted)]">{tool.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
