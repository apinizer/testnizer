import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import ToolShell from './ToolShell'
import {
  generatePasswords,
  availablePoolSize,
  DEFAULT_CHARACTER_OPTIONS,
  DEFAULT_PASSPHRASE_OPTIONS,
  PASSWORD_LENGTH_MIN,
  PASSWORD_LENGTH_MAX,
  PASSPHRASE_WORDS_MIN,
  PASSPHRASE_WORDS_MAX,
  COUNT_MIN,
  COUNT_MAX,
  type PasswordMode,
  type CharacterOptions,
  type PassphraseOptions,
  type StrengthLevel,
  type WordCase,
} from '../../lib/tools/password-generator'
import { useTranslation } from '../../lib/i18n'

const STRENGTH_META: Record<StrengthLevel, { labelKey: string; color: string; pct: number }> = {
  'very-weak': { labelKey: 'tools.passwordGen.strengthVeryWeak', color: '#cc2200', pct: 20 },
  weak: { labelKey: 'tools.passwordGen.strengthWeak', color: '#e0821a', pct: 40 },
  fair: { labelKey: 'tools.passwordGen.strengthFair', color: '#b38f00', pct: 60 },
  strong: { labelKey: 'tools.passwordGen.strengthStrong', color: '#1a7a4a', pct: 80 },
  'very-strong': { labelKey: 'tools.passwordGen.strengthVeryStrong', color: '#0a7a5a', pct: 100 },
}

const WORD_CASES: WordCase[] = ['lower', 'upper', 'title']
const CASE_LABEL: Record<WordCase, string> = {
  lower: 'tools.passwordGen.caseLower',
  upper: 'tools.passwordGen.caseUpper',
  title: 'tools.passwordGen.caseTitle',
}

export default function PasswordGeneratorTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PasswordMode>('characters')
  const [count, setCount] = useState(1)
  const [char, setChar] = useState<CharacterOptions>({ ...DEFAULT_CHARACTER_OPTIONS })
  const [phrase, setPhrase] = useState<PassphraseOptions>({ ...DEFAULT_PASSPHRASE_OPTIONS })
  const [output, setOutput] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ bits: number; strength: StrengthLevel } | null>(null)

  const setC = <K extends keyof CharacterOptions>(k: K, v: CharacterOptions[K]): void =>
    setChar((prev) => ({ ...prev, [k]: v }))
  const setP = <K extends keyof PassphraseOptions>(k: K, v: PassphraseOptions[K]): void =>
    setPhrase((prev) => ({ ...prev, [k]: v }))

  function handleGenerate(): void {
    const r = generatePasswords({
      mode,
      count,
      characters: char,
      passphrase: phrase,
    })
    if (r.ok) {
      setOutput(r.passwords)
      setMeta({ bits: r.entropyBits, strength: r.strength })
      setError(null)
    } else {
      setError(r.error)
      setOutput([])
      setMeta(null)
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

  return (
    <ToolShell
      title={t('tools.passwordGen.title')}
      toolbar={
        <button
          onClick={handleGenerate}
          className="rounded px-3 py-1 text-xs font-medium text-white"
          style={{ background: 'var(--accent)' }}
        >
          {t('tools.passwordGen.generate')}
        </button>
      }
      inputPane={
        <div className="flex h-full flex-col overflow-auto p-4 space-y-3">
          <Field label={t('tools.passwordGen.mode')}>
            <div className="flex gap-1">
              {(['characters', 'passphrase'] as PasswordMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="rounded px-3 py-1 text-xs font-semibold"
                  style={{
                    background: mode === m ? 'var(--accentLight)' : 'var(--white)',
                    color: mode === m ? 'var(--accentText)' : 'var(--muted)',
                    border: '1px solid',
                    borderColor: mode === m ? 'var(--accentText)' : 'var(--border)',
                  }}
                >
                  {m === 'characters'
                    ? t('tools.passwordGen.modeCharacters')
                    : t('tools.passwordGen.modePassphrase')}
                </button>
              ))}
            </div>
          </Field>

          {mode === 'characters' ? (
            <CharacterForm opts={char} set={setC} t={t} />
          ) : (
            <PassphraseForm opts={phrase} set={setP} t={t} />
          )}

          <NumberField
            label={t('tools.passwordGen.count')}
            value={count}
            min={COUNT_MIN}
            max={COUNT_MAX}
            onChange={setCount}
          />
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
            {t('tools.passwordGen.hint')}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {meta && <StrengthBar bits={meta.bits} strength={meta.strength} t={t} />}
            <div
              className="shrink-0 flex items-center justify-between border-b px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <span style={{ color: 'var(--muted)' }}>
                {output.length} {t('tools.passwordGen.generated')}
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
            <div className="flex-1 overflow-auto p-3 font-mono text-sm">
              {output.map((pw, i) => (
                <div
                  key={i}
                  className="cursor-pointer rounded px-2 py-1 break-all hover:bg-[var(--surface)]"
                  onClick={() => navigator.clipboard.writeText(pw).catch(() => {})}
                  title={t('tools.common.copy')}
                  style={{ color: 'var(--text)' }}
                >
                  {pw}
                </div>
              ))}
            </div>
          </div>
        )
      }
    />
  )
}

type Tr = (k: string) => string

function CharacterForm({
  opts,
  set,
  t,
}: {
  opts: CharacterOptions
  set: <K extends keyof CharacterOptions>(k: K, v: CharacterOptions[K]) => void
  t: Tr
}) {
  // With "no repeats" on, length can't exceed the unique pool — cap the input
  // to that ceiling and clamp any current value down so the request is always
  // satisfiable (no "83 > 82 unique" error after the fact).
  const uniquePool = useMemo(() => availablePoolSize(opts), [opts])
  const maxLen = opts.noRepeats
    ? Math.max(PASSWORD_LENGTH_MIN, Math.min(PASSWORD_LENGTH_MAX, uniquePool))
    : PASSWORD_LENGTH_MAX
  useEffect(() => {
    if (opts.length > maxLen) set('length', maxLen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxLen])

  return (
    <>
      <NumberField
        label={t('tools.passwordGen.length')}
        value={opts.length}
        min={PASSWORD_LENGTH_MIN}
        max={maxLen}
        onChange={(v) => set('length', v)}
        slider
      />
      {opts.noRepeats && (
        <div className="-mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('tools.passwordGen.noRepeatCap')} {uniquePool}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Checkbox
          label={t('tools.passwordGen.uppercase')}
          checked={opts.uppercase}
          onChange={(v) => set('uppercase', v)}
        />
        <Checkbox
          label={t('tools.passwordGen.lowercase')}
          checked={opts.lowercase}
          onChange={(v) => set('lowercase', v)}
        />
        <Checkbox
          label={t('tools.passwordGen.numbers')}
          checked={opts.numbers}
          onChange={(v) => set('numbers', v)}
        />
        <Checkbox
          label={t('tools.passwordGen.symbols')}
          checked={opts.symbols}
          onChange={(v) => set('symbols', v)}
        />
      </div>

      {opts.symbols && (
        <TextField
          label={t('tools.passwordGen.symbolSet')}
          value={opts.symbolSet ?? ''}
          mono
          onChange={(v) => set('symbolSet', v)}
        />
      )}

      <Checkbox
        label={t('tools.passwordGen.excludeAmbiguous')}
        checked={opts.excludeAmbiguous}
        onChange={(v) => set('excludeAmbiguous', v)}
      />
      <TextField
        label={t('tools.passwordGen.excludeChars')}
        value={opts.excludeChars ?? ''}
        mono
        onChange={(v) => set('excludeChars', v)}
      />

      <Checkbox
        label={t('tools.passwordGen.requireEachType')}
        checked={opts.requireEachType}
        onChange={(v) => set('requireEachType', v)}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={t('tools.passwordGen.minNumbers')}
          value={opts.minNumbers ?? 0}
          min={0}
          max={PASSWORD_LENGTH_MAX}
          onChange={(v) => set('minNumbers', v)}
        />
        <NumberField
          label={t('tools.passwordGen.minSymbols')}
          value={opts.minSymbols ?? 0}
          min={0}
          max={PASSWORD_LENGTH_MAX}
          onChange={(v) => set('minSymbols', v)}
        />
      </div>
      <Checkbox
        label={t('tools.passwordGen.noRepeats')}
        checked={opts.noRepeats}
        onChange={(v) => set('noRepeats', v)}
      />
    </>
  )
}

function PassphraseForm({
  opts,
  set,
  t,
}: {
  opts: PassphraseOptions
  set: <K extends keyof PassphraseOptions>(k: K, v: PassphraseOptions[K]) => void
  t: Tr
}) {
  return (
    <>
      <NumberField
        label={t('tools.passwordGen.wordCount')}
        value={opts.wordCount}
        min={PASSPHRASE_WORDS_MIN}
        max={PASSPHRASE_WORDS_MAX}
        onChange={(v) => set('wordCount', v)}
        slider
      />
      <TextField
        label={t('tools.passwordGen.separator')}
        value={opts.separator}
        mono
        onChange={(v) => set('separator', v)}
      />
      <Field label={t('tools.passwordGen.wordCase')}>
        <div className="flex gap-1">
          {WORD_CASES.map((wc) => (
            <button
              key={wc}
              onClick={() => set('wordCase', wc)}
              className="rounded px-3 py-1 text-xs font-semibold"
              style={{
                background: opts.wordCase === wc ? 'var(--accentLight)' : 'var(--white)',
                color: opts.wordCase === wc ? 'var(--accentText)' : 'var(--muted)',
                border: '1px solid',
                borderColor: opts.wordCase === wc ? 'var(--accentText)' : 'var(--border)',
              }}
            >
              {t(CASE_LABEL[wc])}
            </button>
          ))}
        </div>
      </Field>
      <Checkbox
        label={t('tools.passwordGen.includeNumber')}
        checked={opts.includeNumber}
        onChange={(v) => set('includeNumber', v)}
      />
    </>
  )
}

function StrengthBar({ bits, strength, t }: { bits: number; strength: StrengthLevel; t: Tr }) {
  const s = STRENGTH_META[strength]
  return (
    <div
      className="shrink-0 border-b px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
    >
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span style={{ color: s.color, fontWeight: 600 }}>{t(s.labelKey)}</span>
        <span style={{ color: 'var(--muted)' }}>
          ~{Math.round(bits)} {t('tools.passwordGen.entropyBits')}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded"
        style={{ background: 'var(--surface)' }}
      >
        <div className="h-full rounded" style={{ width: `${s.pct}%`, background: s.color }} />
      </div>
    </div>
  )
}

// ── small form primitives (CSS-var themed) ──────────────────────────────────

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-xs"
      style={{ color: 'var(--text)' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--accent)' }}
      />
      {label}
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-2 py-1 text-sm ${mono ? 'font-mono' : ''}`}
        style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
      />
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  slider,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  slider?: boolean
}) {
  const id = useId()
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] uppercase tracking-wide"
        style={{ color: 'var(--muted)' }}
      >
        {label}
        {slider ? <span style={{ color: 'var(--accentText)' }}> — {value}</span> : null}
      </label>
      <div className="flex items-center gap-2">
        {slider && (
          <input
            type="range"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="flex-1"
            style={{ accentColor: 'var(--accent)' }}
          />
        )}
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min)
          }}
          className={`rounded border px-2 py-1 text-sm ${slider ? 'w-20' : 'w-full'}`}
          style={{ background: 'var(--white)', borderColor: 'var(--border)' }}
        />
      </div>
    </div>
  )
}
