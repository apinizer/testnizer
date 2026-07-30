/**
 * Passphrase-mode options.
 *
 * The digit now has an explicit position. It always went to a RANDOM word,
 * re-rolled on every generation — testers read that as "the position depends on
 * word case", which it never did. `end` is the default because that is what
 * "append" means; `random` stays available and is slightly stronger.
 */
import NumberField from '../../shared/NumberField'
import {
  PASSPHRASE_WORDS_MIN,
  PASSPHRASE_WORDS_MAX,
  type DigitPosition,
  type PassphraseOptions,
  type WordCase,
} from '../../../lib/tools/password-generator'
import { Checkbox, Field, TextField, type Tr } from './atoms'

const WORD_CASES: WordCase[] = ['lower', 'upper', 'title']
const CASE_LABEL: Record<WordCase, string> = {
  lower: 'tools.passwordGen.caseLower',
  upper: 'tools.passwordGen.caseUpper',
  title: 'tools.passwordGen.caseTitle',
}

const DIGIT_POSITIONS: DigitPosition[] = ['end', 'random']
const POSITION_LABEL: Record<DigitPosition, string> = {
  end: 'tools.passwordGen.digitAtEnd',
  random: 'tools.passwordGen.digitRandom',
}

/** Segmented control shared by the two option groups below. */
function Pills<T extends string>({
  values,
  active,
  labelKey,
  onPick,
  t,
}: {
  values: T[]
  active: T
  labelKey: Record<T, string>
  onPick: (v: T) => void
  t: Tr
}) {
  return (
    <div className="flex gap-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={active === v}
          className="rounded px-3 py-1 text-xs font-semibold"
          style={{
            background: active === v ? 'var(--accentLight)' : 'var(--white)',
            color: active === v ? 'var(--accentText)' : 'var(--muted)',
            border: '1px solid',
            borderColor: active === v ? 'var(--accentText)' : 'var(--border)',
          }}
        >
          {t(labelKey[v])}
        </button>
      ))}
    </div>
  )
}

export default function PassphraseForm({
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
        <Pills
          values={WORD_CASES}
          active={opts.wordCase}
          labelKey={CASE_LABEL}
          onPick={(v) => set('wordCase', v)}
          t={t}
        />
      </Field>
      <Checkbox
        label={t('tools.passwordGen.includeNumber')}
        checked={opts.includeNumber}
        onChange={(v) => set('includeNumber', v)}
      />
      {opts.includeNumber && (
        <Field label={t('tools.passwordGen.digitPosition')}>
          <Pills
            values={DIGIT_POSITIONS}
            active={opts.digitPosition ?? 'end'}
            labelKey={POSITION_LABEL}
            onPick={(v) => set('digitPosition', v)}
            t={t}
          />
        </Field>
      )}
    </>
  )
}
