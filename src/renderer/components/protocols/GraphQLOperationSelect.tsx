import { useGraphQLStore } from '../../stores/graphql.store'
import { useTranslation } from '../../lib/i18n'
import { SELECT_CLS } from '../mock-mcp/ui'
import { chooseGraphqlOperation } from '../../../shared/graphql-row'

/**
 * Which operation of the document runs. Renders nothing unless the document has
 * several: one operation, an anonymous one or a document that does not parse has
 * nothing to choose. The choice also decides the path (the pane's Run / Subscribe).
 * A running subscription keeps the operation it started with, so the select locks.
 */
export default function GraphQLOperationSelect() {
  const { t } = useTranslation()
  const query = useGraphQLStore((s) => s.query)
  const selected = useGraphQLStore((s) => s.operationName)
  const setOperationName = useGraphQLStore((s) => s.setOperationName)
  const running = useGraphQLStore(
    (s) => s.subscriptionState === 'connected' || s.subscriptionState === 'connecting',
  )
  const { operations, operationName, staleSelection } = chooseGraphqlOperation(query, selected)

  if (operations.length === 0) return null

  const staleText = t('graphql.operation.stale', {
    name: staleSelection ?? '',
    used: operationName ?? '',
  })

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2" data-testid="graphql-operation">
      {staleSelection && (
        <span
          role="status"
          data-testid="graphql-operation-stale"
          title={staleText}
          className="min-w-0 truncate text-[var(--orange)]"
        >
          {staleText}
        </span>
      )}
      <label htmlFor="graphql-operation-select" className="shrink-0 text-[var(--muted)]">
        {t('graphql.operation.label')}
      </label>
      <div className="w-[220px] shrink-0">
        <select
          id="graphql-operation-select"
          data-testid="graphql-operation-select"
          value={operationName}
          disabled={running}
          onChange={(e) => setOperationName(e.target.value)}
          className={`${SELECT_CLS} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {operations.map((op) => (
            <option key={op.name} value={op.name}>
              {op.name} ({op.type})
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
