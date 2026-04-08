import { Send } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'
import { useResponseStore } from '../../stores/response.store'
import SoapWsdlImport from './SoapWsdlImport'
import SoapOperationSelector from './SoapOperationSelector'
import SoapBodyEditor from './SoapBodyEditor'
import SoapSecuritySection from './SoapSecuritySection'
import ResponsePane from '../response/ResponsePane'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

export default function SoapEditor() {
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)
  const sendSoap = useSoapStore((s) => s.sendSoap)
  const isLoading = useResponseStore((s) => s.isLoading)
  const selectedOperation = useSoapStore((s) => s.selectedOperation)

  return (
    <PanelGroup direction="vertical" className="flex-1">
      <Panel defaultSize={50} minSize={20} maxSize={80}>
        <div className="flex h-full flex-col overflow-hidden bg-[var(--white)]">
          {/* Tab bar label */}
          <div className="flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--white)] px-3.5 py-2">
            <span
              className="text-[0.875rem] font-medium"
              style={{ color: 'var(--accent-text)' }}
            >
              SOAP Request
            </span>
            {selectedOperation && (
              <span className="ml-2 rounded-full bg-[var(--accent-light)] px-2 py-0.5 text-[0.875rem] text-[var(--accent-text)]">
                {selectedOperation}
              </span>
            )}
          </div>

          {/* Scrollable content */}
          <div className="flex-1 space-y-4 overflow-y-auto p-3.5">
            {/* WSDL Import */}
            <SoapWsdlImport />

            {/* Operation Selector */}
            {parsedWsdl && <SoapOperationSelector />}

            {/* Body Editor */}
            {parsedWsdl && <SoapBodyEditor />}

            {/* WS-Security */}
            {parsedWsdl && <SoapSecuritySection />}

            {/* Send Button */}
            {parsedWsdl && (
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
            )}
          </div>
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
