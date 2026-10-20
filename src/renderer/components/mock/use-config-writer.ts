/**
 * The write path of the response editor's option rows (Stream / LLM, issue
 * #221): each change saves the WHOLE config, built as `base + patch`.
 *
 * `base` must be the latest config, not the one the last render saw: the
 * store only learns a save once its IPC answer is back, so two quick
 * changes (Loop, then the interval) used to build the second save over the
 * old config and revert the first. While a save is in flight the next one
 * merges over the last config WRITTEN; once none is, over the stored one
 * again (which then includes them all).
 *
 * A patch may be a function of that base, for fields derived from another
 * one (the usage pair, the stop reason that follows the tool calls).
 */
import { useRef } from 'react'

export type ConfigPatch<T> = Partial<T> | ((base: T) => Partial<T>)

export function useConfigWriter<T extends object>(
  stored: T,
  save: (next: T) => Promise<string | null>,
): (patch: ConfigPatch<T>) => Promise<string | null> {
  const pending = useRef<{ inflight: number; last: T | null }>({ inflight: 0, last: null })
  return async (patch) => {
    const p = pending.current
    const base = p.inflight > 0 && p.last ? p.last : stored
    const next = { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
    p.last = next
    p.inflight++
    try {
      return await save(next)
    } finally {
      p.inflight--
    }
  }
}
