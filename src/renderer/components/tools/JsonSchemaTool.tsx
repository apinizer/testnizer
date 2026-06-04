import { useMemo, useState } from 'react'
import MonacoWrapper from '../shared/MonacoWrapper'
import ToolShell from './ToolShell'
import { generateJsonSchema } from '../../lib/tools/json-schema'
import { useTranslation } from '../../lib/i18n'

const SAMPLE = JSON.stringify(
  {
    id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
    name: 'Alice',
    email: 'alice@example.com',
    age: 30,
    active: true,
    tags: ['admin', 'editor'],
    profile: {
      website: 'https://alice.example',
      birthday: '1995-04-12',
      lastSeen: '2026-05-09T08:30:00Z',
    },
    addresses: [
      { city: 'Istanbul', country: 'TR' },
      { city: 'Berlin', country: 'DE' },
    ],
  },
  null,
  2,
)

export default function JsonSchemaTool() {
  const { t } = useTranslation()
  const [json, setJson] = useState(SAMPLE)
  const [requiredAll, setRequiredAll] = useState(true)
  const [detectFormats, setDetectFormats] = useState(true)
  const [title, setTitle] = useState('')

  const result = useMemo(
    () => generateJsonSchema(json, { requiredAll, detectFormats, title: title || undefined }),
    [json, requiredAll, detectFormats, title],
  )

  const output = result.ok ? JSON.stringify(result.schema, null, 2) : ''

  const toolbar = (
    <>
      <input
        type="text"
        aria-label={t('tools.jsonSchema.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('tools.jsonSchema.titlePlaceholder')}
        className="rounded border px-2 py-1 text-xs"
        style={{ width: 180, background: 'var(--white)', borderColor: 'var(--border)' }}
      />
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs"
        style={{ color: 'var(--text)' }}
      >
        <input
          type="checkbox"
          checked={requiredAll}
          onChange={(e) => setRequiredAll(e.target.checked)}
        />
        {t('tools.jsonSchema.requiredAll')}
      </label>
      <label
        className="flex cursor-pointer items-center gap-1.5 text-xs"
        style={{ color: 'var(--text)' }}
      >
        <input
          type="checkbox"
          checked={detectFormats}
          onChange={(e) => setDetectFormats(e.target.checked)}
        />
        {t('tools.jsonSchema.detectFormats')}
      </label>
      <button
        onClick={() => setJson(SAMPLE)}
        className="rounded border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted)', background: 'var(--white)' }}
      >
        {t('tools.common.loadSample')}
      </button>
      <button
        onClick={async () => {
          if (!output) return
          try {
            await navigator.clipboard.writeText(output)
          } catch {
            /* ignore */
          }
        }}
        className="rounded px-3 py-1 text-xs font-medium text-white"
        style={{ background: 'var(--accent)' }}
      >
        {t('tools.common.copy')}
      </button>
    </>
  )

  return (
    <ToolShell
      title={t('tools.jsonSchema.title')}
      toolbar={toolbar}
      inputLabel="JSON"
      outputLabel="JSON Schema (draft-07)"
      inputPane={<MonacoWrapper value={json} onChange={setJson} language="json" />}
      outputPane={
        result.ok ? (
          <MonacoWrapper value={output} language="json" readOnly />
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
