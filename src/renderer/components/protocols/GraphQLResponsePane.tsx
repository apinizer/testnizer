import { useState } from 'react'
import { useGraphQLStore } from '../../stores/graphql.store'
import { useResponseStore } from '../../stores/response.store'
import MonacoWrapper from '../shared/MonacoWrapper'
import GraphQLSchemaExplorer from './GraphQLSchemaExplorer'
import { extractGraphQLErrors } from '../../lib/graphql-errors'

type TabId = 'response' | 'schema'

export default function GraphQLResponsePane() {
  const [activeTab, setActiveTab] = useState<TabId>('response')
  const response = useResponseStore((s) => s.response)
  const isLoading = useResponseStore((s) => s.isLoading)
  const schemaData = useGraphQLStore((s) => s.schemaData)
  const introspectError = useGraphQLStore((s) => s.introspectError)

  const tabs: { id: TabId; label: string }[] = [
    { id: 'response', label: 'Response' },
    { id: 'schema', label: 'Schema Explorer' },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
      {/* Tab bar */}
      <div className="flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--white)]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className="cursor-pointer px-3.5 py-2 font-medium transition-colors"
            style={{
              color: activeTab === tab.id ? 'var(--accent-text)' : 'var(--muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: activeTab === tab.id ? 'var(--accent)' : 'transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'response' && (
          <ResponseTab response={response} isLoading={isLoading} />
        )}
        {activeTab === 'schema' && (
          <GraphQLSchemaExplorer
            schemaData={schemaData}
            error={introspectError}
          />
        )}
      </div>
    </div>
  )
}

function ResponseTab({
  response,
  isLoading,
}: {
  response: ReturnType<typeof useResponseStore.getState>['response']
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--muted)]">
        Running query...
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--hint)]">
        Run a query to see the response
      </div>
    )
  }

  if (response.error && !response.body) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <span className="font-medium text-red-500">Error</span>
        <span className="text-center text-[var(--muted)]">{response.error}</span>
      </div>
    )
  }

  // GraphQL responses can return HTTP 200 with an `errors[]` array — surface
  // those as a banner above the body so users don't miss them buried in JSON.
  const gqlErrors = extractGraphQLErrors(response.body ?? '')

  return (
    <div className="flex h-full flex-col">
      {/* Meta bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-3.5 py-1.5">
        {response.status !== undefined && (
          <span
            className="rounded-full px-2 py-0.5 font-semibold"
            style={{
              background: response.status < 300 ? '#e8f9f1' : response.status < 400 ? '#fff4e0' : '#fff0f0',
              color: response.status < 300 ? '#1a7a4a' : response.status < 400 ? '#b35a00' : '#cc2200',
            }}
          >
            {response.status} {response.statusText || ''}
          </span>
        )}
        <span className="text-[var(--muted)]">
          {response.timing.total}ms
        </span>
        {response.bodySize !== undefined && (
          <span className="text-[var(--hint)]">
            {response.bodySize > 1024
              ? `${(response.bodySize / 1024).toFixed(1)} KB`
              : `${response.bodySize} B`}
          </span>
        )}
      </div>

      {/* GraphQL-level errors banner — shown for HTTP-200 responses that
          carry an `errors[]` array. Listed individually so each `path` and
          `message` is visible at a glance without scrolling the body. */}
      {gqlErrors.length > 0 && (
        <div
          className="shrink-0 border-b border-[var(--border)] px-3.5 py-2"
          style={{
            background: 'rgba(239,68,68,0.08)',
            borderLeft: '3px solid #cc2200',
          }}
        >
          <div className="font-medium" style={{ color: '#cc2200' }}>
            GraphQL errors ({gqlErrors.length})
          </div>
          <ul className="mt-1 space-y-0.5">
            {gqlErrors.slice(0, 5).map((err, i) => (
              <li key={i} className="text-[var(--text)]">
                <span className="font-mono text-[var(--muted)]">
                  {err.path ? `${err.path}: ` : ''}
                </span>
                {err.message}
              </li>
            ))}
            {gqlErrors.length > 5 && (
              <li className="text-[var(--muted)] italic">
                +{gqlErrors.length - 5} more — see body
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0">
        <MonacoWrapper
          value={response.body || ''}
          readOnly
          language="json"
          height="100%"
        />
      </div>
    </div>
  )
}

