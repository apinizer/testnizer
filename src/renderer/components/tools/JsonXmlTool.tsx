import { useId, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { jsonToXml, xmlToJson } from '../../lib/tools/json-xml'
import { useTranslation } from '../../lib/i18n'

type Direction = 'json2xml' | 'xml2json'

const SAMPLE_JSON = JSON.stringify(
  {
    Envelope: {
      Body: {
        resultSet: {
          '@_TransactionIdentifier': '12345',
          '@_TimeStamp': '2008-03-18T10:46:53.393',
          authors: { name: ['Mr. Foo', 'Mr. Bar'] },
        },
      },
    },
  },
  null,
  2,
)

const SAMPLE_XML = `<?xml version="1.0"?>
<Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Body xmlns="http://schemas.xmlsoap.org/soap/envelope">
    <resultSet TransactionIdentifier="12345" Target="Test" TimeStamp="2008-03-18T10:46:53.393" Version="6.001">
      <authors>
        <name>Mr. Foo</name>
        <name>Mr. Bar</name>
      </authors>
    </resultSet>
  </Body>
</Envelope>`

export default function JsonXmlTool() {
  const { t } = useTranslation()
  const [direction, setDirection] = useState<Direction>('xml2json')
  const [input, setInput] = useState(SAMPLE_XML)
  const [ignoreNulls, setIgnoreNulls] = useState(false)
  const [ignoreEmpty, setIgnoreEmpty] = useState(false)
  const [numbersAsStrings, setNumbersAsStrings] = useState(false)
  const [treatNilAsNull, setTreatNilAsNull] = useState(false)
  const [unwrapRoot, setUnwrapRoot] = useState(false)
  const [arrayPaths, setArrayPaths] = useState('')
  const [rootName, setRootName] = useState('root')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const rootNameId = useId()
  const arrayPathsId = useId()

  function handleConvert() {
    setError(null)
    if (direction === 'json2xml') {
      const r = jsonToXml(input, { rootName, ignoreNulls, ignoreEmpty: ignoreEmpty })
      if (r.ok) setOutput(r.output)
      else {
        setOutput('')
        setError(r.error)
      }
    } else {
      const paths = arrayPaths
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
      const r = xmlToJson(input, {
        treatNilAsNull,
        numbersAsStrings,
        ignoreEmpty,
        unwrapRoot,
        arrayPaths: paths,
      })
      if (r.ok) setOutput(r.output)
      else {
        setOutput('')
        setError(r.error)
      }
    }
  }

  function handleSwitchDirection(next: Direction) {
    if (next === direction) return
    setDirection(next)
    setInput(next === 'json2xml' ? SAMPLE_JSON : SAMPLE_XML)
    setOutput('')
    setError(null)
  }

  const inputLang = direction === 'json2xml' ? 'json' : 'xml'
  const outputLang = direction === 'json2xml' ? 'xml' : 'json'

  const toolbar = (
    <>
      <div
        className="flex items-center rounded-full p-0.5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <PillBtn
          active={direction === 'xml2json'}
          onClick={() => handleSwitchDirection('xml2json')}
        >
          {t('tools.jsonXml.xmlToJson')}
        </PillBtn>
        <PillBtn
          active={direction === 'json2xml'}
          onClick={() => handleSwitchDirection('json2xml')}
        >
          {t('tools.jsonXml.jsonToXml')}
        </PillBtn>
      </div>
      <button
        onClick={handleConvert}
        className="rounded px-3 py-1 text-xs font-medium text-white"
        style={{ background: 'var(--accent)' }}
      >
        {t('tools.common.transform')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.jsonXml.title')}
      toolbar={toolbar}
      inputLabel={direction === 'json2xml' ? 'JSON' : 'XML'}
      outputLabel={direction === 'json2xml' ? 'XML' : 'JSON'}
      inputPane={
        <div className="flex h-full flex-col">
          <div className="flex-1 min-h-0">
            <MonacoWrapper value={input} onChange={setInput} language={inputLang} />
          </div>
          <div
            className="shrink-0 border-t p-3 text-xs space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {direction === 'json2xml' ? (
              <>
                <div className="flex items-center gap-2">
                  <label htmlFor={rootNameId} style={{ color: 'var(--muted)', minWidth: 90 }}>
                    {t('tools.jsonXml.rootName')}
                  </label>
                  <input
                    id={rootNameId}
                    type="text"
                    value={rootName}
                    onChange={(e) => setRootName(e.target.value)}
                    className="rounded border px-2 py-1"
                    style={{
                      background: 'var(--white)',
                      borderColor: 'var(--border)',
                      width: 160,
                    }}
                  />
                </div>
                <Toggle
                  label={t('tools.jsonXml.ignoreNulls')}
                  checked={ignoreNulls}
                  onChange={setIgnoreNulls}
                />
                <Toggle
                  label={t('tools.jsonXml.ignoreEmpty')}
                  checked={ignoreEmpty}
                  onChange={setIgnoreEmpty}
                />
              </>
            ) : (
              <>
                <Toggle
                  label={t('tools.jsonXml.treatNilAsNull')}
                  checked={treatNilAsNull}
                  onChange={setTreatNilAsNull}
                />
                <Toggle
                  label={t('tools.jsonXml.numbersAsStrings')}
                  checked={numbersAsStrings}
                  onChange={setNumbersAsStrings}
                />
                <Toggle
                  label={t('tools.jsonXml.ignoreEmpty')}
                  checked={ignoreEmpty}
                  onChange={setIgnoreEmpty}
                />
                <Toggle
                  label={t('tools.jsonXml.unwrapRoot')}
                  checked={unwrapRoot}
                  onChange={setUnwrapRoot}
                />
                <div>
                  <label
                    htmlFor={arrayPathsId}
                    className="mb-1 block"
                    style={{ color: 'var(--muted)' }}
                    title={t('tools.jsonXml.arrayPathsHelp')}
                  >
                    {t('tools.jsonXml.arrayPaths')}
                  </label>
                  <input
                    id={arrayPathsId}
                    type="text"
                    value={arrayPaths}
                    onChange={(e) => setArrayPaths(e.target.value)}
                    placeholder="bookstore.book, items.item"
                    className="w-full rounded border px-2 py-1 font-mono"
                    style={{
                      background: 'var(--white)',
                      borderColor: 'var(--border)',
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      }
      outputPane={
        error ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {error}
          </div>
        ) : output === '' ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.common.empty')}
          </div>
        ) : (
          <MonacoWrapper value={output} language={outputLang} readOnly />
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

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2" style={{ color: 'var(--text)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
