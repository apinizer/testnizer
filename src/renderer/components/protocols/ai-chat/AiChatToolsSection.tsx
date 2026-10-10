import { useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Plus, Wrench } from 'lucide-react'
import { useAiChatStore } from '../../../stores/ai-chat.store'
import { useWorkspaceStore } from '../../../stores/workspace.store'
import {
  addAdhocToolServer,
  addSavedToolServer,
  setAutoApproveTools,
} from '../../../stores/ai-chat-tools'
import {
  hasSessionOnlyServerCredential,
  type AiToolServerConfig,
} from '../../../lib/ai-chat-tools-config'
import { useTranslation } from '../../../lib/i18n'
import AiChatToolServerRow from './AiChatToolServerRow'
import { mcpRequestsOf } from '../../../lib/ai-chat-view'

const NO_SERVERS: AiToolServerConfig[] = []

/**
 * Tools tab (issue #180, Postman parity): MCP servers whose tools the model
 * may call — picked from the project's saved MCP requests or added ad hoc —
 * with server and per-tool on/off. "Run tools without asking" is an opt-in
 * with a warning (approval is on by default); it is never saved with the request.
 */
export default function AiChatToolsSection(): ReactElement {
  const { t } = useTranslation()
  const servers = useAiChatStore((s) => s.toolServers) ?? NO_SERVERS
  const autoApprove = useAiChatStore((s) => s.autoApproveTools === true)
  const tree = useWorkspaceStore((s) => s.treeData)
  const [expanded, setExpanded] = useState(false)
  const candidates = useMemo(() => mcpRequestsOf(tree ?? []), [tree])
  const enabledCount = servers.filter((s) => s.enabled).length
  const sessionOnly = hasSessionOnlyServerCredential(servers)

  return (
    <div className="shrink-0 border-b border-[var(--border)]" data-testid="ai-tools-section">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="ai-tools-toggle"
        className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
        style={{ background: 'transparent', border: 'none' }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-[var(--muted)]" />
        <span>{t('aiChat.tools.title')}</span>
        {enabledCount > 0 && (
          <span
            className="ml-1 rounded-full px-[6px]"
            style={{ background: 'var(--green-bg)', color: 'var(--green)', fontSize: 11 }}
          >
            {enabledCount}
          </span>
        )}
        {autoApprove && (
          <span className="ml-auto text-[var(--orange)]" style={{ fontSize: 11 }}>
            {t('aiChat.tools.autoApproveOn')}
          </span>
        )}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 p-3.5 pt-1">
          <p className="text-[var(--muted)]" style={{ fontSize: 11.5 }}>
            {t('aiChat.tools.hint')}
          </p>
          {servers.map((s) => (
            <AiChatToolServerRow key={s.id} server={s} />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value=""
              onChange={(e) => {
                const ref = candidates.find((c) => c.id === e.target.value)
                if (ref)
                  addSavedToolServer({ requestId: ref.id, requestKind: ref.kind, name: ref.name })
              }}
              disabled={candidates.length === 0}
              data-testid="ai-tools-pick-saved"
              aria-label={t('aiChat.tools.addSaved')}
              className="rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)]"
              style={{ fontSize: 12 }}
            >
              <option value="">
                {candidates.length === 0
                  ? t('aiChat.tools.noSavedMcp')
                  : t('aiChat.tools.addSaved')}
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addAdhocToolServer}
              data-testid="ai-tools-add-adhoc"
              className="flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)]"
              style={{ fontSize: 12 }}
            >
              <Plus size={12} />
              {t('aiChat.tools.addAdhoc')}
            </button>
          </div>
          {sessionOnly && (
            <p role="status" className="text-[var(--orange)]" style={{ fontSize: 11 }}>
              {t('aiChat.tools.sessionOnly')}
            </p>
          )}
          <label className="flex items-start gap-2" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(e) => setAutoApproveTools(e.target.checked)}
              data-testid="ai-tools-auto-approve"
            />
            <span className="flex flex-col">
              <span className="text-[var(--text)]">{t('aiChat.tools.autoApprove')}</span>
              {autoApprove && (
                <span
                  className="flex items-center gap-1 text-[var(--orange)]"
                  style={{ fontSize: 11 }}
                >
                  <AlertTriangle size={11} />
                  {t('aiChat.tools.autoApproveWarning')}
                </span>
              )}
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
