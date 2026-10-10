import type { ReactElement } from 'react'

// ─── Markdown-lite renderer ─────────────────────────────────
// Apidog/Postman do basic markdown rendering for assistant turns. We avoid
// pulling in a markdown lib — just render fenced code blocks specially and
// preserve paragraph breaks. Inline code with backticks is also handled.

interface MdSegment {
  type: 'text' | 'code'
  content: string
  lang?: string
}

function parseMarkdown(text: string): MdSegment[] {
  const segments: MdSegment[] = []
  const fenceRegex = /```(\w+)?\n([\s\S]*?)(?:```|$)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'code', content: match[2], lang: match[1] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

export default function MarkdownText({ text }: { text: string }): ReactElement {
  const segments = parseMarkdown(text)
  return (
    <div className="flex flex-col gap-2">
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <pre
            key={i}
            className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 font-mono"
            style={{ fontSize: 12.5 }}
          >
            {seg.lang && (
              <div
                className="mb-2 uppercase tracking-wider text-[var(--muted)]"
                style={{ fontSize: 11 }}
              >
                {seg.lang}
              </div>
            )}
            <code>{seg.content}</code>
          </pre>
        ) : (
          <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {renderInline(seg.content)}
          </div>
        ),
      )}
    </div>
  )
}

function renderInline(text: string): ReactElement[] {
  // Inline code: `...`
  const parts: ReactElement[] = []
  const regex = /`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>)
    }
    parts.push(
      <code
        key={key++}
        className="rounded bg-[var(--bg)] px-1 py-0.5 font-mono"
        style={{ fontSize: 12.5 }}
      >
        {match[1]}
      </code>,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>)
  }
  return parts
}
