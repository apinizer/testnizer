import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { formatJson, type JsonFormatOptions } from '../../lib/tools/json-format'
import { useTranslation } from '../../lib/i18n'

const SAMPLE =
  '{"name":"Yıldız","age":30,"skills":["TypeScript","React"],"address":{"city":"İstanbul","zip":34000}}'

type IndentOption = '2' | '4' | 'tab'

export default function JsonFormatTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [indent, setIndent] = useState<IndentOption>('2')
  const [sortKeys, setSortKeys] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState('')

  const opts = useMemo<JsonFormatOptions>(
    () => ({ indent: indent === 'tab' ? '\t' : Number(indent), sortKeys }),
    [indent, sortKeys],
  )

  const handleFormat = () => {
    const result = formatJson(input, opts)
    if (result.ok) {
      setOutput(result.output)
      setError(null)
    } else {
      setOutput('')
      setError(result.error)
    }
  }

  const handleMinify = () => {
    const result = formatJson(input, { ...opts, indent: 0 })
    if (result.ok) {
      setOutput(result.output)
      setError(null)
    } else {
      setOutput('')
      setError(result.error)
    }
  }

  const handleClear = () => {
    setInput('')
    setOutput('')
    setError(null)
  }

  const toolbar = (
    <>
      <select
        value={indent}
        onChange={(e) => setIndent(e.target.value as IndentOption)}
        className="rounded border px-2 py-1 text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', color: 'var(--text)' }}
        aria-label={t('tools.json.indent')}
      >
        <option value="2">{t('tools.json.indent2')}</option>
        <option value="4">{t('tools.json.indent4')}</option>
        <option value="tab">{t('tools.json.indentTab')}</option>
      </select>
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs"
        style={{ color: 'var(--text)' }}
      >
        <input type="checkbox" checked={sortKeys} onChange={(e) => setSortKeys(e.target.checked)} />
        {t('tools.json.sortKeys')}
      </label>
      <button
        onClick={handleFormat}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('tools.json.format')}
      </button>
      <button
        onClick={handleMinify}
        className="rounded border px-3 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {t('tools.json.minify')}
      </button>
      <button
        onClick={() => setInput(SAMPLE)}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.loadSample')}
      </button>
      <button
        onClick={handleClear}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        {t('tools.common.clear')}
      </button>
    </>
  )

  const inputBytes = new TextEncoder().encode(input).length
  const outputBytes = new TextEncoder().encode(output).length

  return (
    <ToolShell
      title={t('tools.json.title')}
      toolbar={toolbar}
      inputLabel={t('tools.common.input')}
      outputLabel={t('tools.common.output')}
      inputPane={<MonacoWrapper value={input} onChange={setInput} language="json" />}
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : (
          <MonacoWrapper value={output} language="json" readOnly />
        )
      }
      footer={
        <div className="flex items-center gap-4">
          <span>
            {t('tools.common.input')}: {inputBytes} {t('tools.common.bytes')}
          </span>
          <span>
            {t('tools.common.output')}: {outputBytes} {t('tools.common.bytes')}
          </span>
        </div>
      }
    />
  )
}
