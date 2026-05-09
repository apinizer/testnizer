import { useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { jsonToYaml, yamlToJson } from '../../lib/tools/yaml-json'
import { useTranslation } from '../../lib/i18n'

type Direction = 'yaml2json' | 'json2yaml'

const SAMPLE_YAML = `# Sample OpenAPI snippet
openapi: 3.0.3
info:
  title: Pet store
  version: 1.0.0
paths:
  /pets:
    get:
      summary: List pets
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 10
`

const SAMPLE_JSON = JSON.stringify(
  {
    openapi: '3.0.3',
    info: { title: 'Pet store', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          summary: 'List pets',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
        },
      },
    },
  },
  null,
  2,
)

export default function YamlJsonTool() {
  const { t } = useTranslation()
  const [direction, setDirection] = useState<Direction>('yaml2json')
  const [input, setInput] = useState(SAMPLE_YAML)
  const [indent, setIndent] = useState(2)
  const [sortKeys, setSortKeys] = useState(false)

  const result =
    direction === 'yaml2json'
      ? yamlToJson(input, { indent, sortKeys })
      : jsonToYaml(input, { indent, sortKeys })

  function switchDirection(next: Direction): void {
    if (next === direction) return
    setDirection(next)
    setInput(next === 'yaml2json' ? SAMPLE_YAML : SAMPLE_JSON)
  }

  const inputLang = direction === 'yaml2json' ? 'yaml' : 'json'
  const outputLang = direction === 'yaml2json' ? 'json' : 'yaml'

  return (
    <ToolShell
      title={t('tools.yamlJson.title')}
      toolbar={
        <>
          <div
            className="flex items-center rounded-full p-0.5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <PillBtn
              active={direction === 'yaml2json'}
              onClick={() => switchDirection('yaml2json')}
            >
              {t('tools.yamlJson.yamlToJson')}
            </PillBtn>
            <PillBtn
              active={direction === 'json2yaml'}
              onClick={() => switchDirection('json2yaml')}
            >
              {t('tools.yamlJson.jsonToYaml')}
            </PillBtn>
          </div>
          <select
            value={indent}
            onChange={(e) => setIndent(Number(e.target.value))}
            className="rounded border px-2 py-1 text-xs"
            style={{
              background: 'var(--white)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <option value={2}>2 spaces</option>
            <option value={4}>4 spaces</option>
          </select>
          <label
            className="flex cursor-pointer items-center gap-1.5 text-xs"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="checkbox"
              checked={sortKeys}
              onChange={(e) => setSortKeys(e.target.checked)}
            />
            {t('tools.json.sortKeys')}
          </label>
        </>
      }
      inputLabel={direction === 'yaml2json' ? 'YAML' : 'JSON'}
      outputLabel={direction === 'yaml2json' ? 'JSON' : 'YAML'}
      inputPane={<MonacoWrapper value={input} onChange={setInput} language={inputLang} />}
      outputPane={
        result.ok ? (
          <MonacoWrapper value={result.output} language={outputLang} readOnly />
        ) : (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {result.error}
          </div>
        )
      }
    />
  )
}

function PillBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        background: active ? 'var(--white)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--muted)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
      }}
    >
      {children}
    </button>
  )
}
