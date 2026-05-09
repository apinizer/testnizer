import { useMemo, useState } from 'react'
import ToolShell from './ToolShell'
import {
  detectVersion,
  generateUuids,
  isValidUuid,
  UUID_NAMESPACES,
  UUID_VERSIONS,
  type UuidVersion,
  type UuidGenerateOptions,
} from '../../lib/tools/uuid'
import { useTranslation } from '../../lib/i18n'

const FORMATS: NonNullable<UuidGenerateOptions['format']>[] = [
  'lower',
  'upper',
  'noDashes',
  'urn',
  'braces',
]

export default function UuidTool() {
  const { t } = useTranslation()
  const [version, setVersion] = useState<UuidVersion>('v4')
  const [format, setFormat] = useState<NonNullable<UuidGenerateOptions['format']>>('lower')
  const [count, setCount] = useState(5)
  const [namespace, setNamespace] = useState<string>(UUID_NAMESPACES.DNS)
  const [name, setName] = useState('example.com')
  const [output, setOutput] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // Validator pane state
  const [validatorInput, setValidatorInput] = useState('')

  function handleGenerate(): void {
    const r = generateUuids(version, {
      count,
      format,
      namespace,
      name,
    })
    if (r.ok) {
      setOutput(r.uuids)
      setError(null)
    } else {
      setError(r.error)
      setOutput([])
    }
  }

  async function copyAll(): Promise<void> {
    if (output.length === 0) return
    try {
      await navigator.clipboard.writeText(output.join('\n'))
    } catch {
      /* ignore */
    }
  }

  const validation = useMemo(() => {
    const trimmed = validatorInput.trim()
    if (!trimmed) return null
    const ok = isValidUuid(trimmed)
    return { ok, version: ok ? detectVersion(trimmed) : null }
  }, [validatorInput])

  return (
    <ToolShell
      title={t('tools.uuid.title')}
      toolbar={
        <button
          onClick={handleGenerate}
          className="rounded px-3 py-1 text-xs font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          {t('tools.uuid.generate')}
        </button>
      }
      inputPane={
        <div className="flex h-full flex-col overflow-auto p-4 space-y-3">
          <div>
            <label
              className="mb-1 block text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.uuid.version')}
            </label>
            <div className="flex gap-1">
              {UUID_VERSIONS.map((v) => (
                <button
                  key={v}
                  onClick={() => setVersion(v)}
                  className="rounded px-3 py-1 text-xs font-semibold"
                  style={{
                    background: version === v ? 'var(--accentLight)' : 'var(--white)',
                    color: version === v ? 'var(--accentText)' : 'var(--muted)',
                    border: '1px solid',
                    borderColor: version === v ? 'var(--accentText)' : 'var(--border)',
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
              {versionHint(version, t)}
            </div>
          </div>

          {version === 'v5' && (
            <>
              <div>
                <label
                  className="mb-1 block text-[11px] uppercase tracking-wide"
                  style={{ color: 'var(--muted)' }}
                >
                  {t('tools.uuid.namespace')}
                </label>
                <select
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  className="w-full rounded border px-2 py-1 text-xs font-mono"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                >
                  {(Object.keys(UUID_NAMESPACES) as (keyof typeof UUID_NAMESPACES)[]).map((k) => (
                    <option key={k} value={UUID_NAMESPACES[k]}>
                      {k} — {UUID_NAMESPACES[k]}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  placeholder="custom namespace UUID"
                  className="mt-1 w-full rounded border px-2 py-1 text-xs font-mono"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                />
              </div>
              <div>
                <label
                  className="mb-1 block text-[11px] uppercase tracking-wide"
                  style={{ color: 'var(--muted)' }}
                >
                  {t('tools.uuid.name')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="example.com"
                  className="w-full rounded border px-2 py-1 text-sm"
                  style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="mb-1 block text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
              >
                {t('tools.uuid.count')}
              </label>
              <input
                type="number"
                min={1}
                max={1000}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                className="w-full rounded border px-2 py-1 text-sm"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              />
            </div>
            <div>
              <label
                className="mb-1 block text-[11px] uppercase tracking-wide"
                style={{ color: 'var(--muted)' }}
              >
                {t('tools.uuid.format')}
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
                className="w-full rounded border px-2 py-1 text-sm"
                style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
              >
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--border)' }} />

          <div>
            <label
              className="mb-1 block text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.uuid.validate')}
            </label>
            <input
              type="text"
              value={validatorInput}
              onChange={(e) => setValidatorInput(e.target.value)}
              placeholder="paste a UUID to inspect"
              className="w-full rounded border px-2 py-1 text-xs font-mono"
              style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
            />
            {validation && (
              <div
                className="mt-1 text-xs"
                style={{ color: validation.ok ? '#1a7a4a' : '#cc2200' }}
              >
                {validation.ok
                  ? `✓ ${t('tools.uuid.validUuid')} (v${validation.version})`
                  : `✗ ${t('tools.uuid.invalidUuid')}`}
              </div>
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
        ) : output.length === 0 ? (
          <div className="p-3 text-sm" style={{ color: 'var(--muted)' }}>
            {t('tools.uuid.hint')}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div
              className="shrink-0 flex items-center justify-between border-b px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <span style={{ color: 'var(--muted)' }}>
                {output.length} {t('tools.uuid.generated')}
              </span>
              <button
                onClick={copyAll}
                className="rounded border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  color: 'var(--muted)',
                }}
              >
                ⧉ {t('tools.common.copy')}
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3 font-mono text-xs">
              {output.map((u, i) => (
                <div
                  key={i}
                  className="cursor-pointer rounded px-2 py-0.5 hover:bg-[var(--surface)]"
                  onClick={() => navigator.clipboard.writeText(u).catch(() => {})}
                  title={t('tools.common.copy')}
                  style={{ color: 'var(--text)' }}
                >
                  {u}
                </div>
              ))}
            </div>
          </div>
        )
      }
    />
  )
}

function versionHint(v: UuidVersion, t: (k: string) => string): string {
  switch (v) {
    case 'v1':
      return t('tools.uuid.hintV1')
    case 'v4':
      return t('tools.uuid.hintV4')
    case 'v5':
      return t('tools.uuid.hintV5')
    case 'v7':
      return t('tools.uuid.hintV7')
  }
}
