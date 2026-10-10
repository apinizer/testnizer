import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { AI_PROVIDERS, type AiProvider, type AiProviderInfo } from '../../../stores/ai-chat.store'

export function ProviderAvatar({
  info,
  size = 18,
}: {
  info: AiProviderInfo
  size?: number
}): ReactElement {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-md font-bold text-white"
      style={{
        width: size,
        height: size,
        background: info.color,
        fontSize: Math.max(10, Math.floor(size * 0.6)),
      }}
    >
      {info.letter}
    </span>
  )
}

export default function ProviderSelect({
  value,
  onChange,
}: {
  value: AiProvider
  onChange: (v: AiProvider) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  const current = AI_PROVIDERS.find((p) => p.id === value) ?? AI_PROVIDERS[0]

  useEffect(() => {
    if (!open) return
    const update = (): void => {
      if (!buttonRef.current) return
      const r = buttonRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    const onMouseDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 text-left text-[var(--text)] transition-colors hover:border-[var(--accent)]"
        style={{ fontSize: 13 }}
      >
        <ProviderAvatar info={current} />
        <span className="flex-1 truncate">{current.label}</span>
        <ChevronDown size={12} style={{ color: 'var(--muted)' }} />
      </button>
      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9000] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--white)]"
            style={{
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, 220),
              maxHeight: 320,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}
          >
            {AI_PROVIDERS.map((p) => {
              const isActive = p.id === value
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left"
                  style={{
                    background: isActive ? 'var(--accent-light)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    border: 'none',
                    fontSize: 13,
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background = 'var(--surface)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <ProviderAvatar info={p} />
                  <span className="flex-1 truncate">{p.label}</span>
                  {isActive && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
