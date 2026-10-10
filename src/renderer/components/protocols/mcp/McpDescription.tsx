import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../../lib/i18n'

/**
 * Length above which a description counts as clamped when layout cannot be
 * measured — jsdom (every height is 0) or a pane that is not displayed yet. In
 * a laid-out pane the real `scrollHeight > clientHeight` check decides, so a
 * long text that still fits in three lines gets no pointless toggle.
 */
export const DESCRIPTION_CLAMP_CHARS = 240

/**
 * A capability description (tool / resource / prompt) clamped to three lines,
 * with a Show more / Show less toggle that appears only when text is cut off.
 * Issue #155: an unbounded ~3000-char description pushed Invoke out of view.
 */
export default function McpDescription(props: McpDescriptionProps) {
  // Keyed by text: selecting another capability remounts it collapsed and
  // re-measured — also when coming back to a description expanded earlier.
  return <ClampedDescription key={props.text} {...props} />
}

interface McpDescriptionProps {
  text: string
  /** `data-testid` of the description element. */
  testId?: string
}

function ClampedDescription({ text, testId = 'mcp-tool-description' }: McpDescriptionProps) {
  const { t } = useTranslation()
  const ref = useRef<HTMLParagraphElement>(null)
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(() => text.length > DESCRIPTION_CLAMP_CHARS)

  useLayoutEffect(() => {
    // Expanded, the clamp is gone and scrollHeight === clientHeight: measuring
    // then would hide the very "Show less" button the user needs.
    const el = ref.current
    if (expanded || !el) return
    const measure = (): void => {
      setOverflows(
        el.clientHeight === 0
          ? text.length > DESCRIPTION_CLAMP_CHARS
          : el.scrollHeight > el.clientHeight + 1,
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="flex flex-col gap-0.5">
      <p
        ref={ref}
        id={id}
        data-testid={testId}
        className={`m-0 break-words text-[12px] text-[var(--muted)] ${
          expanded ? 'whitespace-pre-wrap' : 'line-clamp-3'
        }`}
      >
        {text}
      </p>
      {(expanded || overflows) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={id}
          data-testid="mcp-description-toggle"
          className="cursor-pointer self-start border-none bg-transparent p-0 text-[11px] text-[var(--accent)] hover:underline"
        >
          {expanded ? t('mcp.description.showLess') : t('mcp.description.showMore')}
        </button>
      )}
    </div>
  )
}
