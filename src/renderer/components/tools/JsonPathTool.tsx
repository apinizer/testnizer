import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { evaluateJsonPath, JSONPATH_EXAMPLES, JSONPATH_SAMPLE_DOC } from '../../lib/tools/jsonpath'
import { useTranslation } from '../../lib/i18n'

type JsonPathResult = ReturnType<typeof evaluateJsonPath>

export default function JsonPathTool() {
  const { t } = useTranslation()
  const [json, setJson] = useState(JSONPATH_SAMPLE_DOC)
  const [expr, setExpr] = useState('$..author')
  const [result, setResult] = useState<JsonPathResult | null>(null)

  const output = result?.ok ? JSON.stringify(result.matches, null, 2) : ''
  const matchCount = result?.ok ? result.matches.length : 0

  function handleEvaluate() {
    setResult(evaluateJsonPath(json, expr))
  }

  const toolbar = (
    <>
      <input
        type="text"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleEvaluate()}
        placeholder="$.store.book[*].author"
        className="rounded border px-2 py-1 font-mono text-xs"
        style={{
          width: 280,
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
        aria-label={t('tools.jsonpath.expression')}
      />
      <select
        onChange={(e) => {
          const i = Number(e.target.value)
          if (Number.isFinite(i) && i >= 0 && i < JSONPATH_EXAMPLES.length) {
            const ex = JSONPATH_EXAMPLES[i]
            setExpr(ex.path)
            if (ex.json) setJson(ex.json)
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
        <option value="">{t('tools.jsonpath.examples')}</option>
        {JSONPATH_EXAMPLES.map((ex, i) => (
          <option key={i} value={i}>
            {ex.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleEvaluate}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('tools.common.evaluate')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.jsonpath.title')}
      toolbar={toolbar}
      inputLabel="JSON"
      outputLabel={t('tools.common.output')}
      inputPane={<MonacoWrapper value={json} onChange={setJson} language="json" />}
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
      footer={
        result?.ok ? (
          <span>
            {matchCount} {t('tools.jsonpath.matches')}
          </span>
        ) : null
      }
    />
  )
}
