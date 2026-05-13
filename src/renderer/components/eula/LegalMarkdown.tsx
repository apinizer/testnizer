// src/renderer/components/eula/LegalMarkdown.tsx
//
// Reusable read-only Markdown viewer for legal documents.
//
//   - Uses react-markdown + remark-gfm.
//   - Disables raw HTML (default in react-markdown 9+) — no rehype-raw.
//   - Routes link clicks through `window.api.app.openExternal` so the
//     renderer's `connect-src 'self'` CSP isn't bypassed and external
//     URLs open in the user's system browser.

import { useCallback, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  text: string
  className?: string
}

export default function LegalMarkdown({ text, className }: Props) {
  const onLinkClick = useCallback((e: MouseEvent<HTMLAnchorElement>, href?: string) => {
    e.preventDefault()
    if (!href) return
    if (!/^https?:\/\//i.test(href)) return
    void window.api?.app?.openExternal(href)
  }, [])

  return (
    <div className={className} style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // skipHtml prevents any raw HTML in the markdown source from rendering
        // (defense-in-depth — react-markdown 9+ already escapes by default).
        skipHtml
        components={{
          h1: ({ children }: { children?: ReactNode }) => (
            <h1
              style={{ fontSize: 20, fontWeight: 700, margin: '0 0 12px 0', color: 'var(--text)' }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }: { children?: ReactNode }) => (
            <h2
              style={{
                fontSize: 16,
                fontWeight: 700,
                margin: '20px 0 8px 0',
                color: 'var(--text)',
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }: { children?: ReactNode }) => (
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                margin: '16px 0 6px 0',
                color: 'var(--text)',
              }}
            >
              {children}
            </h3>
          ),
          p: ({ children }: { children?: ReactNode }) => (
            <p style={{ margin: '8px 0', color: 'var(--text)' }}>{children}</p>
          ),
          ul: ({ children }: { children?: ReactNode }) => (
            <ul style={{ paddingLeft: 22, margin: '8px 0' }}>{children}</ul>
          ),
          ol: ({ children }: { children?: ReactNode }) => (
            <ol style={{ paddingLeft: 22, margin: '8px 0' }}>{children}</ol>
          ),
          li: ({ children }: { children?: ReactNode }) => (
            <li style={{ margin: '3px 0' }}>{children}</li>
          ),
          strong: ({ children }: { children?: ReactNode }) => (
            <strong style={{ fontWeight: 700, color: 'var(--text)' }}>{children}</strong>
          ),
          em: ({ children }: { children?: ReactNode }) => <em>{children}</em>,
          code: ({ children }: { children?: ReactNode }) => (
            <code
              style={{
                background: 'var(--surface)',
                padding: '1px 5px',
                borderRadius: 4,
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
              }}
            >
              {children}
            </code>
          ),
          a: ({ href, children }: { href?: string; children?: ReactNode }) => (
            <a
              href={href}
              onClick={(e) => onLinkClick(e, href)}
              style={{ color: 'var(--accent-text)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '1px solid var(--border)',
                margin: '16px 0',
              }}
            />
          ),
          blockquote: ({ children }: { children?: ReactNode }) => (
            <blockquote
              style={{
                borderLeft: '3px solid var(--border2)',
                paddingLeft: 12,
                color: 'var(--muted)',
                margin: '8px 0',
              }}
            >
              {children}
            </blockquote>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
