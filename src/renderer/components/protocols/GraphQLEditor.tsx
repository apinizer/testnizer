import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import GraphQLQueryPane from './GraphQLQueryPane'
import GraphQLResponsePane from './GraphQLResponsePane'
import GraphQLSubscriptionLog from './GraphQLSubscriptionLog'
import { useGraphQLStore } from '../../stores/graphql.store'

export default function GraphQLEditor() {
  const query = useGraphQLStore((s) => s.query)
  const subscriptionState = useGraphQLStore((s) => s.subscriptionState)

  const isSubscription = query.replace(/#.*$/gm, '').trim().startsWith('subscription')
  const showSubscriptionLog = isSubscription && subscriptionState === 'connected'

  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={65} minSize={25} maxSize={85}>
        <GraphQLQueryPane />
      </Panel>

      <PanelResizeHandle
        className="shrink-0 transition-colors hover:bg-[var(--accent)]"
        style={{ height: 4, background: 'var(--border)', cursor: 'row-resize' }}
      />

      <Panel defaultSize={35} minSize={15} maxSize={75}>
        {showSubscriptionLog ? <GraphQLSubscriptionLog /> : <GraphQLResponsePane />}
      </Panel>
    </PanelGroup>
  )
}
