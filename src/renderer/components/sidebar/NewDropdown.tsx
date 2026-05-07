import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Globe, Radio, Activity, Cpu, Bot, FileCode2, Hexagon, Download, Code2 } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import type { Protocol } from '../../types'

function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

interface DropdownItem {
  icon: ReactNode
  iconColor: string
  label: string
  bg: string
  muted?: boolean
  action?: () => void
}

export default function NewDropdown() {
  const { t } = useTranslation()
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
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

  const newItems: DropdownItem[] = [
    {
      icon: <Globe size={16} strokeWidth={1.75} />,
      iconColor: '#1976D2',
      label: t('newDropdown.httpEndpoint'),
      bg: '#E3F2FD',
      action: () => createProtocolTab('http', t('welcome.newEndpointName'), 'GET'),
    },
    {
      icon: <FileCode2 size={16} strokeWidth={1.75} />,
      iconColor: '#E65100',
      label: t('newDropdown.soapMethod'),
      bg: '#FFF3E0',
      action: () => createProtocolTab('soap', t('welcome.newSoapMethodName')),
    },
    {
      icon: <Radio size={16} strokeWidth={1.75} />,
      iconColor: '#00838F',
      label: t('newDropdown.websocket'),
      bg: '#E0F7FA',
      action: () => createProtocolTab('websocket', t('welcome.websocket')),
    },
    {
      icon: <Cpu size={16} strokeWidth={1.75} />,
      iconColor: '#6A1B9A',
      label: t('newDropdown.graphql'),
      bg: '#F3E5F5',
      action: () => createProtocolTab('graphql', t('welcome.graphql')),
    },
    {
      icon: <Bot size={16} strokeWidth={1.75} />,
      iconColor: '#5E35B1',
      label: t('newDropdown.aiSse'),
      bg: '#EDE7F6',
      action: () => createProtocolTab('ai', t('welcome.aiSseName')),
    },
    {
      icon: <Hexagon size={16} strokeWidth={1.75} />,
      iconColor: '#2E7D32',
      label: t('newDropdown.grpc'),
      bg: '#E8F5E9',
      action: () => createProtocolTab('grpc', t('welcome.grpc'), 'POST'),
    },
    {
      icon: <Activity size={16} strokeWidth={1.75} />,
      iconColor: '#0277BD',
      label: t('newDropdown.sse'),
      bg: '#E1F5FE',
      action: () => createProtocolTab('sse', t('welcome.sse')),
    },
  ]

  const otherItems: { icon: ReactNode; label: string; shortcut: string; action?: () => void }[] = [
    {
      icon: <Download size={14} />,
      label: t('newDropdown.import'),
      shortcut: '\u2318O',
      action: () => {
        setOpen(false)
        setShowImportModal(true)
      },
    },
    { icon: <Code2 size={14} />, label: t('newDropdown.importCurl'), shortcut: '\u2318I' },
  ]

  const dropdown = open
    ? createPortal(
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
          <div className="mb-2 ml-1 font-medium uppercase tracking-widest text-[var(--hint)]">
            {t('leftPanel.new')}
          </div>
          <div className="mb-2 grid grid-cols-2 gap-1">
            {newItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex items-center gap-2 rounded-lg px-2.5 py-[7px] transition-colors hover:bg-[var(--bg)]"
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
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
                  style={{ background: item.bg, color: item.iconColor }}
                >
                  {item.icon}
                </div>
                {item.label}
              </button>
            ))}
          </div>

          {/* Separator */}
          <div className="border-t border-[var(--border)] pt-2">
            <div className="mb-1 uppercase tracking-widest text-[var(--hint)]">
              {t('newDropdown.other')}
            </div>
            {otherItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--text)] transition-colors hover:bg-[var(--bg)]"
                style={{
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
                <span className="flex w-5 items-center text-[var(--muted)]">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <span className="text-[var(--hint)]">{item.shortcut}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null

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
