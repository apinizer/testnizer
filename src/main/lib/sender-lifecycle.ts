/**
 * The owning renderer's lifecycle, for main-side work that must not outlive
 * the page that started it (AI Chat streams, issue #180; MQTT connections,
 * issue #284): the renderer reloads, crashes or closes → nobody can answer
 * for that work any more, so it is ended.
 */

/** The slice of `WebContents` this module needs (tests pass an EventEmitter). */
export interface SenderLike {
  id: number
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown
}

/** A full main-frame navigation (reload / new page) — not an in-page hash / history change. */
export function isFullMainFrameNavigation(
  details: unknown,
  isInPlace?: unknown,
  isMainFrame?: unknown,
): boolean {
  const d = details && typeof details === 'object' ? (details as Record<string, unknown>) : {}
  const sameDocument = typeof d.isSameDocument === 'boolean' ? d.isSameDocument : isInPlace === true
  const mainFrame = typeof d.isMainFrame === 'boolean' ? d.isMainFrame : isMainFrame !== false
  return mainFrame && !sameDocument
}

/**
 * Call `onGone` when `sender` is destroyed (`destroyed: true`), its render
 * process dies, or it navigates away (a reload). Registers listeners only —
 * the caller dedupes per sender id.
 */
export function onSenderGone(sender: SenderLike, onGone: (destroyed: boolean) => void): void {
  if (typeof sender.on !== 'function') return
  sender.on('destroyed', () => onGone(true))
  sender.on('render-process-gone', () => onGone(false))
  sender.on(
    'did-start-navigation',
    (details: unknown, _url: unknown, inPlace: unknown, main: unknown) => {
      if (isFullMainFrameNavigation(details, inPlace, main)) onGone(false)
    },
  )
}
