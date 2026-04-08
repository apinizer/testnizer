import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import GrpcRequestPane from './GrpcRequestPane'
import GrpcResponsePane from './GrpcResponsePane'

export default function GrpcEditor() {
  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={50} minSize={20} maxSize={80}>
        <GrpcRequestPane />
      </Panel>

      <PanelResizeHandle className="shrink-0" style={{ height: 1, background: 'var(--border)', cursor: 'row-resize' }} />

      <Panel defaultSize={50} minSize={20} maxSize={80}>
        <GrpcResponsePane />
      </Panel>
    </PanelGroup>
  )
}
