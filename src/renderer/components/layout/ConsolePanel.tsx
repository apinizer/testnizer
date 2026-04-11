import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import ConsoleTab from '../response/ConsoleTab'

/**
 * Postman-style bottom Console panel.
 *
 * Slides up from the footer area when the user clicks the "Konsol" button.
 * Contents reuse `ConsoleTab` which renders the same request-log list as the
 * response pane's Console tab.
 *
 * Height is user-resizable via the top edge (drag handle). Default 280px,
 * clamped to 120–720.
 */
export default function ConsolePanel() {
  const show = useUIStore((s) => s.showConsolePanel)
  const setShow = useUIStore((s) => s.setShowConsolePanel)

  const [height, setHeight] = useState(280)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  useEffect(() => {
    // ESC to close
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && show) setShow(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, setShow])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      setHeight(Math.max(120, Math.min(720, startH.current + delta)))
    }
    function onUp() {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!show) return null

  function startDrag(e: React.MouseEvent) {
    dragging.current = true
    startY.current = e.clientY
    startH.current = height
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      // sits just above the 28px footer
      className="absolute left-0 right-0"
      style={{
        bottom: 28,
        height,
        background: 'var(--white)',
        borderTop: '1px solid var(--border)',
        boxShadow: 'var(--shadow-drop)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideDown 0.12s ease-out reverse',
        zIndex: 40,
      }}
    >
      {/* Drag handle — 6px strip at the top */}
      <div
        onMouseDown={startDrag}
        style={{
          height: 6,
          cursor: 'row-resize',
          background: 'transparent',
          flexShrink: 0,
          marginTop: -3,
        }}
      />

      {/* Close button — top-right overlay */}
      <button
        type="button"
        onClick={() => setShow(false)}
        title="Hide console"
        className="cursor-pointer"
        style={{
          position: 'absolute',
          top: 8,
          right: 10,
          width: 22,
          height: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          borderRadius: 4,
          zIndex: 2,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <ChevronDown size={14} />
      </button>

      {/* Body — the same component used by the response-pane Console tab */}
      <div className="flex-1 overflow-hidden">
        <ConsoleTab />
      </div>
    </div>
  )
}

