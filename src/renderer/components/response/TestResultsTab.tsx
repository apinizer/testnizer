import { useResponseStore } from '../../stores/response.store'
import { Check, X } from 'lucide-react'

/**
 * Postman-style Test Results tab — each assertion rendered as a ✓ / ✗ row.
 */
export default function TestResultsTab() {
  const response = useResponseStore((s) => s.response)
  const results = response?.testResults || []

  if (results.length === 0) {
    return (
      <div className="p-4 text-center text-[13px]" style={{ color: 'var(--hint)' }}>
        No tests were run for this request.
      </div>
    )
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed

  return (
    <div className="h-full overflow-auto">
      {/* Summary strip */}
      <div
        className="flex items-center gap-3 px-4 py-2 text-[12px]"
        style={{
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--muted)',
        }}
      >
        <span>
          <span className="font-semibold" style={{ color: 'var(--green)' }}>{passed}</span> passed
        </span>
        {failed > 0 && (
          <span>
            <span className="font-semibold" style={{ color: 'var(--red)' }}>{failed}</span> failed
          </span>
        )}
        <span>
          of <span className="font-semibold" style={{ color: 'var(--text)' }}>{results.length}</span> total
        </span>
      </div>

      {/* Rows */}
      <div>
        {results.map((r, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 px-4 py-2 text-[13px]"
            style={{ borderBottom: '1px solid var(--border-split)' }}
          >
            <span
              className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
              style={{
                background: r.passed ? 'var(--green-bg)' : 'rgba(239,68,68,0.16)',
                color: r.passed ? 'var(--green)' : 'var(--red)',
              }}
            >
              {r.passed ? <Check size={10} /> : <X size={10} />}
            </span>
            <div className="flex-1">
              <div style={{ color: 'var(--text)' }}>{r.assertion.name}</div>
              {!r.passed && r.error && (
                <div className="mt-0.5 font-mono text-[12px]" style={{ color: 'var(--red)' }}>
                  {r.error}
                </div>
              )}
              {r.actual != null && (
                <div className="mt-0.5 font-mono text-[12px]" style={{ color: 'var(--muted)' }}>
                  actual: {String(r.actual)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
