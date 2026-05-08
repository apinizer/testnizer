import { useMemo, useState } from 'react'
import { useRequestStore } from '../../stores/request.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import { resolveVariables } from '../../lib/variable-resolver'

/**
 * Postman/Insomnia-style "URL PREVIEW" strip rendered just below the URL bar.
 *
 * Shows the user the substituted form of whatever they typed in the URL
 * field, so they can verify that their `{{baseUrl}}` and friends actually
 * resolve to what they expect *before* hitting Send.
 *
 * Hidden when:
 *   - URL is empty
 *   - URL has no `{{var}}` placeholders (resolved == raw)
 *
 * Unresolved `{{var}}` segments are still shown in the preview but in
 * red so the user can see they did not match anything.
 */
export default function UrlPreview() {
  const url = useRequestStore((s) => s.url)
  const getActiveVariables = useEnvironmentStore((s) => s.getActiveVariables)
  // Subscribe to env state so the preview re-renders when variables change.
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const globalVariables = useEnvironmentStore((s) => s.globalVariables)
  const [copied, setCopied] = useState(false)

  const { resolved, hasVars, hasUnresolved } = useMemo(() => {
    if (!url) return { resolved: '', hasVars: false, hasUnresolved: false }
    const vars = getActiveVariables()
    const r = resolveVariables(url, vars)
    return {
      resolved: r,
      hasVars: r !== url,
      // After resolution, any remaining `{{...}}` is an unresolved variable.
      hasUnresolved: /\{\{[^}]+\}\}/.test(r),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, environments, activeEnvironmentId, globalVariables])

  if (!url || !hasVars) return null

  // Split into segments so unresolved {{var}} can be highlighted in red.
  const segments: Array<{ text: string; unresolved: boolean }> = []
  if (hasUnresolved) {
    const re = /\{\{[^}]+\}\}/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(resolved)) !== null) {
      if (m.index > last) segments.push({ text: resolved.slice(last, m.index), unresolved: false })
      segments.push({ text: m[0], unresolved: true })
      last = m.index + m[0].length
    }
    if (last < resolved.length) segments.push({ text: resolved.slice(last), unresolved: false })
  } else {
    segments.push({ text: resolved, unresolved: false })
  }

  function copy(): void {
    navigator.clipboard
      .writeText(resolved)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        // ignore
      })
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        flexShrink: 0,
        minHeight: 26,
      }}
    >
      <span
        style={{
          color: 'var(--muted)',
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          flexShrink: 0,
          fontSize: 10,
        }}
      >
        URL PREVIEW
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
        title={resolved}
      >
        {segments.map((seg, i) =>
          seg.unresolved ? (
            <span key={i} style={{ color: 'var(--delete-color, #cc2200)', fontWeight: 500 }}>
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </span>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied!' : 'Copy resolved URL'}
        style={{
          flexShrink: 0,
          height: 22,
          width: 22,
          borderRadius: 4,
          border: '1px solid var(--border)',
          background: 'transparent',
          color: copied ? 'var(--green, #1a7a4a)' : 'var(--muted)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        {copied ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  )
}
