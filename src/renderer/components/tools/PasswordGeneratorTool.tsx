/**
 * Security → Password Generator.
 *
 * All generation is pure renderer code (`lib/tools/password-generator.ts`) over
 * the Web Crypto CSPRNG — nothing here crosses IPC and no password is persisted.
 *
 * The forms and the result list live in `./password/*` (this file outgrew the
 * ~200-line rule); what remains is the state and the wiring between them.
 */
import { useState } from 'react'
import ToolShell from './ToolShell'
import CharacterForm from './password/CharacterForm'
import PassphraseForm from './password/PassphraseForm'
import OutputList, { StrengthBar } from './password/OutputList'
import NumberField from '../shared/NumberField'
import { useStaleFlag } from '../../lib/use-stale-guard'
import {
  generatePasswords,
  DEFAULT_CHARACTER_OPTIONS,
  DEFAULT_PASSPHRASE_OPTIONS,
  COUNT_MIN,
  COUNT_MAX,
  type PasswordMode,
  type CharacterOptions,
  type PassphraseOptions,
  type StrengthLevel,
} from '../../lib/tools/password-generator'
import { useTranslation } from '../../lib/i18n'
import { Field } from './password/atoms'

export default function PasswordGeneratorTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PasswordMode>('characters')
  const [count, setCount] = useState(1)
  const [char, setChar] = useState<CharacterOptions>({ ...DEFAULT_CHARACTER_OPTIONS })
  const [phrase, setPhrase] = useState<PassphraseOptions>({ ...DEFAULT_PASSPHRASE_OPTIONS })
  const [output, setOutput] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ bits: number; strength: StrengthLevel } | null>(null)

  /**
   * Generated passwords are the user's WORK PRODUCT, so a changed option marks
   * them stale rather than deleting them — losing the one you were about to copy
   * because a checkbox moved would be its own bug. (A verdict would be cleared;
   * see `use-stale-guard`.) This also answers the "no repeated characters does
   * nothing" report: the algorithm was always right, but the old list sat there
   * unchanged after ticking the box, so it looked ignored.
   */
  const { stale, markFresh } = useStaleFlag([mode, count, char, phrase])

  const setC = <K extends keyof CharacterOptions>(k: K, v: CharacterOptions[K]): void =>
    setChar((prev) => ({ ...prev, [k]: v }))
  const setP = <K extends keyof PassphraseOptions>(k: K, v: PassphraseOptions[K]): void =>
    setPhrase((prev) => ({ ...prev, [k]: v }))

  function handleGenerate(): void {
    const r = generatePasswords({ mode, count, characters: char, passphrase: phrase })
    markFresh()
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
        <div className="flex h-full flex-col space-y-3 overflow-auto p-4">
          <Field label={t('tools.passwordGen.mode')}>
            <div className="flex gap-1">
              {(['characters', 'passphrase'] as PasswordMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
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
            <OutputList output={output} stale={stale} t={t} />
          </div>
        )
      }
    />
  )
}
