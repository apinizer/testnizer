import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import GrpcRequestPane from './GrpcRequestPane'
import GrpcResponsePane from './GrpcResponsePane'

export default function GrpcEditor() {
  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={65} minSize={25} maxSize={85}>
        <GrpcRequestPane />
      </Panel>

      <PanelResizeHandle
        className="shrink-0 transition-colors hover:bg-[var(--accent)]"
        style={{ height: 4, background: 'var(--border)', cursor: 'row-resize' }}
      />

      <Panel defaultSize={35} minSize={15} maxSize={75}>
        <GrpcResponsePane />
      </Panel>
    </PanelGroup>
  )
}
