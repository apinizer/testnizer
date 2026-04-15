import { useSoapStore } from '../../stores/soap.store'
import MonacoWrapper from '../shared/MonacoWrapper'

export default function SoapBodyEditor() {
  const bodyMode = useSoapStore((s) => s.bodyMode)
  const setBodyMode = useSoapStore((s) => s.setBodyMode)
  const rawXml = useSoapStore((s) => s.rawXml)
  const setRawXml = useSoapStore((s) => s.setRawXml)
  const formValues = useSoapStore((s) => s.formValues)
  const setFormValue = useSoapStore((s) => s.setFormValue)
  const parsedWsdl = useSoapStore((s) => s.parsedWsdl)

  if (!parsedWsdl) return null

  const formKeys = Object.keys(formValues)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="font-medium uppercase tracking-widest text-[var(--muted)]">
          Request Body
        </label>
        <div className="flex rounded-lg border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setBodyMode('form')}
            className="cursor-pointer px-3 py-1 font-medium transition-colors"
            style={{
              background: bodyMode === 'form' ? 'var(--accent)' : 'transparent',
              color: bodyMode === 'form' ? 'white' : 'var(--muted)',
              border: 'none',
              borderRadius: bodyMode === 'form' ? '7px' : '0',
            }}
          >
            Form
          </button>
          <button
            type="button"
            onClick={() => setBodyMode('raw')}
            className="cursor-pointer px-3 py-1 font-medium transition-colors"
            style={{
              background: bodyMode === 'raw' ? 'var(--accent)' : 'transparent',
              color: bodyMode === 'raw' ? 'white' : 'var(--muted)',
              border: 'none',
              borderRadius: bodyMode === 'raw' ? '7px' : '0',
            }}
          >
            Raw XML
          </button>
        </div>
      </div>

      {bodyMode === 'form' ? (
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {/* Header */}
          <div
            className="grid border-b border-[var(--border)]"
            style={{ gridTemplateColumns: '1fr 1fr', background: 'var(--surface)' }}
          >
            <div className="p-1.5 px-3 font-medium text-[var(--muted)]">Parameter</div>
            <div className="p-1.5 px-3 font-medium text-[var(--muted)]">Value</div>
          </div>
          {/* Rows */}
          {formKeys.map((key, idx) => (
            <div
              key={key}
              className="grid"
              style={{
                gridTemplateColumns: '1fr 1fr',
                borderBottom: idx < formKeys.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div className="flex items-center px-3 py-1.5 font-mono text-[var(--text)]">
                {key}
              </div>
              <input
                value={formValues[key]}
                onChange={(e) => setFormValue(key, e.target.value)}
                className="border-none bg-transparent px-3 py-1.5 font-mono text-[var(--blue)] outline-none"
                placeholder={`Enter ${key}...`}
              />
            </div>
          ))}
          {formKeys.length === 0 && (
            <div className="px-3 py-4 text-center text-[var(--hint)]">
              No input parameters for this operation
            </div>
          )}
        </div>
      ) : (
        <MonacoWrapper
          value={rawXml}
          onChange={setRawXml}
          language="xml"
          height={280}
        />
      )}
    </div>
  )
}
