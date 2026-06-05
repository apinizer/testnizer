import { Code2 } from 'lucide-react'
import { useResponseStore } from '../../stores/response.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import StatusBadge from '../shared/StatusBadge'

export default function ResponseMeta() {
  const response = useResponseStore((s) => s.response)
  const setShowCodeGenerator = useUIStore((s) => s.setShowCodeGenerator)
  const { t } = useTranslation()

  if (!response) return null

  const passedTests = response.testResults?.filter((r) => r.passed).length ?? 0
  const totalTests = response.testResults?.length ?? 0
  const allPassed = totalTests > 0 && passedTests === totalTests

  const sizeKB = response.bodySize
    ? (response.bodySize / 1024).toFixed(2)
    : response.body
      ? (new Blob([response.body]).size / 1024).toFixed(2)
      : '0'

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--white)] px-3 py-1">
      {/* Status */}
      {response.status && <StatusBadge status={response.status} statusText={response.statusText} />}

      {/* Timing */}
      <span className="text-[var(--muted)]">
        <span className="font-semibold text-[var(--green)]">{response.timing.total}</span>{' '}
        {t('response.ms')}
      </span>

      {/* Size */}
      <span className="text-[var(--muted)]">
        <span className="font-semibold text-[var(--text)]">{sizeKB}</span> {t('response.kb')}
      </span>

      {/* Test badge */}
      {totalTests > 0 && (
        <span
          className="rounded-full px-2 py-0.5 font-medium"
          style={{
            background: allPassed ? 'var(--green-bg)' : '#fff0f0',
            color: allPassed ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${allPassed ? 'var(--green-border)' : '#f5b3b3'}`,
          }}
        >
          {passedTests}/{totalTests} {t('response.tests')} {allPassed ? '\u2713' : '\u2717'}
        </span>
      )}

      <div className="flex-1" />

      {/* Actions — compact like Postman */}
      <button
        type="button"
        data-testid="response-code-btn"
        onClick={() => setShowCodeGenerator(true)}
        className="flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        style={{ borderColor: 'var(--border)', background: 'transparent' }}
      >
        <Code2 size={11} />
        {t('response.code')}
      </button>
      <button
        type="button"
        className="cursor-pointer rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        style={{ borderColor: 'var(--border)', background: 'transparent' }}
      >
        {'\u2193'} {t('response.save')}
      </button>
      <button
        type="button"
        className="cursor-pointer rounded border px-1.5 py-0.5 text-[var(--muted)] transition-colors hover:text-[var(--accent)]"
        style={{ borderColor: 'var(--border)', background: 'transparent' }}
        onClick={() => {
          if (response.body) {
            navigator.clipboard.writeText(response.body)
          }
        }}
      >
        {t('response.copy')}
      </button>
    </div>
  )
}
