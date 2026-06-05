import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'
import { useResponseStore } from '../../stores/response.store'
import { useTabsStore } from '../../stores/tabs.store'
import { registerSoapTabActivity, openWsSecurityToolWith } from '../../lib/tools-bridge'
import SoapWsdlImport from './SoapWsdlImport'
import SoapOperationSelector from './SoapOperationSelector'
import SoapBodyEditor from './SoapBodyEditor'
import SoapManualForm from './SoapManualForm'
import AuthTab from '../request/AuthTab'
import HeadersTab from '../request/HeadersTab'
import ResponsePane from '../response/ResponsePane'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import MonacoWrapper from '../shared/MonacoWrapper'

type SoapMode = 'wsdl' | 'manual'
type SoapDetailTab = 'body' | 'auth' | 'headers'

function RawXmlBodyEditor() {
  const rawXml = useSoapStore((s) => s.rawXml)
  const setRawXml = useSoapStore((s) => s.setRawXml)
  return (
    <div className="h-full overflow-hidden rounded-lg border border-[var(--border)]">
      <MonacoWrapper value={rawXml} onChange={setRawXml} language="xml" />
    </div>
  )
}

export default function SoapEditor() {
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const sendSoap = useSoapStore((s) => s.sendSoap)
  const cancelSoap = useSoapStore((s) => s.cancelSoap)
  const rawXml = useSoapStore((s) => s.rawXml)
  const isLoading = useResponseStore((s) => s.isLoading)
  const selectedOperation = useSoapStore((s) => s.selectedOperation)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const [mode, setMode] = useState<SoapMode>('wsdl')
  const [detailTab, setDetailTab] = useState<SoapDetailTab>('body')

  useEffect(() => {
    if (activeTabId) registerSoapTabActivity(activeTabId)
  }, [activeTabId])

  const detailTabs: { key: SoapDetailTab; label: string }[] = [
    { key: 'body', label: 'Body' },
    { key: 'auth', label: 'Auth' },
    { key: 'headers', label: 'Headers' },
  ]

  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={65} minSize={25} maxSize={85}>
        <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
          {/* Mode selector — WSDL Import / Manual */}
          <div
            className="flex shrink-0 items-center"
            style={{
              borderBottom: '1px solid var(--border)',
              background: 'var(--white)',
              padding: '0 4px',
            }}
          >
            {(['wsdl', 'manual'] as const).map((m) => {
              const isActive = mode === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-4 text-sm transition-colors"
                  style={{
                    height: 32,
                    borderBottomWidth: 2,
                    borderBottomStyle: 'solid',
                    borderBottomColor: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--muted)',
                    fontWeight: isActive ? 600 : 400,
                    background: 'transparent',
                    border: 'none',
                  }}
                >
                  {m === 'wsdl' ? 'WSDL Import' : 'Manual'}
                </button>
              )
            })}

            {mode === 'wsdl' && selectedOperation && (
              <span
                className="ml-auto mr-2 rounded-full px-2 py-0.5 text-xs"
                style={{
                  background: 'var(--accent-light)',
                  color: 'var(--accent-text)',
                }}
              >
                {selectedOperation}
              </span>
            )}
          </div>

          {/* Top section: WSDL config or Manual form (with editable Endpoint URL inside) */}
          <div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
            {mode === 'wsdl' && (
              <div className="space-y-3">
                <SoapWsdlImport />
                {parsedWsdl && <SoapOperationSelector />}
              </div>
            )}
            {mode === 'manual' && <SoapManualForm />}
          </div>

          {/* Detail sub-tabs: Body / Auth / Headers */}
          <div
            className="flex shrink-0 items-center"
            style={{
              borderBottom: '1px solid var(--border)',
              background: 'var(--white)',
              padding: '0 4px',
            }}
          >
            {detailTabs.map((tab) => {
              const isActive = detailTab === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setDetailTab(tab.key)}
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap px-3 transition-colors"
                  style={{
                    height: 30,
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
          </div>

          {/* Detail tab content */}
          <div className="flex-1 overflow-hidden">
            {detailTab === 'body' && (
              <div className="h-full px-4 py-3">
                {parsedWsdl ? <SoapBodyEditor /> : <RawXmlBodyEditor />}
              </div>
            )}
            {detailTab === 'auth' && (
              <div className="h-full overflow-y-auto px-4 py-3">
                <AuthTab />
              </div>
            )}
            {detailTab === 'headers' && (
              <div className="h-full overflow-y-auto px-4 py-3">
                <HeadersTab />
              </div>
            )}
          </div>

          {/* Send Button — sticky at bottom */}
          <div className="shrink-0 border-t border-[var(--border)] px-4 py-2 flex gap-2">
            <button
              type="button"
              onClick={() => (isLoading ? cancelSoap() : sendSoap())}
              disabled={!isLoading && !!parsedWsdl && !selectedOperation}
              data-testid="soap-send"
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg py-2.5 font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: isLoading ? '#cc2200' : 'var(--accent)', border: 'none' }}
            >
              <Send size={14} />
              {isLoading ? 'Cancel' : 'Send SOAP Request'}
            </button>
            <button
              type="button"
              onClick={() => openWsSecurityToolWith(rawXml, 'WS-Security')}
              disabled={!rawXml}
              title="Open current request body in WS-Security Tool"
              className="cursor-pointer rounded-lg border px-3 py-2.5 font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              Open in WSSE Tool
            </button>
          </div>
        </div>
      </Panel>

      <PanelResizeHandle
        className="shrink-0 transition-colors hover:bg-[var(--accent)]"
        style={{ height: 4, background: 'var(--border)', cursor: 'row-resize' }}
      />

      <Panel defaultSize={35} minSize={15} maxSize={75}>
        <ResponsePane />
      </Panel>
    </PanelGroup>
  )
}
