import { useState } from 'react'
import { Send } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'
import { useResponseStore } from '../../stores/response.store'
import SoapWsdlImport from './SoapWsdlImport'
import SoapOperationSelector from './SoapOperationSelector'
import SoapBodyEditor from './SoapBodyEditor'
import AuthTab from '../request/AuthTab'
import HeadersTab from '../request/HeadersTab'
import ResponsePane from '../response/ResponsePane'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

type SoapTabKey = 'wsdl' | 'body' | 'auth' | 'headers'

export default function SoapEditor() {
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const sendSoap = useSoapStore((s) => s.sendSoap)
  const isLoading = useResponseStore((s) => s.isLoading)
  const selectedOperation = useSoapStore((s) => s.selectedOperation)
  const [activeTab, setActiveTab] = useState<SoapTabKey>('wsdl')

  const tabs: { key: SoapTabKey; label: string }[] = [
    { key: 'wsdl', label: 'WSDL' },
    { key: 'body', label: 'Body' },
    { key: 'auth', label: 'Auth' },
    { key: 'headers', label: 'Headers' },
  ]

  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={50} minSize={20} maxSize={80}>
        <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
          {/* Tab bar */}
          <div
            className="flex shrink-0 items-center overflow-x-auto"
            style={{ borderBottom: '1px solid var(--border)', background: 'var(--white)', padding: '0 4px' }}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-2.5 text-[13px] transition-colors"
                  style={{
                    height: 30,
                    borderBottom: 'none',
                    borderBottomWidth: 2,
                    borderBottomStyle: 'solid',
                    borderBottomColor: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--muted)',
                    fontWeight: isActive ? 500 : 400,
                    background: 'transparent',
                    border: 'none',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}

            {selectedOperation && (
              <span className="ml-auto mr-2 rounded-full bg-[var(--accent-light)] px-2 py-0.5 text-[0.75rem] text-[var(--accent-text)]">
                {selectedOperation}
              </span>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3.5">
            {activeTab === 'wsdl' && (
              <div className="space-y-4">
                <SoapWsdlImport />
                {parsedWsdl && <SoapOperationSelector />}
              </div>
            )}

            {activeTab === 'body' && (
              <div className="space-y-4">
                {parsedWsdl ? (
                  <SoapBodyEditor />
                ) : (
                  <div className="py-8 text-center text-sm" style={{ color: 'var(--hint)' }}>
                    Import a WSDL first to edit the request body.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'auth' && <AuthTab />}

            {activeTab === 'headers' && <HeadersTab />}
          </div>

          {/* Send Button — sticky at bottom */}
          {parsedWsdl && (
            <div className="shrink-0 border-t border-[var(--border)] px-3.5 py-2">
              <button
                type="button"
                onClick={sendSoap}
                disabled={isLoading || !selectedOperation}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--accent)', border: 'none' }}
              >
                <Send size={14} />
                {isLoading ? 'Sending...' : 'Send SOAP Request'}
              </button>
            </div>
          )}
        </div>
      </Panel>

      <PanelResizeHandle
        className="shrink-0"
        style={{ height: 1, background: 'var(--border)', cursor: 'row-resize' }}
      />

      <Panel defaultSize={50} minSize={20} maxSize={80}>
        <ResponsePane />
      </Panel>
    </PanelGroup>
  )
}
