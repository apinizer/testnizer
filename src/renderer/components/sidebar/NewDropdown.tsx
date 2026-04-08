import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import type { Protocol } from '../../types'

function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

interface DropdownItem {
  icon: string
  label: string
  bg: string
  muted?: boolean
  action?: () => void
}

export default function NewDropdown() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })
  const setShowImportModal = useUIStore((s) => s.setShowImportModal)
  const openTab = useTabsStore((s) => s.openTab)

  function createProtocolTab(protocol: Protocol, name: string, method?: string) {
    const id = makeTabId()
    openTab({ id, name, protocol, method, url: '' })
    setOpen(false)
  }

  const updatePosition = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 6,
        left: rect.left,
      })
    }
  }, [])

  useEffect(() => {
    if (open) {
      updatePosition()
    }
  }, [open, updatePosition])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const newItems: DropdownItem[] = [
    {
      icon: '\uD83C\uDF10',
      label: 'HTTP Endpoint',
      bg: '#e8f4ff',
      action: () => createProtocolTab('http', 'New Request', 'GET'),
    },
    {
      icon: '\u26A1',
      label: 'Quick Request',
      bg: '#fff4e0',
      action: () => createProtocolTab('http', 'Quick Request', 'GET'),
    },
    {
      icon: '\uD83D\uDD0C',
      label: 'WebSocket',
      bg: '#fff0ec',
      action: () => createProtocolTab('websocket', 'WebSocket'),
    },
    {
      icon: '\uD83D\uDCE8',
      label: 'SOAP',
      bg: '#f0ecff',
      action: () => createProtocolTab('soap', 'SOAP Request'),
    },
    {
      icon: '\u25C8',
      label: 'GraphQL',
      bg: '#ffe8f0',
      action: () => createProtocolTab('graphql', 'GraphQL'),
    },
    {
      icon: '\u25A3',
      label: 'gRPC',
      bg: '#e8ffe8',
      action: () => createProtocolTab('grpc', 'gRPC'),
    },
    {
      icon: '\u21C9',
      label: 'SSE',
      bg: '#fff8e0',
      action: () => createProtocolTab('sse', 'SSE Stream'),
    },
    { icon: '\u00B7\u00B7\u00B7', label: 'More...', bg: '#f5f5f5', muted: true },
  ]

  const middleItems: DropdownItem[] = [
    { icon: '\uD83D\uDCE6', label: 'Schema', bg: '#e8f5e9' },
    { icon: '\uD83D\uDCDD', label: 'Markdown', bg: '#e8f4ff' },
    { icon: '\uD83D\uDCC1', label: 'Folder', bg: '#fff8e1' },
    { icon: '\uD83D\uDDC2', label: 'Module', bg: '#fce4ec' },
  ]

  const otherItems: { icon: string; label: string; shortcut: string; action?: () => void }[] = [
    {
      icon: '\u2B07',
      label: 'Import',
      shortcut: '\u2318O',
      action: () => {
        setOpen(false)
        setShowImportModal(true)
      },
    },
    { icon: '{}', label: 'Import cURL', shortcut: '\u2318I' },
  ]

  const dropdown = open ? createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999] w-80 rounded-xl border border-[var(--border)] bg-[var(--white)] p-3"
      style={{
        top: dropdownPos.top,
        left: dropdownPos.left,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        animation: 'slideDown 0.15s ease',
      }}
    >
      {/* New section */}
      <div className="mb-2 ml-1 text-[0.75rem] font-medium uppercase tracking-widest text-[var(--hint)]">
        New
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1">
        {newItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[0.875rem] transition-colors hover:bg-[var(--bg)]"
            style={{
              color: item.muted ? 'var(--hint)' : 'var(--text)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onClick={() => {
              item.action?.()
              if (!item.action) setOpen(false)
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-sm"
              style={{ background: item.bg }}
            >
              {item.icon}
            </div>
            {item.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="mx-0 my-1.5 border-t border-[var(--border)]" />

      {/* Middle section */}
      <div className="mb-2 grid grid-cols-2 gap-1">
        {middleItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex items-center gap-2 rounded-lg px-2.5 py-[7px] text-[0.875rem] text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => {
              item.action?.()
              if (!item.action) setOpen(false)
            }}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-sm"
              style={{ background: item.bg }}
            >
              {item.icon}
            </div>
            {item.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="border-t border-[var(--border)] pt-2">
        <div className="mb-1 text-[0.75rem] uppercase tracking-widest text-[var(--hint)]">
          Other
        </div>
        {otherItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.875rem] text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => {
              item.action?.()
              if (!item.action) setOpen(false)
            }}
          >
            <span className="w-5 text-sm">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            <span className="text-[0.75rem] text-[var(--hint)]">{item.shortcut}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] bg-[var(--accent)] text-xl font-light leading-none text-white"
        style={{ border: 'none' }}
      >
        +
      </button>
      {dropdown}
    </div>
  )
}
