import { useState } from 'react'
import { Play, Search, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { useGraphQLStore } from '../../stores/graphql.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import KeyValueTable from '../shared/KeyValueTable'
import { STANDARD_HTTP_HEADERS } from '../../lib/http-headers'

export default function GraphQLQueryPane() {
  const url = useGraphQLStore((s) => s.url)
  const setUrl = useGraphQLStore((s) => s.setUrl)
  const query = useGraphQLStore((s) => s.query)
  const setQuery = useGraphQLStore((s) => s.setQuery)
  const variables = useGraphQLStore((s) => s.variables)
  const setVariables = useGraphQLStore((s) => s.setVariables)
  const headers = useGraphQLStore((s) => s.headers)
  const addHeader = useGraphQLStore((s) => s.addHeader)
  const updateHeader = useGraphQLStore((s) => s.updateHeader)
  const removeHeader = useGraphQLStore((s) => s.removeHeader)
  const isLoading = useGraphQLStore((s) => s.isLoading)
  const isIntrospecting = useGraphQLStore((s) => s.isIntrospecting)
  const executeQuery = useGraphQLStore((s) => s.executeQuery)
  const cancelQuery = useGraphQLStore((s) => s.cancelQuery)
  const introspect = useGraphQLStore((s) => s.introspect)
  const subscriptionState = useGraphQLStore((s) => s.subscriptionState)
  const subscribe = useGraphQLStore((s) => s.subscribe)
  const unsubscribe = useGraphQLStore((s) => s.unsubscribe)

  const [variablesExpanded, setVariablesExpanded] = useState(true)
  const [headersExpanded, setHeadersExpanded] = useState(false)

  const isSubscription = query.replace(/#.*$/gm, '').trim().startsWith('subscription')
  const isConnected = subscriptionState === 'connected'

  const enabledHeaderCount = headers.filter((h) => h.enabled && h.key.trim()).length

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar label */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
        <span className="font-medium" style={{ color: 'var(--accent-text)' }}>
          GraphQL
        </span>
        {isSubscription && (
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              background: isConnected ? '#e8f9f1' : 'var(--accent-light)',
              color: isConnected ? '#1a7a4a' : 'var(--accent-text)',
            }}
          >
            {isConnected ? 'Subscribed' : 'Subscription'}
          </span>
        )}
      </div>

      {/* URL bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3.5 py-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/graphql"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') executeQuery()
          }}
        />

        {/* Run / Subscribe button */}
        {isSubscription ? (
          <button
            type="button"
            onClick={isConnected ? unsubscribe : subscribe}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: isConnected ? '#cc2200' : 'var(--accent)', border: 'none' }}
          >
            <Play size={13} />
            {isConnected ? 'Unsubscribe' : 'Subscribe'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => (isLoading ? cancelQuery() : executeQuery())}
            disabled={!url.trim()}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: isLoading ? '#cc2200' : 'var(--accent)', border: 'none' }}
          >
            <Play size={13} />
            {isLoading ? 'Cancel' : 'Run'}
          </button>
        )}

        {/* Introspect button */}
        <button
          type="button"
          onClick={introspect}
          disabled={isIntrospecting || !url.trim()}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'transparent' }}
        >
          <Search size={13} />
          {isIntrospecting ? 'Loading...' : 'Introspect'}
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Query editor */}
        <div className="flex-1 min-h-0">
          <MonacoWrapper
            value={query}
            onChange={setQuery}
            language="graphql"
            height="100%"
          />
        </div>

        {/* Variables (collapsible) */}
        <div className="shrink-0 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setVariablesExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {variablesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>Variables</span>
          </button>
          {variablesExpanded && (
            <div className="h-[120px] border-t border-[var(--border)]">
              <MonacoWrapper
                value={variables}
                onChange={setVariables}
                language="json"
                height="100%"
                lineNumbers="off"
              />
            </div>
          )}
        </div>

        {/* Headers (collapsible) */}
        <div className="shrink-0 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => setHeadersExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {headersExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Settings2 size={14} className="text-[var(--muted)]" />
            <span>Headers</span>
            {enabledHeaderCount > 0 && (
              <span
                className="ml-1 rounded-full px-[5px]"
                style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
              >
                {enabledHeaderCount}
              </span>
            )}
          </button>
          {headersExpanded && (
            <div className="border-t border-[var(--border)] p-3">
              <KeyValueTable
                rows={headers}
                onUpdate={updateHeader}
                onRemove={removeHeader}
                onAdd={addHeader}
                addLabel="+ Add Header"
                keyAutocompleteEntries={STANDARD_HTTP_HEADERS}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
