import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { transformJolt } from '../../lib/tools/jolt'
import { useTranslation } from '../../lib/i18n'

const SAMPLE_INPUT = JSON.stringify(
  { user: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' } },
  null,
  2,
)

const SAMPLE_SPEC = JSON.stringify(
  [
    {
      operation: 'shift',
      spec: { user: { firstName: 'profile.name', email: 'profile.contact' } },
    },
    { operation: 'default', spec: { profile: { active: true } } },
  ],
  null,
  2,
)

export default function JoltTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState(SAMPLE_INPUT)
  const [spec, setSpec] = useState(SAMPLE_SPEC)

  const result = useMemo(() => transformJolt(input, spec), [input, spec])
  const output = result.ok ? JSON.stringify(result.output, null, 2) : ''

  return (
    <ToolShell
      title={t('tools.jolt.title')}
      inputLabel={t('tools.jolt.input')}
      outputLabel={t('tools.common.output')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={input} onChange={setInput} language="json" />
          </div>
          <div
            className="shrink-0 px-3 py-1 text-[11px] uppercase border-t"
            style={{
              color: 'var(--muted)',
              background: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {t('tools.jolt.spec')}
          </div>
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={spec} onChange={setSpec} language="json" />
          </div>
        </div>
      }
      outputPane={
        result.ok ? (
          <MonacoWrapper value={output} language="json" readOnly />
        ) : (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {result.error}
          </div>
        )
      }
    />
  )
}
