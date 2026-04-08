import { Download, Loader2 } from 'lucide-react'
import { useSoapStore } from '../../stores/soap.store'

export default function SoapWsdlImport() {
  const wsdlUrl = useSoapStore((s) => s.wsdlUrl)
  const setWsdlUrl = useSoapStore((s) => s.setWsdlUrl)
  const parseWsdl = useSoapStore((s) => s.parseWsdl)
  const isLoading = useSoapStore((s) => s.isLoading)
  const parseError = useSoapStore((s) => s.parseError)

  return (
    <div className="space-y-2">
      <label className="text-[0.875rem] font-medium uppercase tracking-widest text-[var(--muted)]">
        WSDL URL
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          value={wsdlUrl}
          onChange={(e) => setWsdlUrl(e.target.value)}
          placeholder="https://example.com/service?wsdl"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none transition-colors placeholder:text-[var(--hint)] focus:border-[var(--accent)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') parseWsdl()
          }}
        />
        <button
          type="button"
          onClick={parseWsdl}
          disabled={isLoading || !wsdlUrl.trim()}
          className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: 'var(--accent)', border: 'none' }}
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {isLoading ? 'Parsing...' : 'Import WSDL'}
        </button>
      </div>
      {parseError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {parseError}
        </div>
      )}
    </div>
  )
}
