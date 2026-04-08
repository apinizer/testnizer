import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import UrlBar from './UrlBar'
import RequestEditor from '../request/RequestEditor'
import ResponsePane from '../response/ResponsePane'
import SoapEditor from '../protocols/SoapEditor'
import WebSocketEditor from '../protocols/WebSocketEditor'
import GraphQLEditor from '../protocols/GraphQLEditor'
import GrpcEditor from '../protocols/GrpcEditor'
import SseEditor from '../protocols/SseEditor'
import { useTabsStore } from '../../stores/tabs.store'
import NewRequestWelcome from './NewRequestWelcome'
import ProjectWelcome from './ProjectWelcome'

export default function Workbench() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const protocol = activeTab?.protocol || 'http'

  // No active tab — show project welcome (like Apidog's empty project page)
  if (!activeTab) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <ProjectWelcome />
      </div>
    )
  }

  // Show welcome page for new empty tabs
  const isNewEmptyTab = activeTab.name === 'New Request' && !activeTab.url

  if (isNewEmptyTab) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <NewRequestWelcome />
      </div>
    )
  }

  if (protocol === 'soap') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <SoapEditor />
      </div>
    )
  }

  if (protocol === 'websocket') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <WebSocketEditor />
      </div>
    )
  }

  if (protocol === 'graphql') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <GraphQLEditor />
      </div>
    )
  }

  if (protocol === 'grpc') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <GrpcEditor />
      </div>
    )
  }

  if (protocol === 'sse') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
        <SseEditor />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ background: 'var(--white)' }}>
      {/* URL Bar */}
      <UrlBar />

      {/* Split pane: Request (top) | Response (bottom) */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <RequestEditor />
        </Panel>

        <PanelResizeHandle
          className="shrink-0"
          style={{ height: 1, background: 'var(--border)', cursor: 'row-resize' }}
        />

        <Panel defaultSize={50} minSize={20} maxSize={80}>
          <ResponsePane />
        </Panel>
      </PanelGroup>
    </div>
  )
}
