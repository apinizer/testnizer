/**
 * Clipboard copying with feedback, in one place.
 *
 * Every copy site in the app used to write to the clipboard inside a `try` whose
 * `catch` body was the comment "ignore",
 * so a failed copy looked exactly like a successful one, and most sites gave no
 * signal either way. Testers reported it on the Password Generator, whose own
 * caption says "click any to copy" — the click did nothing visible.
 *
 * Two things are guaranteed here: a success is visible for a moment, and a
 * failure is reported instead of swallowed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from './toast'
import { t } from './i18n'

/** How long the ✓ stays up. Matches the flash the JWT/JWK tools already used. */
const COPIED_MS = 1200

export interface CopyState {
  /** True for `COPIED_MS` after a successful copy. */
  copied: boolean
  /** Copies `text`; no-ops on empty input, toasts on failure. */
  copy: (text: string) => Promise<void>
}

export function useCopy(): CopyState {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A tool tab can be closed while the flash is still pending.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(async (text: string): Promise<void> => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    } catch (e) {
      // Clipboard access can be denied by the OS or the document focus state.
      // Saying so beats a button that silently does nothing.
      toast.error(`${t('tools.common.copyFailed')}: ${(e as Error).message}`)
    }
  }, [])

  return { copied, copy }
}
