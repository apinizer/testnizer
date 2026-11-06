import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import GraphQLQueryPane from './GraphQLQueryPane'
import GraphQLResponsePane from './GraphQLResponsePane'
import GraphQLSubscriptionLog from './GraphQLSubscriptionLog'
import { useGraphQLStore } from '../../stores/graphql.store'
import { chooseGraphqlOperation } from '../../../shared/graphql-row'

export default function GraphQLEditor() {
  const showSubscriptionLog = useGraphQLStore(
    (s) =>
      // A running subscription keeps its log even while the query is being edited.
      s.subscriptionState === 'connecting' ||
      s.subscriptionState === 'connected' ||
      (chooseGraphqlOperation(s.query, s.operationName).isSubscription &&
        (s.subscriptionState === 'error' ||
          s.subscriptionEnd !== null ||
          s.subscriptionEvents.length > 0)),
  )

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
