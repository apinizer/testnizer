import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useGraphQLStore } from '../../stores/graphql.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import CredentialRestartHint from '../shared/CredentialRestartHint'
import { useTranslation } from '../../lib/i18n'
import { scrubJsonCredentials } from '../../lib/credential-text'

/**
 * The `connection_init` payload of a subscription: a collapsible section, same
 * anatomy as Variables. Servers built for browsers read their token here, because
 * a browser WebSocket cannot set headers. A dot marks it while collapsed.
 */
export default function GraphQLConnectionInitSection() {
  const { t } = useTranslation()
  const connectionInit = useGraphQLStore((s) => s.connectionInit)
  const setConnectionInit = useGraphQLStore((s) => s.setConnectionInit)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="shrink-0 border-t border-[var(--border)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid="graphql-connection-init-toggle"
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('graphql.sub.connectionInit')}</span>
        {connectionInit.trim() && (
          <span
            aria-hidden="true"
            className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--green)]"
          />
        )}
      </button>
      {expanded && (
        <div
          className="h-[100px] border-t border-[var(--border)]"
          data-testid="graphql-connection-init-editor"
        >
          <MonacoWrapper
            value={connectionInit}
            onChange={setConnectionInit}
            language="json"
            height="100%"
            lineNumbers="off"
          />
        </div>
      )}
      {expanded && scrubJsonCredentials(connectionInit) !== connectionInit && (
        <div className="px-3.5 pb-2">
          <CredentialRestartHint
            id="graphql-connection-init-restart-hint-text"
            testId="graphql-connection-init-restart-hint"
          />
        </div>
      )}
    </div>
  )
}
