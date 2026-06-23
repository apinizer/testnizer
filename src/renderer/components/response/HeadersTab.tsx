import { useRef, useCallback } from 'react'
import { useResponseStore } from '../../stores/response.store'
import { useUIStore } from '../../stores/ui.store'

/**
 * Postman-style response headers tab — clean 2-column list with a draggable
 * divider so the KEY / VALUE split can be resized (issue #20). The width is a
 * percentage persisted in the UI store, so it survives the pane remount that
 * happens on every tab switch.
 */
export default function HeadersTab() {
  const response = useResponseStore((s) => s.response)
  const keyWidth = useUIStore((s) => s.responseHeaderKeyWidth)
  const setKeyWidth = useUIStore((s) => s.setResponseHeaderKeyWidth)
  const commitKeyWidth = useUIStore((s) => s.commitResponseHeaderKeyWidth)
  const tableRef = useRef<HTMLTableElement>(null)

  const headers = response?.headers || {}
  const keys = Object.keys(headers).sort((a, b) => a.localeCompare(b))

  // Drag the KEY/VALUE divider. The width is derived from the cursor's x
  // position relative to the table, as a percentage, so it stays correct as
  // the response pane itself is resized.
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const table = tableRef.current
      if (!table) return
      const onMove = (ev: MouseEvent) => {
        const rect = table.getBoundingClientRect()
        if (rect.width <= 0) return
        setKeyWidth(((ev.clientX - rect.left) / rect.width) * 100)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        commitKeyWidth()
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [setKeyWidth, commitKeyWidth],
  )

  if (keys.length === 0) {
    return (
      <div className="p-4 text-center" style={{ color: 'var(--hint)' }}>
        No headers in response.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table ref={tableRef} className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ background: 'var(--surface)' }}>
            <th
              className="relative text-left font-medium"
              style={{
                padding: '8px 12px',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                width: `${keyWidth}%`,
                fontSize: 13,
              }}
            >
              KEY
              {/* Drag handle straddling the KEY/VALUE border. */}
              <span
                role="separator"
                aria-orientation="vertical"
                data-testid="res-header-col-resize"
                onMouseDown={startResize}
                className="absolute top-0 z-10"
                style={{
                  right: -3,
                  height: '100%',
                  width: 6,
                  cursor: 'col-resize',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'var(--accent)'
                  ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              />
            </th>
            <th
              className="text-left font-medium"
              style={{
                padding: '8px 12px',
                color: 'var(--muted)',
                borderBottom: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              VALUE
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} style={{ borderBottom: '1px solid var(--border-split)' }}>
              <td
                className="align-top font-mono"
                style={{
                  padding: '7px 12px',
                  color: 'var(--json-key)',
                  wordBreak: 'break-all',
                }}
              >
                {k}
              </td>
              <td
                className="align-top font-mono"
                style={{
                  padding: '7px 12px',
                  color: 'var(--text)',
                  wordBreak: 'break-all',
                }}
              >
                {headers[k]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
