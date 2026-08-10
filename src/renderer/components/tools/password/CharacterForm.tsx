/**
 * Character-mode options.
 *
 * Three tester-reported behaviours are settled here:
 *
 *  - The Symbol-set field is ALWAYS rendered (disabled when Symbols is off).
 *    It used to appear and disappear directly above "Exclude look-alikes", which
 *    shifted that checkbox down the form — reported as the option vanishing.
 *  - Turning a class off zeroes its minimum. `minSymbols` defaults to 1, so
 *    unchecking Symbols silently created an impossible request and every
 *    Generate failed with a rule the user never set.
 *  - Length is never rewritten behind the user's back; an impossible no-repeat
 *    request is explained instead.
 */
import NumberField from '../../shared/NumberField'
import {
  availablePoolSize,
  validateCharacterOptions,
  PASSWORD_LENGTH_MIN,
  PASSWORD_LENGTH_MAX,
  type CharacterOptions,
} from '../../../lib/tools/password-generator'
import { Checkbox, Field, TextField, type Tr } from './atoms'

export default function CharacterForm({
  opts,
  set,
  t,
}: {
  opts: CharacterOptions
  set: <K extends keyof CharacterOptions>(k: K, v: CharacterOptions[K]) => void
  t: Tr
}) {
  const uniquePool = availablePoolSize(opts)
  const problem = validateCharacterOptions(opts)

  /**
   * Turning a class off must also drop its minimum, or the form is left holding
   * a rule that cannot be satisfied and only fails at Generate time.
   */
  const toggleClass = (key: 'numbers' | 'symbols', on: boolean): void => {
    set(key, on)
    if (!on) set(key === 'numbers' ? 'minNumbers' : 'minSymbols', 0)
  }

  return (
    <>
      <NumberField
        label={t('tools.passwordGen.length')}
        value={opts.length}
        min={PASSWORD_LENGTH_MIN}
        max={PASSWORD_LENGTH_MAX}
        onChange={(v) => set('length', v)}
        slider
      />

      <Field label={t('tools.passwordGen.groupClasses')}>
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
            onChange={(v) => toggleClass('numbers', v)}
          />
          <Checkbox
            label={t('tools.passwordGen.symbols')}
            checked={opts.symbols}
            onChange={(v) => toggleClass('symbols', v)}
          />
        </div>
      </Field>

      {/* Always present, disabled when Symbols is off — nothing below it moves. */}
      <TextField
        label={t('tools.passwordGen.symbolSet')}
        value={opts.symbolSet ?? ''}
        mono
        disabled={!opts.symbols}
        onChange={(v) => set('symbolSet', v)}
      />

      <Field label={t('tools.passwordGen.groupExclusions')}>
        <div className="space-y-2">
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
        </div>
      </Field>

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
          // Capped by the password itself: a minimum larger than the length is
          // never satisfiable, and the old cap of 256 let you set one.
          max={opts.length}
          onChange={(v) => set('minNumbers', v)}
        />
        <NumberField
          label={t('tools.passwordGen.minSymbols')}
          value={opts.minSymbols ?? 0}
          min={0}
          max={opts.length}
          onChange={(v) => set('minSymbols', v)}
        />
      </div>

      <Checkbox
        label={t('tools.passwordGen.noRepeats')}
        checked={opts.noRepeats}
        onChange={(v) => set('noRepeats', v)}
        hint={t('tools.passwordGen.noRepeatsHint')}
      />
      {opts.noRepeats && (
        <div className="-mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
          {t('tools.passwordGen.noRepeatCap')} {uniquePool}
        </div>
      )}

      {/*
        Live, and from the SAME function the generator throws from, so the form
        can never claim a request is fine when the engine disagrees. The length
        used to be silently clamped down instead — which read as "the checkbox
        changed my length".
      */}
      {problem && (
        <div role="alert" className="text-[11px]" style={{ color: '#cc2200' }}>
          {problem}
        </div>
      )}
    </>
  )
}
