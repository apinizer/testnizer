/**
 * Keyboard model of a WAI-ARIA radio group (issue #226): one Tab stop per
 * group (roving tabindex — the checked radio, or the first one when none is
 * checked), the arrow keys move AND select, wrapping at the ends, Home / End
 * go to the first / last radio. Use with buttons that carry `role="radio"`.
 */
import type { KeyboardEvent } from 'react'

/** The radio a key moves to from `index` in a group of `count`, or null for any other key. */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** `tabIndex` of the radio at `index`: 0 for the checked one (the first when none is), else -1. */
export function radioTabIndex(index: number, checkedIndex: number): 0 | -1 {
  return index === (checkedIndex < 0 ? 0 : checkedIndex) ? 0 : -1
}

/**
 * `onKeyDown` for a radio of a group whose values are `values`: selects the
 * target value and moves focus to its radio — the element at the same index
 * among the `[role="radio"]` children of the event's radiogroup.
 */
export function onRadioKeyDown<V>(
  e: KeyboardEvent<HTMLElement>,
  values: readonly V[],
  index: number,
  select: (value: V) => void,
): void {
  const target = radioKeyTarget(e.key, index, values.length)
  if (target === null) return
  e.preventDefault()
  select(values[target])
  const group = e.currentTarget.closest('[role="radiogroup"]')
  const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]')
  radios?.[target]?.focus()
}
