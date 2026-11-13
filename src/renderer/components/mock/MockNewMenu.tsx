/**
 * The Mocks panel header "+": a small type menu (HTTP / MCP / SSE / AI),
 * styled like the APIs panel's New menu. Picking an entry opens the "New mock
 * server" dialog with that type preselected (`onPick`).
 *
 * Keyboard (WAI-ARIA menu button): Enter / Space / ArrowDown on the "+" open
 * the menu with focus on the first entry (ArrowUp: on the last); ArrowUp /
 * ArrowDown move with wrap-around, Home / End jump to the ends, Enter picks.
 * Escape closes the menu and returns focus to the "+"; Tab closes it too.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Activity, Bot, Cloud, Globe, Plus } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import type { MockKind } from './new-mock-server'

interface MenuItem {
  kind: MockKind
  labelKey: string
  icon: ReactNode
  /** Icon tile colours — theme-aware pairs from globals.css (literal for Tailwind). */
  tileClass: string
}

const ITEMS: readonly MenuItem[] = [
  {
    kind: 'http',
    labelKey: 'mockNew.addHttp',
    icon: <Globe size={16} strokeWidth={1.75} />,
    tileClass: 'bg-[var(--mb-get-bg)] text-[var(--mb-get-fg)]',
  },
  {
    kind: 'mcp',
    labelKey: 'mockMcp.new',
    icon: <Cloud size={16} strokeWidth={1.75} />,
    tileClass: 'bg-[var(--mb-options-bg)] text-[var(--mb-options-fg)]',
  },
  {
    kind: 'sse',
    labelKey: 'mockNew.addSse',
    icon: <Activity size={16} strokeWidth={1.75} />,
    tileClass: 'bg-[var(--mb-options-bg)] text-[var(--mb-options-fg)]',
  },
  {
    kind: 'ai',
    labelKey: 'mockNew.addAi',
    icon: <Bot size={16} strokeWidth={1.75} />,
    tileClass: 'bg-[var(--mb-head-bg)] text-[var(--mb-head-fg)]',
  },
]

export default function MockNewMenu({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (kind: MockKind) => void
}) {
  const { t } = useTranslation()
  // Index of the entry that gets focus when the menu opens; null = closed.
  const [openAt, setOpenAt] = useState<number | null>(null)
  const open = openAt !== null
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const close = useCallback((returnFocus: boolean) => {
    setOpenAt(null)
    if (returnFocus) buttonRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left })
  }, [open])

  // Focus moves into the menu when it opens.
  useEffect(() => {
    if (openAt !== null) itemRefs.current[openAt]?.focus()
  }, [openAt])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close(false)
    }
    // The one Escape owner: wherever focus is, Escape closes the menu.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close(true)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  function pick(kind: MockKind): void {
    close(false)
    onPick(kind)
  }

  function focusItem(index: number): void {
    const n = ITEMS.length
    itemRefs.current[((index % n) + n) % n]?.focus()
  }

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement)
    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    switch (e.key) {
      case 'ArrowDown':
        handled()
        focusItem(current + 1)
        break
      case 'ArrowUp':
        handled()
        focusItem(current < 0 ? ITEMS.length - 1 : current - 1)
        break
      case 'Home':
        handled()
        focusItem(0)
        break
      case 'End':
        handled()
        focusItem(ITEMS.length - 1)
        break
      case 'Enter':
        if (current >= 0) {
          handled()
          pick(ITEMS[current].kind)
        }
        break
      case 'Tab':
        handled()
        close(true)
        break
    }
  }

  function onButtonKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    e.stopPropagation()
    setOpenAt(e.key === 'ArrowDown' ? 0 : ITEMS.length - 1)
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('mock.newServer')}
          data-testid="mock-new-menu"
          onKeyDown={onMenuKeyDown}
          className="fixed z-[9999] w-64 animate-[slideDown_0.15s_ease] rounded-xl border border-[var(--border)] bg-[var(--white)] p-2 shadow-[var(--shadow-drop)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-1 ml-1 font-medium uppercase tracking-widest text-[var(--hint)]">
            {t('mock.newServer')}
          </div>
          {ITEMS.map((item, i) => (
            <button
              key={item.kind}
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-testid={`mock-new-option-${item.kind}`}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-none bg-transparent px-2.5 py-[7px] text-left text-[var(--text)] transition-colors hover:bg-[var(--bg)] focus:bg-[var(--bg)]"
              onClick={() => pick(item.kind)}
            >
              <div
                aria-hidden="true"
                className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] ${item.tileClass}`}
              >
                {item.icon}
              </div>
              {t(item.labelKey)}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="mock-new"
        title={t('mock.newServer')}
        aria-label={t('mock.newServer')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpenAt((v) => (v === null ? 0 : null))
        }}
        onKeyDown={onButtonKeyDown}
        className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[7px] border-none bg-[var(--accent)] text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>
      {menu}
    </div>
  )
}
