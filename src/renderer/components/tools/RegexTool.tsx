import { useMemo, useState } from 'react'
import ToolShell from './ToolShell'
import { REGEX_FLAGS, REGEX_PRESETS, runRegex, type RegexFlag } from '../../lib/tools/regex'
import { useTranslation } from '../../lib/i18n'

const FLAG_DESCRIPTIONS: Record<RegexFlag, string> = {
  g: 'global — find all matches',
  i: 'case-insensitive',
  m: 'multiline — ^/$ match per line',
  s: 'dotAll — . matches newlines',
  u: 'unicode — full Unicode support',
  y: 'sticky — match from lastIndex',
}

const DEFAULT_INPUT = `Sample input text:
Contact us at help@example.com or sales@example.org
Visit https://testnizer.example/docs or http://localhost:8080/health
Server IPs: 192.168.1.10, 10.0.0.1
Trace ID: 550e8400-e29b-41d4-a716-446655440000
Date: 2026-05-09T22:00:00Z`

export default function RegexTool() {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState('[\\w.+-]+@[\\w-]+\\.[\\w.-]+')
  const [flags, setFlags] = useState<Set<RegexFlag>>(new Set<RegexFlag>(['g']))
  const [input, setInput] = useState(DEFAULT_INPUT)
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)

  const flagsString = useMemo(() => Array.from(flags).join(''), [flags])

  const result = useMemo(
    () =>
      runRegex({
        pattern,
        flags: flagsString,
        input,
        replacement: showReplace ? replacement : undefined,
      }),
    [pattern, flagsString, input, replacement, showReplace],
  )

  function toggleFlag(f: RegexFlag): void {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  return (
    <ToolShell
      title={t('tools.regex.title')}
      toolbar={
        <select
          onChange={(e) => {
            const idx = Number(e.target.value)
            if (Number.isFinite(idx) && idx >= 0 && idx < REGEX_PRESETS.length) {
              const preset = REGEX_PRESETS[idx]
              setPattern(preset.pattern)
              setFlags(new Set(preset.flags.split('') as RegexFlag[]))
            }
            e.target.value = ''
          }}
          defaultValue=""
          className="rounded border px-2 py-1 text-xs"
          style={{
            background: 'var(--white)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
            maxWidth: 200,
          }}
        >
          <option value="">{t('tools.regex.preset')}</option>
          {REGEX_PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      }
      inputPane={
        <div className="flex h-full flex-col overflow-auto p-4 space-y-3">
          <div>
            <label
              className="mb-1 block text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.regex.pattern')}
            </label>
            <div className="flex items-stretch gap-1">
              <span
                className="flex items-center px-2 font-mono text-sm"
                style={{ color: 'var(--muted)' }}
              >
                /
              </span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="flex-1 rounded border px-2 py-1 font-mono text-sm"
                style={{
                  background: 'var(--white)',
                  borderColor: !result.ok ? '#cc2200' : 'var(--border)',
                  color: 'var(--text)',
                }}
              />
              <span
                className="flex items-center px-2 font-mono text-sm"
                style={{ color: 'var(--muted)' }}
              >
                /{flagsString}
              </span>
            </div>
            {!result.ok && (
              <div className="mt-1 text-xs" style={{ color: '#cc2200' }}>
                {result.error}
              </div>
            )}
          </div>

          <div>
            <label
              className="mb-1 block text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.regex.flags')}
            </label>
            <div className="flex flex-wrap gap-1">
              {REGEX_FLAGS.map((f) => {
                const active = flags.has(f)
                return (
                  <button
                    key={f}
                    onClick={() => toggleFlag(f)}
                    title={FLAG_DESCRIPTIONS[f]}
                    className="rounded px-2 py-1 text-xs font-mono font-semibold"
                    style={{
                      background: active ? 'var(--accentLight)' : 'var(--white)',
                      color: active ? 'var(--accentText)' : 'var(--muted)',
                      border: '1px solid',
                      borderColor: active ? 'var(--accentText)' : 'var(--border)',
                    }}
                  >
                    {f}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label
              className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide"
              style={{ color: 'var(--muted)' }}
            >
              {t('tools.regex.input')}
              <span style={{ textTransform: 'none' }}>
                {result.ok ? `${result.matches.length} ${t('tools.regex.matches')}` : ''}
              </span>
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={10}
              className="w-full rounded border px-2 py-1 font-mono text-xs"
              style={{
                background: 'var(--white)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
          </div>

          <div>
            <label
              className="mb-1 flex items-center gap-2 text-xs cursor-pointer"
              style={{ color: 'var(--text)' }}
            >
              <input
                type="checkbox"
                checked={showReplace}
                onChange={(e) => setShowReplace(e.target.checked)}
              />
              {t('tools.regex.replaceMode')}
            </label>
            {showReplace && (
              <input
                type="text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                placeholder="$1 [redacted]"
                className="w-full rounded border px-2 py-1 font-mono text-xs"
                style={{
                  background: 'var(--white)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              />
            )}
          </div>
        </div>
      }
      outputPane={
        !result.ok ? (
          <div className="p-3 text-sm" style={{ color: '#cc2200' }}>
            <strong>{t('tools.common.error')}: </strong>
            {result.error}
          </div>
        ) : (
          <div className="flex h-full flex-col overflow-auto">
            {showReplace && result.replaced !== null && (
              <div className="border-b" style={{ borderColor: 'var(--border)' }}>
                <div
                  className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--muted)',
                  }}
                >
                  {t('tools.regex.replacedOutput')}
                </div>
                <pre
                  className="m-0 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all"
                  style={{ background: 'var(--white)', color: 'var(--text)' }}
                >
                  {result.replaced}
                </pre>
              </div>
            )}

            <div
              className="border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--muted)',
              }}
            >
              {t('tools.regex.highlighted')}
            </div>
            <pre
              className="m-0 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all"
              style={{ background: 'var(--white)', color: 'var(--text)' }}
            >
              <Highlighted input={input} matches={result.matches} />
            </pre>

            {result.matches.length > 0 && (
              <div>
                <div
                  className="border-b border-t px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--muted)',
                  }}
                >
                  {t('tools.regex.matchTable')}
                </div>
                <table className="w-full text-xs">
                  <thead style={{ background: 'var(--surface)' }}>
                    <tr>
                      <th
                        className="border-b px-2 py-1 text-left"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        #
                      </th>
                      <th
                        className="border-b px-2 py-1 text-left"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {t('tools.regex.match')}
                      </th>
                      <th
                        className="border-b px-2 py-1 text-right"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {t('tools.regex.range')}
                      </th>
                      <th
                        className="border-b px-2 py-1 text-left"
                        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                      >
                        {t('tools.regex.groups')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.matches.map((m, i) => (
                      <tr key={i}>
                        <td
                          className="border-b px-2 py-1 align-top"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                        >
                          {i + 1}
                        </td>
                        <td
                          className="border-b px-2 py-1 align-top font-mono break-all"
                          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                        >
                          {m.match}
                        </td>
                        <td
                          className="border-b px-2 py-1 align-top text-right tabular-nums"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                        >
                          {m.index}–{m.end}
                        </td>
                        <td
                          className="border-b px-2 py-1 align-top font-mono break-all"
                          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                        >
                          {m.groups.length === 0 ? (
                            <span style={{ color: 'var(--muted)' }}>—</span>
                          ) : (
                            m.groups.map((g, j) => (
                              <div key={j}>
                                <span style={{ color: 'var(--accentText)' }}>
                                  {g.name ?? `$${j + 1}`}:{' '}
                                </span>
                                {g.value ?? <em style={{ color: 'var(--muted)' }}>(undefined)</em>}
                              </div>
                            ))
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      }
    />
  )
}

/** Render the input with each match wrapped in a highlight span. */
function Highlighted({
  input,
  matches,
}: {
  input: string
  matches: { match: string; index: number; end: number }[]
}) {
  if (matches.length === 0) return <>{input}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((m, i) => {
    if (m.index > cursor) parts.push(input.slice(cursor, m.index))
    parts.push(
      <mark
        key={i}
        style={{
          background: '#fff4e0',
          color: '#b35a00',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {input.slice(m.index, m.end)}
      </mark>,
    )
    cursor = m.end
  })
  if (cursor < input.length) parts.push(input.slice(cursor))
  return <>{parts}</>
}
