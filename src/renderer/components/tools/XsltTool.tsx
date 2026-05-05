import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { transformXslt } from '../../lib/tools/xslt'
import { useTranslation } from '../../lib/i18n'

const SAMPLE_XML = `<?xml version="1.0"?>
<catalog>
  <book><title>Sayings</title><author>Nigel Rees</author></book>
  <book><title>Moby Dick</title><author>Herman Melville</author></book>
</catalog>`

const SAMPLE_XSL = `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html"/>
  <xsl:template match="/">
    <ul>
      <xsl:for-each select="catalog/book">
        <li><xsl:value-of select="title"/> — <xsl:value-of select="author"/></li>
      </xsl:for-each>
    </ul>
  </xsl:template>
</xsl:stylesheet>`

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
    <button
      onClick={handleTransform}
      disabled={busy}
      className="rounded px-3 py-1 text-xs font-medium"
      style={{ background: 'var(--accent)', color: '#fff', opacity: busy ? 0.6 : 1 }}
    >
      {busy ? '…' : t('tools.xslt.transform')}
    </button>
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
