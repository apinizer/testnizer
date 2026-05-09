import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { transformXslt, XSLT_EXAMPLES } from '../../lib/tools/xslt'
import { useTranslation } from '../../lib/i18n'

const SAMPLE_XML = XSLT_EXAMPLES[0].xml
const SAMPLE_XSL = XSLT_EXAMPLES[0].xsl

export default function XsltTool() {
  const { t } = useTranslation()
  const [xml, setXml] = useState(SAMPLE_XML)
  const [xsl, setXsl] = useState(SAMPLE_XSL)
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleTransform = async () => {
    setBusy(true)
    const r = await transformXslt(xml, xsl)
    setBusy(false)
    if (r.ok) {
      setOutput(r.output)
      setError(null)
    } else {
      setOutput('')
      setError(r.error)
    }
  }

  const toolbar = (
    <>
      <select
        onChange={(e) => {
          const i = Number(e.target.value)
          if (Number.isFinite(i) && i >= 0 && i < XSLT_EXAMPLES.length) {
            const ex = XSLT_EXAMPLES[i]
            setXml(ex.xml)
            setXsl(ex.xsl)
            setOutput('')
            setError(null)
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
        {XSLT_EXAMPLES.map((ex, i) => (
          <option key={i} value={i}>
            {ex.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleTransform}
        disabled={busy}
        className="rounded px-3 py-1 text-xs font-medium"
        style={{ background: 'var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}
      >
        {busy ? '…' : t('tools.xslt.transform')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.xslt.title')}
      toolbar={toolbar}
      inputLabel={t('tools.xslt.xml')}
      outputLabel={t('tools.common.output')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={xml} onChange={setXml} language="xml" />
          </div>
          <div
            className="shrink-0 px-3 py-1 text-[11px] uppercase border-t"
            style={{
              color: 'var(--muted)',
              background: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {t('tools.xslt.stylesheet')}
          </div>
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={xsl} onChange={setXsl} language="xml" />
          </div>
        </div>
      }
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
