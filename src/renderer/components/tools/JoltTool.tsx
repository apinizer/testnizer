import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { transformJolt, JOLT_EXAMPLES } from '../../lib/tools/jolt'
import { useTranslation } from '../../lib/i18n'

type JoltResult = ReturnType<typeof transformJolt>

const SAMPLE_INPUT = JOLT_EXAMPLES[0].input
const SAMPLE_SPEC = JOLT_EXAMPLES[0].spec

export default function JoltTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState(SAMPLE_INPUT)
  const [spec, setSpec] = useState(SAMPLE_SPEC)
  const [result, setResult] = useState<JoltResult | null>(null)

  const output = result?.ok ? JSON.stringify(result.output, null, 2) : ''

  function handleTransform() {
    setResult(transformJolt(input, spec))
  }

  const toolbar = (
    <>
      <select
        onChange={(e) => {
          const i = Number(e.target.value)
          if (Number.isFinite(i) && i >= 0 && i < JOLT_EXAMPLES.length) {
            const ex = JOLT_EXAMPLES[i]
            setInput(ex.input)
            setSpec(ex.spec)
            setResult(null)
          }
          e.target.value = ''
        }}
        defaultValue=""
        className="rounded border px-2 py-1 text-xs"
        style={{
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          maxWidth: 280,
        }}
      >
        <option value="">{t('tools.common.loadSample')}</option>
        {JOLT_EXAMPLES.map((ex, i) => (
          <option key={i} value={i}>
            {ex.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleTransform}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('tools.common.transform')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.jolt.title')}
      toolbar={toolbar}
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
        !result ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.common.empty')}
          </div>
        ) : result.ok ? (
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
