import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Wrench,
  KeyRound,
  Braces,
  Code2,
  Binary,
  GitCompare,
  Search,
  FileSearch,
  FileCode,
  Shuffle,
  Shield,
} from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'
import type { ToolProtocol } from '../../types'

interface ToolItem {
  protocol: ToolProtocol
  Icon: typeof Wrench
  labelKey: string
  bg: string
  color: string
}

const TOOL_ITEMS: ToolItem[] = [
  {
    protocol: 'tools.jwt',
    Icon: KeyRound,
    labelKey: 'tools.jwt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.jsonFormat',
    Icon: Braces,
    labelKey: 'tools.json.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xmlFormat',
    Icon: Code2,
    labelKey: 'tools.xml.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.encode',
    Icon: Binary,
    labelKey: 'tools.encode.title',
    bg: '#e8f9f1',
    color: '#1a7a4a',
  },
  {
    protocol: 'tools.diff',
    Icon: GitCompare,
    labelKey: 'tools.diff.title',
    bg: '#fff0f0',
    color: '#cc2200',
  },
  {
    protocol: 'tools.jsonpath',
    Icon: Search,
    labelKey: 'tools.jsonpath.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
  {
    protocol: 'tools.xpath',
    Icon: FileSearch,
    labelKey: 'tools.xpath.title',
    bg: '#fff4e0',
    color: '#b35a00',
  },
  {
    protocol: 'tools.xslt',
    Icon: FileCode,
    labelKey: 'tools.xslt.title',
    bg: '#f0faf5',
    color: '#0a7a5a',
  },
  {
    protocol: 'tools.jolt',
    Icon: Shuffle,
    labelKey: 'tools.jolt.title',
    bg: '#eeecfe',
    color: '#5b52d4',
  },
  {
    protocol: 'tools.wsSecurity',
    Icon: Shield,
    labelKey: 'tools.wsse.title',
    bg: '#e8f4ff',
    color: '#0066cc',
  },
]

export default function ToolsDropdown() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const openToolTab = useTabsStore((s) => s.openToolTab)

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }, [])

  useEffect(() => {
    if (open) updatePosition()
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

  const handleSelect = (item: ToolItem) => {
    openToolTab(item.protocol, t(item.labelKey))
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('tools.menuTooltip')}
        className="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors"
        style={{
          background: open ? 'var(--accent-light)' : 'transparent',
          color: open ? 'var(--accent-text)' : 'var(--text)',
          borderColor: open ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <Wrench size={14} aria-hidden="true" />
        {t('tools.menu')}
      </button>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-lg border shadow-lg"
            style={{
              top: pos.top,
              right: pos.right,
              background: 'var(--white)',
              borderColor: 'var(--border)',
              animation: 'slideDown 120ms ease-out',
            }}
          >
            <div
              className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                color: 'var(--muted)',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {t('tools.menu')}
            </div>
            {TOOL_ITEMS.map((item) => (
              <button
                key={item.protocol}
                onClick={() => handleSelect(item)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--surface)]"
                style={{ background: 'transparent', border: 'none', color: 'var(--text)' }}
              >
                <div
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{ background: item.bg, color: item.color }}
                >
                  <item.Icon size={14} />
                </div>
                <span>{t(item.labelKey)}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
