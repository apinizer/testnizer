/**
 * Invalidate a tool's output when its input changes.
 *
 * Testers reported this on the JWK tool (edit the JWK, press Validate, and the
 * PEM of the *previous* key is still sitting next to the new key's card). The
 * same shape turned out to exist in six security tools, where the thing left on
 * screen is a verdict: change the signed XML and SAML still shows a green
 * "Valid"; paste a different token and the JWT panel still says "Signature
 * verified"; switch WS-Security tabs and the footer still says the signature was
 * valid. A stale verdict is worse than no verdict — it answers a question the
 * user did not ask about the input they can currently see.
 *
 * Hence two hooks with deliberately different behaviour:
 *
 *  - `useInvalidateOn` — for VERDICTS. Wipes them the moment the input moves.
 *  - `useStaleFlag`    — for ARTIFACTS (generated passwords, UUIDs, a formatted
 *    document). Those are the user's work product; deleting them because a
 *    checkbox moved would lose something they were about to copy. They are
 *    marked stale instead, and the screen says so.
 *
 * Both skip the first render: mounting is not a change.
 *
 * CHOOSING BETWEEN THESE AND A HANDLER CALL
 * -----------------------------------------
 * Use these hooks only when the deps are inputs the tool NEVER writes itself.
 * Where a tool feeds its own output back into an input — SAML puts the document
 * it just signed into the editor, the JWE panel puts the token it just encrypted
 * into the token box — an effect on that value also fires on the tool's own
 * write, wiping the "Signed" status the action had just set. Those tools
 * invalidate from the user's change handler instead, which is the event that
 * actually means "this verdict is about the wrong input now".
 */
import { useEffect, useRef, useState } from 'react'

/** Have the values in `deps` changed since the last render? */
function useChanged(deps: readonly unknown[]): boolean {
  const previous = useRef<readonly unknown[] | null>(null)
  const changed =
    previous.current !== null &&
    (previous.current.length !== deps.length || deps.some((d, i) => d !== previous.current?.[i]))
  previous.current = deps
  return changed
}

/**
 * Run `reset` whenever any value in `deps` changes — but never on mount.
 *
 * Use for verdicts and for any output that would be WRONG about the current
 * input rather than merely out of date.
 */
export function useInvalidateOn(deps: readonly unknown[], reset: () => void): void {
  // The reset must see the latest closure without re-arming the effect.
  const latest = useRef(reset)
  latest.current = reset
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    latest.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Track whether the output on screen was produced by the current input.
 *
 * Returns `true` once any dep changes, and back to `false` when `markFresh` is
 * called — which callers do right after they regenerate.
 */
export function useStaleFlag(deps: readonly unknown[]): {
  stale: boolean
  markFresh: () => void
} {
  const [stale, setStale] = useState(false)
  const changed = useChanged(deps)

  // Derived from the render itself rather than an effect: the banner has to be
  // right in the same paint that shows the changed input.
  if (changed && !stale) setStale(true)

  return {
    stale,
    markFresh: () => setStale(false),
  }
}
