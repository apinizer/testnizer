import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { formatXml } from '../../lib/tools/xml-format'
import { useTranslation } from '../../lib/i18n'
import { useInvalidateOn } from '../../lib/use-stale-guard'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetStockPrice><Symbol>AAPL</Symbol></GetStockPrice></soap:Body></soap:Envelope>`

type IndentOption = '2' | '4' | 'tab'

export default function XmlFormatTool() {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [indent, setIndent] = useState<IndentOption>('2')
  const [sortAttributes, setSortAttributes] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState('')

  /*
   * The result belongs to the input that produced it. Leaving it on screen after
   * an edit shows an answer about text that is no longer there — and unlike a
   * generated password there is nothing to lose by dropping it, since pressing
   * the button again re-derives it from what the user can still see.
   */
  useInvalidateOn([input, indent, sortAttributes], () => {
    setOutput('')
  })

  const handleFormat = () => {
    const result = formatXml(input, {
      indent: indent === 'tab' ? '\t' : Number(indent),
      sortAttributes,
    })
    if (result.ok) {
      setOutput(result.output)
      setError(null)
    } else {
      setOutput('')
      setError(result.error)
    }
  }

  const handleMinify = () => {
    const result = formatXml(input, { indent: 0, sortAttributes })
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
      {/* Named after the control, not after one of its values: `indent2` is the
          "2 spaces" OPTION, so this select announced "2 spaces, combo box,
          2 spaces". `JsonFormatTool`'s identical select already used this key. */}
      <select
        value={indent}
        aria-label={t('tools.json.indent')}
        onChange={(e) => setIndent(e.target.value as IndentOption)}
        className="rounded border px-2 py-1 text-xs"
        style={{ background: 'var(--white)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        <option value="2">{t('tools.json.indent2')}</option>
        <option value="4">{t('tools.json.indent4')}</option>
        <option value="tab">{t('tools.json.indentTab')}</option>
      </select>
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs"
        style={{ color: 'var(--text)' }}
      >
        <input
          type="checkbox"
          checked={sortAttributes}
          onChange={(e) => setSortAttributes(e.target.checked)}
        />
        {t('tools.xml.sortAttributes')}
      </label>
      <button
        onClick={handleFormat}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        {t('tools.xml.format')}
      </button>
      <button
        onClick={handleMinify}
        className="rounded border px-3 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {t('tools.xml.minify')}
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

  return (
    <ToolShell
      title={t('tools.xml.title')}
      toolbar={toolbar}
      inputLabel={t('tools.common.input')}
      outputLabel={t('tools.common.output')}
      inputPane={<MonacoWrapper value={input} onChange={setInput} language="xml" />}
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : (
          <MonacoWrapper value={output} language="xml" readOnly />
        )
      }
    />
  )
}
