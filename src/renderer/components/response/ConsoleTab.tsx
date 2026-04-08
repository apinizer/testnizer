import { useResponseStore } from '../../stores/response.store'

export default function ConsoleTab() {
  const response = useResponseStore((s) => s.response)
  const logs = response?.consoleLogs || []
  const testResults = response?.testResults || []

  const hasContent = logs.length > 0 || testResults.length > 0

  if (!hasContent) {
    return (
      <div className="p-4 text-center text-sm text-[var(--hint)]">No console output.</div>
    )
  }

  return (
    <div className="p-3.5 font-mono text-sm leading-[1.8]">
      {/* Test results */}
      {testResults.map((result, idx) => (
        <div
          key={`test-${idx}`}
          style={{ color: result.passed ? 'var(--green)' : 'var(--red)' }}
        >
          {result.passed ? '\u2713' : '\u2717'} {result.assertion.name}
        </div>
      ))}

      {/* Console logs */}
      {logs.map((log, idx) => {
        const colorMap: Record<string, string> = {
          log: 'var(--green)',
          warn: 'var(--orange)',
          error: 'var(--red)',
        }
        const prefixMap: Record<string, string> = {
          log: '\u2713',
          warn: '\u26A0',
          error: '\u2717',
        }
        return (
          <div key={`log-${idx}`} style={{ color: colorMap[log.level] || 'var(--text)' }}>
            {prefixMap[log.level] || ''} {log.message}
          </div>
        )
      })}
    </div>
  )
}
