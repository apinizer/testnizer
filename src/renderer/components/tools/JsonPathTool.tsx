import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { evaluateJsonPath, JSONPATH_EXAMPLES } from '../../lib/tools/jsonpath'
import { useTranslation } from '../../lib/i18n'

type JsonPathResult = ReturnType<typeof evaluateJsonPath>

const SAMPLE = JSON.stringify(
  {
    store: {
      book: [
        { category: 'reference', author: 'Nigel Rees', title: 'Sayings', price: 8.95 },
        { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
        { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99 },
      ],
      bicycle: { color: 'red', price: 19.95 },
    },
  },
  null,
  2,
)

export default function JsonPathTool() {
  const { t } = useTranslation()
  const [json, setJson] = useState(SAMPLE)
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
          if (e.target.value) {
            setExpr(e.target.value)
            e.target.value = ''
          }
        }}
        defaultValue=""
        className="rounded border px-2 py-1 text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <option value="">{t('tools.jsonpath.examples')}</option>
        {JSONPATH_EXAMPLES.map((ex) => (
          <option key={ex.path} value={ex.path}>
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
