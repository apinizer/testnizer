import { useState, useRef, useEffect } from 'react'
import { Check, ChevronDown, Eye, Layers, Globe } from 'lucide-react'
import { useEnvironmentStore } from '../../stores/environment.store'
import { useUIStore } from '../../stores/ui.store'

/**
 * Postman-style environment selector.
 *
 * Renders as a compact pill showing the current environment name (or
 * "No environment"). Clicking opens a dropdown listing all environments
 * + a "No environment" option + a link to open the environment manager.
 *
 * Used in the request tab bar (right-aligned), matching Postman's location.
 */
export default function EnvironmentSelector() {
  const environments = useEnvironmentStore((s) => s.environments)
  const activeEnvId = useEnvironmentStore((s) => s.activeEnvironmentId)
  const setActiveEnvironment = useEnvironmentStore((s) => s.setActiveEnvironment)
  const setShowEnvironmentModal = useUIStore((s) => s.setShowEnvironmentModal)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const activeEnv = environments.find((e) => e.id === activeEnvId) || null

  return (
    <div ref={rootRef} className="relative flex items-center" style={{ height: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 text-[12px]"
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '3px 8px',
          color: activeEnv ? 'var(--text)' : 'var(--muted)',
          height: 24,
          maxWidth: 220,
        }}
        title="Environment"
      >
        <Layers size={12} style={{ color: activeEnv ? 'var(--accent)' : 'var(--muted)' }} />
        <span className="truncate">{activeEnv?.name || 'No environment'}</span>
        <ChevronDown size={11} style={{ color: 'var(--muted)' }} />
      </button>

      {/* Quick-view variables button (eye icon) — opens environment manager */}
      <button
        type="button"
        onClick={() => setShowEnvironmentModal(true)}
        title="Environment quick look"
        className="cursor-pointer"
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderLeft: 'none',
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          color: 'var(--muted)',
          height: 24,
          width: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: -1,
        }}
      >
        <Eye size={12} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-[70] mt-1 overflow-hidden rounded-[8px]"
          style={{
            minWidth: 260,
            background: 'var(--white)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-drop)',
          }}
        >
          {/* No environment */}
          <button
            type="button"
            onClick={() => {
              setActiveEnvironment(null)
              setOpen(false)
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px]"
            style={{
              background: activeEnvId === null ? 'var(--accent-light)' : 'transparent',
              border: 'none',
              color: 'var(--text)',
            }}
            onMouseEnter={(e) => {
              if (activeEnvId !== null) (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
            }}
            onMouseLeave={(e) => {
              if (activeEnvId !== null) (e.currentTarget as HTMLElement).style.background = 'transparent'
            }}
          >
            <Globe size={12} style={{ color: 'var(--muted)' }} />
            <span className="flex-1">No environment</span>
            {activeEnvId === null && <Check size={12} style={{ color: 'var(--accent)' }} />}
          </button>

          {environments.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-split)' }} />
          )}

          <div className="max-h-[280px] overflow-y-auto">
            {environments.map((env) => {
              const isActive = env.id === activeEnvId
              return (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => {
                    setActiveEnvironment(env.id)
                    setOpen(false)
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px]"
                  style={{
                    background: isActive ? 'var(--accent-light)' : 'transparent',
                    border: 'none',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    fontWeight: isActive ? 600 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  <Layers size={12} style={{ color: isActive ? 'var(--accent)' : 'var(--muted)' }} />
                  <span className="flex-1 truncate">{env.name}</span>
                  {isActive && <Check size={12} style={{ color: 'var(--accent)' }} />}
                </button>
              )
            })}
          </div>

          <div style={{ borderTop: '1px solid var(--border-split)' }} />

          <button
            type="button"
            onClick={() => {
              setShowEnvironmentModal(true)
              setOpen(false)
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[12px]"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-text)',
              fontWeight: 500,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--item-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            Manage Environments
          </button>
        </div>
      )}
    </div>
  )
}
