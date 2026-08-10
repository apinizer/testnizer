/**
 * Numeric input behaviour, in one place.
 *
 * The bug this exists to kill: every `<input type="number">` in the app was
 * wired as
 *
 *   onChange={(e) => { const n = Number(e.target.value)
 *                      onChange(Number.isFinite(n) ? clamp(n) : min) }}
 *
 * which clamps on EVERY keystroke. `Number('')` is `0` — finite — so emptying
 * the box instantly wrote `min` back into it, and any intermediate value below
 * `min` was destroyed before the user finished typing. Testers reported it as
 * "1 can't be deleted; typing 3 gives 13": with `min` 1 the field can never be
 * empty, so the new digit lands next to the old one.
 *
 * The contract here separates *typing* from *committing*:
 *
 *  - while typing, the raw text is kept as-is, so the field can be emptied and
 *    can hold a half-finished number;
 *  - a value that already parses inside `[min, max]` is propagated immediately,
 *    so a slider or a "— 20" label bound to the same state still tracks live;
 *  - clamping happens only on commit (blur / Enter), where an empty box falls
 *    back to the last good value instead of to `min`.
 */
import { useEffect, useRef, useState } from 'react'

/**
 * Clamp to an integer inside `[min, max]`.
 *
 * `NaN` has no position on the number line, so it falls back to `min`; ±Infinity
 * does, and clamps to the corresponding bound.
 */
export function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/**
 * Parse user-typed text as an integer. Returns `null` for anything that is not
 * a complete integer — empty, whitespace, `-`, `1e3`, `1.5`, `abc` — so callers
 * can tell "still typing" apart from "has a value". Deliberately stricter than
 * `Number()`, which maps `''` to `0` and is the root of the reported bug.
 */
export function parseIntStrict(raw: string): number | null {
  const text = raw.trim()
  if (!/^-?\d+$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export interface NumberDraft {
  /** Current text of the input — may be empty or mid-edit. */
  draft: string
  /** Props to spread on an `<input type="number">`. */
  inputProps: {
    value: string
    onChange: (e: { target: { value: string } }) => void
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (e: { key: string }) => void
  }
  /** Props for an optional companion `<input type="range">`. */
  sliderProps: {
    value: number
    onChange: (e: { target: { value: string } }) => void
  }
}

/**
 * Draft-based numeric input state.
 *
 * `value` stays the source of truth; the draft mirrors it whenever the field is
 * not focused, so programmatic changes (a slider, a reset, a clamp elsewhere)
 * still show up.
 */
export function useNumberDraft({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}): NumberDraft {
  const [draft, setDraft] = useState(() => String(value))
  const focused = useRef(false)

  // Mirror external changes, but never fight the user mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const parsed = parseIntStrict(draft)
    if (parsed === null) {
      // Empty or unparseable: fall back to the last good value rather than to
      // `min`, so blurring an empty box doesn't silently pick a number for you.
      setDraft(String(value))
      return
    }
    const clamped = clampInt(parsed, min, max)
    setDraft(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return {
    draft,
    inputProps: {
      value: draft,
      onChange: (e) => {
        const next = e.target.value
        setDraft(next)
        const parsed = parseIntStrict(next)
        // Propagate only already-valid values. An out-of-range or partial entry
        // stays local until commit, which is what lets the box be emptied.
        if (parsed !== null && parsed >= min && parsed <= max && parsed !== value) {
          onChange(parsed)
        }
      },
      onFocus: () => {
        focused.current = true
      },
      onBlur: () => {
        focused.current = false
        commit()
      },
      onKeyDown: (e) => {
        if (e.key === 'Enter') commit()
      },
    },
    sliderProps: {
      value,
      // A range input can only produce in-range values, so it commits directly.
      onChange: (e) => {
        const parsed = parseIntStrict(e.target.value)
        if (parsed !== null) onChange(clampInt(parsed, min, max))
      },
    },
  }
}
