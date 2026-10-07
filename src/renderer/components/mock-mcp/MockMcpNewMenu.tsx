import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus } from 'lucide-react'
import { useTranslation } from '../../lib/i18n'
import {
  MOCK_MCP_PRESET_HINT_KEYS,
  MOCK_MCP_PRESET_IDS,
  MOCK_MCP_PRESET_LABEL_KEYS,
  type MockMcpPresetId,
} from './mock-mcp-presets'

const MENU_WIDTH = 256

/**
 * "+ New" for Mock MCP servers: a small menu of presets (Echo is the default
 * starting point). Closes on outside click and Escape. Rendered in a portal
 * with fixed positioning — the Mocks panel list scrolls, and an absolutely
 * positioned menu inside it would be clipped / extend the scroll area.
 */
export default function MockMcpNewMenu({
  onCreate,
  disabled,
}: {
  onCreate: (preset: MockMcpPresetId) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const open = pos !== null
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = (): void => setPos(null)

  const toggle = (): void => {
    if (open) {
      close()
      return
    }
    const r = buttonRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPos(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid="mock-mcp-new"
        title={t('mockMcp.new')}
        aria-label={t('mockMcp.new')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={toggle}
        className="flex h-6 cursor-pointer items-center gap-1 rounded-md border-none bg-[var(--accent)] px-2 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={12} strokeWidth={2.5} />
        {t('mockMcp.newShort')}
      </button>
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-testid="mock-mcp-new-menu"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            className="fixed z-[1000] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--white)] py-1 shadow-lg"
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--hint)]">
              {t('mockMcp.presets')}
            </div>
            {MOCK_MCP_PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                data-testid={`mock-mcp-preset-${id}`}
                onClick={() => {
                  close()
                  onCreate(id)
                }}
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-none bg-transparent px-3 py-1.5 text-left hover:bg-[var(--surface)]"
              >
                <span className="text-[12px] font-medium text-[var(--text)]">
                  {t(MOCK_MCP_PRESET_LABEL_KEYS[id])}
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  {t(MOCK_MCP_PRESET_HINT_KEYS[id])}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
