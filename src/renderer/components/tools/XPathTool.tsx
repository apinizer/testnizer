import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { evaluateXPath } from '../../lib/tools/xpath'
import { useTranslation } from '../../lib/i18n'

const SAMPLE = `<?xml version="1.0"?>
<library>
  <book id="1">
    <title>Sayings</title>
    <author>Nigel Rees</author>
  </book>
  <book id="2">
    <title>Moby Dick</title>
    <author>Herman Melville</author>
  </book>
</library>`

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

  const nsMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const n of namespaces) if (n.prefix && n.uri) m[n.prefix] = n.uri
    return m
  }, [namespaces])

  const result = useMemo(() => evaluateXPath(xml, expr, nsMap), [xml, expr, nsMap])

  const output = (() => {
    if (!result.ok) return ''
    if (result.kind === 'nodes') return result.values.join('\n\n')
    return String(result.value)
  })()

  const toolbar = (
    <>
      <input
        type="text"
        value={expr}
        onChange={(e) => setExpr(e.target.value)}
        placeholder="//book/title"
        className="rounded border px-2 py-1 font-mono text-xs"
        style={{
          width: 280,
          background: 'var(--white)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      />
      <button
        onClick={() =>
          setNamespaces((arr) => [...arr, { id: `ns-${Date.now()}`, prefix: '', uri: '' }])
        }
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
      >
        + {t('tools.xpath.namespaces')}
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
        result.ok ? (
          <MonacoWrapper value={output} language="xml" readOnly />
        ) : (
          <div className="p-3 text-sm" style={{ color: 'var(--red, #cc2200)' }}>
            <strong>{t('tools.common.error')}: </strong>
            {result.error}
          </div>
        )
      }
      footer={
        result.ok && result.kind === 'nodes' ? (
          <span>
            {result.count} {t('tools.jsonpath.matches')}
          </span>
        ) : null
      }
    />
  )
}
