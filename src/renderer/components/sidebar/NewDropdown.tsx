import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Globe,
  Radio,
  Activity,
  Cpu,
  Bot,
  FileCode2,
  Hexagon,
  Cloud,
  Zap,
  Plus,
} from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { makeTabId } from '../../lib/utils'
import type { Protocol } from '../../types'

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
  const openTab = useTabsStore((s) => s.openTab)

  function createProtocolTab(protocol: Protocol, name: string, method?: string) {
    const id = makeTabId()
    openTab({ id, name, protocol, method, url: '' })
    useRequestStore.getState().switchToTab(id)
    useResponseStore.getState().clearResponse()
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
      icon: <Zap size={16} strokeWidth={1.75} />,
      iconColor: '#7c52d4',
      label: t('newDropdown.quickRequest'),
      bg: '#eeecfe',
      action: () => createProtocolTab('http', t('welcome.quickRequest'), 'GET'),
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
    {
      icon: <Cloud size={16} strokeWidth={1.75} />,
      iconColor: '#0277BD',
      label: t('newDropdown.mcp'),
      bg: '#E1F5FE',
      action: () => createProtocolTab('mcp', t('welcome.mcp')),
    },
    {
      icon: <Zap size={16} strokeWidth={1.75} />,
      iconColor: '#E65100',
      label: t('newDropdown.socketio'),
      bg: '#FFF3E0',
      action: () => createProtocolTab('socketio', t('welcome.socketio')),
    },
    // Import entries: listed here too (issue #5) in addition to the dedicated
    // Import dropdown, since users expect them under the New (+) menu.
    {
      icon: <Plus size={16} strokeWidth={1.75} />,
      iconColor: '#5b52d4',
      label: t('newDropdown.import'),
      bg: '#eeecfe',
      action: () => {
        useUIStore.getState().setShowImportModal(true)
        setOpen(false)
      },
    },
    {
      icon: <FileCode2 size={16} strokeWidth={1.75} />,
      iconColor: '#1565c0',
      label: t('newDropdown.importCurl'),
      bg: '#e8f4ff',
      action: () => {
        useUIStore.getState().setShowImportModal(true, 'curl')
        setOpen(false)
      },
    },
  ]
  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          data-testid="new-dropdown-menu"
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
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]"
                  style={{ background: item.bg, color: item.iconColor }}
                >
                  {item.icon}
                </div>
                {item.label}
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
        data-testid="new-dropdown-btn"
        aria-label={t('leftPanel.new')}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        // Inline style mirrors TestsPanel / MockServersPanel exactly so the
        // three "+" buttons render at the same pixel size — leaning on
        // Tailwind sizing classes (h-7 w-7) for some panels and inline
        // width/height for others caused subtle drift across browsers.
        className="flex cursor-pointer items-center justify-center rounded-[7px] border-none"
        style={{ width: 28, height: 28, background: 'var(--accent)', color: '#fff' }}
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>
      {dropdown}
    </div>
  )
}
