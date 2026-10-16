import { useState, useLayoutEffect, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../lib/i18n'
import type { ApiResponse } from '../../types'

/** Extract hostname from URL safely */
function extractHost(url?: string): string {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return u.host || '—'
  } catch {
    return '—'
  }
}

/** Extract protocol (http/https) from URL */
function extractProtocol(url?: string): string {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return u.protocol.replace(':', '').toUpperCase()
  } catch {
    return '—'
  }
}

/** Human format milliseconds for the timing table */
function fmtMs(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1) return '<1 ms'
  return `${Math.round(ms)} ms`
}

/**
 * Network info popover — rendered when the globe icon is clicked.
 *
 * Portaled to `document.body` and positioned with `fixed` so the overlay
 * can escape the response pane's `overflow-hidden` clipping rectangle and
 * the workbench's bottom Console panel. The previous absolute-positioned
 * version was clipped at the workbench bottom edge whenever the response
 * pane sat low in the layout (typical 50/50 split), hiding the Timings
 * rows from view.
 */
export default forwardRef<HTMLDivElement, { response: ApiResponse; anchor: HTMLElement | null }>(
  function NetworkInfoPopover({ response, anchor }, ref) {
    const POPOVER_W = 320
    const VIEWPORT_MARGIN = 8

    const { t } = useTranslation()
    const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

    // Recompute position on mount + when the viewport changes. The button is
    // anchored at fixed coords from the workbench layout, so we read its
    // rect on demand rather than tracking it continuously.
    useLayoutEffect(() => {
      if (!anchor) return
      const measure = (): void => {
        const rect = anchor.getBoundingClientRect()
        const vh = window.innerHeight
        const vw = window.innerWidth
        const spaceBelow = vh - rect.bottom
        const spaceAbove = rect.top
        // Pick the side with more room. Threshold: 200px below — anything
        // less and we flip upward. The popover renders both Network and
        // Timings sections (~400px when fully populated).
        const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
        const maxHeight = Math.max(180, (openUp ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN)
        const top = openUp
          ? Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - 4)
          : Math.min(rect.bottom + 4, vh - maxHeight - VIEWPORT_MARGIN)
        // Right-align with the button; clamp inside the viewport so the
        // popover never spills off the left edge on a narrow window.
        const left = Math.max(
          VIEWPORT_MARGIN,
          Math.min(rect.right - POPOVER_W, vw - POPOVER_W - VIEWPORT_MARGIN),
        )
        setPos({ top, left, maxHeight })
      }
      measure()
      window.addEventListener('resize', measure)
      window.addEventListener('scroll', measure, true)
      return () => {
        window.removeEventListener('resize', measure)
        window.removeEventListener('scroll', measure, true)
      }
    }, [anchor])

    if (!pos) return null

    const url = response.actualRequest?.url
    const host = extractHost(url)
    const proto = extractProtocol(url)
    const contentType =
      response.headers?.['content-type'] || response.headers?.['Content-Type'] || '—'
    const server = response.headers?.['server'] || response.headers?.['Server'] || '—'
    const timing = response.timing || { total: 0 }

    const rows: Array<[string, string]> = [
      [t('response.net.host'), host],
      [t('response.net.protocol'), proto],
      [t('response.net.method'), response.actualRequest?.method || '—'],
      [
        t('response.net.status'),
        response.status != null ? `${response.status} ${response.statusText || ''}`.trim() : '—',
      ],
      [t('response.net.server'), server],
      ['Content-Type', contentType],
    ]

    const timings: Array<[string, string]> = [
      [t('response.net.dns'), fmtMs(timing.dns)],
      [t('response.net.tcp'), fmtMs(timing.tcp)],
      [t('response.net.tls'), fmtMs(timing.tls)],
      [t('response.net.ttfb'), fmtMs(timing.ttfb)],
      [t('response.net.download'), fmtMs(timing.download)],
      [t('response.net.total'), fmtMs(timing.total)],
    ]

    return createPortal(
      <div
        ref={ref}
        data-testid="response-network-popover"
        className="fixed z-[1000] overflow-auto rounded-md border border-[var(--border)] bg-[var(--white)] shadow-lg"
        style={{
          top: pos.top,
          left: pos.left,
          width: POPOVER_W,
          maxHeight: pos.maxHeight,
          boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
          fontSize: 13,
        }}
      >
        <div
          className="px-3 py-2 font-semibold text-[var(--text)]"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {t('response.net.title')}
        </div>
        <div className="px-3 py-2">
          <table className="w-full" style={{ fontSize: 13 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-1 pr-3 text-[var(--muted)]" style={{ width: 110 }}>
                    {k}
                  </td>
                  <td
                    className="py-1 font-mono text-[var(--text)]"
                    style={{ wordBreak: 'break-all' }}
                  >
                    {v}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="px-3 py-2 font-semibold text-[var(--text)]"
          style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
        >
          {t('response.net.timings')}
        </div>
        <div className="px-3 py-2">
          <table className="w-full" style={{ fontSize: 13 }}>
            <tbody>
              {timings.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-1 pr-3 text-[var(--muted)]" style={{ width: 160 }}>
                    {k}
                  </td>
                  <td className="py-1 font-mono text-[var(--text)]">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>,
      document.body,
    )
  },
)
