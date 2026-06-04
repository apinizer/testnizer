import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { evaluateXPath, XPATH_EXAMPLES, XPATH_SAMPLE_DOC } from '../../lib/tools/xpath'
import { useTranslation } from '../../lib/i18n'

type XPathResult = ReturnType<typeof evaluateXPath>

const SAMPLE = XPATH_SAMPLE_DOC

interface NsRow {
  id: string
  prefix: string
  uri: string
}

export default function XPathTool() {
  const { t } = useTranslation()
  const [xml, setXml] = useState(SAMPLE)
  const [expr, setExpr] = useState('//title')
  const [namespaces, setNamespaces] = useState<NsRow[]>([])
  const [result, setResult] = useState<XPathResult | null>(null)

  const nsMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const n of namespaces) if (n.prefix && n.uri) m[n.prefix] = n.uri
    return m
  }, [namespaces])

  function handleEvaluate() {
    setResult(evaluateXPath(xml, expr, nsMap))
  }

  const output = (() => {
    if (!result || !result.ok) return ''
    if (result.kind === 'nodes') return result.values.join('\n\n')
    return String(result.value)
  })()

  const toolbar = (
    <>
      <input
        type="text"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleEvaluate()}
        placeholder="//book/title"
        className="rounded border px-2 py-1 font-mono text-xs"
        style={{
          width: 280,
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      />
      <select
        onChange={(e) => {
          const i = Number(e.target.value)
          if (Number.isFinite(i) && i >= 0 && i < XPATH_EXAMPLES.length) {
            const ex = XPATH_EXAMPLES[i]
            setExpr(ex.expression)
            if (ex.xml) setXml(ex.xml)
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
        {XPATH_EXAMPLES.map((ex, i) => (
          <option key={i} value={i}>
            {ex.label}
          </option>
        ))}
      </select>
      <button
        onClick={() =>
          setNamespaces((arr) => [...arr, { id: `ns-${Date.now()}`, prefix: '', uri: '' }])
        }
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        + {t('tools.xpath.namespaces')}
      </button>
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
      title={t('tools.xpath.title')}
      toolbar={toolbar}
      inputLabel="XML"
      outputLabel={t('tools.common.output')}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={xml} onChange={setXml} language="xml" />
          </div>
          {namespaces.length > 0 && (
            <div
              className="shrink-0 border-t p-2 space-y-1.5"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div className="text-[11px] uppercase" style={{ color: 'var(--muted)' }}>
                {t('tools.xpath.namespaces')}
              </div>
              {namespaces.map((n, i) => (
                <div key={n.id} className="flex gap-1.5">
                  <input
                    type="text"
                    value={n.prefix}
                    onChange={(e) =>
                      setNamespaces((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, prefix: e.target.value } : x)),
                      )
                    }
                    placeholder={t('tools.xpath.namespacePrefix')}
                    className="rounded border px-2 py-1 text-xs"
                    style={{ width: 100, background: 'var(--white)', borderColor: 'var(--border)' }}
                  />
                  <input
                    type="text"
                    value={n.uri}
                    onChange={(e) =>
                      setNamespaces((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, uri: e.target.value } : x)),
                      )
                    }
                    placeholder={t('tools.xpath.namespaceUri')}
                    className="flex-1 rounded border px-2 py-1 text-xs"
                    style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                  />
                  <button
                    onClick={() => setNamespaces((arr) => arr.filter((_, j) => j !== i))}
                    className="px-2 text-xs"
                    style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      outputPane={
        !result ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.common.empty')}
          </div>
        ) : result.ok ? (
          <MonacoWrapper value={output} language="xml" readOnly />
        ) : (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {result.error}
          </div>
        )
      }
      footer={
        result?.ok && result.kind === 'nodes' ? (
          <span>
            {result.count} {t('tools.jsonpath.matches')}
          </span>
        ) : null
      }
    />
  )
}
