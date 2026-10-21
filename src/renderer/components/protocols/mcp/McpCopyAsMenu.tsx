import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useEnvironmentStore } from '../../../stores/environment.store'
import { useTranslation } from '../../../lib/i18n'
import { useCopy } from '../../../lib/use-copy'
import { toast } from '../../../lib/toast'
import { buildJsonRpc, copyTargetOf, curlOf } from '../../../lib/mcp-copy-as'
import { activeSecretVariableNames, snippetVariables } from '../../../lib/secret-variables'
import IncludeSecretsToggle from '../../shared/IncludeSecretsToggle'
import { positionAnchoredMenu, type MenuPosition } from '../../../lib/menu-position'
import type { McpCapabilityTab } from '../../../types/mcp'

const ITEM =
  'flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2.5 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * "Copy as…" next to Invoke / Read / Get (issue #174): the call as a JSON-RPC
 * request, or (Streamable HTTP) a cURL command with credentials masked.
 *
 * The menu renders in a body portal with fixed positioning (review item 11):
 * the action bar lives in an `overflow-y-auto` header, which clipped the old
 * absolutely-positioned menu. It opens above the button and flips below when
 * there is no room (`positionAnchoredMenu`).
 */
export default function McpCopyAsMenu({ capability }: { capability: McpCapabilityTab }) {
  const { t } = useTranslation()
  const { copied, copy } = useCopy()
  const transport = useMcpStore((s) => s.transport)
  const [open, setOpen] = useState(false)
  // "Include secret values" — one copy only: every close resets it, so a
  // later copy keeps `{{name}}` for a secret variable again (Generate Code rule).
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const close = (): void => {
    setOpen(false)
    setIncludeSecrets(false)
  }
  const [pos, setPos] = useState<MenuPosition | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      // The menu is a portal, not a DOM child of `ref`: a click on an item is inside.
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
      setIncludeSecrets(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      setIncludeSecrets(false)
    }
    // A fixed menu would drift from its button — close instead.
    const onMove = (e: Event): void => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      setOpen(false)
      setIncludeSecrets(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const button = ref.current?.getBoundingClientRect()
    const menu = menuRef.current?.getBoundingClientRect()
    if (!button || !menu) return
    setPos(
      positionAnchoredMenu({
        anchorLeft: button.left,
        anchorTop: button.top,
        anchorBottom: button.bottom,
        width: menu.width,
        height: menu.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    )
  }, [open])

  const run = (format: 'jsonrpc' | 'curl'): void => {
    close()
    const s = useMcpStore.getState()
    const env = useEnvironmentStore.getState()
    // A secret variable stays `{{name}}` unless the user ticked the opt-in.
    const vars = snippetVariables(
      env.getActiveVariables(),
      activeSecretVariableNames(env),
      includeSecrets,
    )
    const target = copyTargetOf(s, capability, vars)
    if (!target) {
      toast.error(t('mcp.call.copyInvalid'))
      return
    }
    void copy(
      format === 'curl' ? curlOf(s, target, vars) : JSON.stringify(buildJsonRpc(target), null, 2),
    )
  }

  // Dynamic placement (measured) — inline style is the documented exception.
  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? 0,
    top: pos?.top ?? 0,
    ...(pos?.maxHeight !== undefined ? { maxHeight: pos.maxHeight, overflowY: 'auto' } : {}),
    // Measured first, shown once placed.
    visibility: pos ? 'visible' : 'hidden',
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="mcp-copy-as"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-transparent px-2 text-[12px] text-[var(--muted)] hover:bg-[var(--surface)]"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {t('mcp.call.copyAs')}
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="z-[9999] min-w-[14rem] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--white)] py-1 shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="mcp-copy-jsonrpc"
              className={ITEM}
              onClick={() => run('jsonrpc')}
            >
              {t('mcp.call.copyJsonRpc')}
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="mcp-copy-curl"
              className={ITEM}
              disabled={transport !== 'http'}
              title={transport !== 'http' ? t('mcp.call.curlHttpOnly') : undefined}
              onClick={() => run('curl')}
            >
              {t('mcp.call.copyCurl')}
            </button>
            <div className="mt-1 border-t border-[var(--border)] px-2.5 pt-1.5 pb-0.5">
              <IncludeSecretsToggle
                checked={includeSecrets}
                onChange={setIncludeSecrets}
                testId="mcp-copy-include-secrets"
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
