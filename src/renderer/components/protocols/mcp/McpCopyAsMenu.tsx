import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy } from 'lucide-react'
import { useMcpStore } from '../../../stores/mcp.store'
import { useEnvironmentStore } from '../../../stores/environment.store'
import { useTranslation } from '../../../lib/i18n'
import { useCopy } from '../../../lib/use-copy'
import { toast } from '../../../lib/toast'
import { buildJsonRpc, copyTargetOf, curlOf } from '../../../lib/mcp-copy-as'
import type { McpCapabilityTab } from '../../../types/mcp'

const ITEM =
  'flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-2.5 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * "Copy as…" next to Invoke / Read / Get (issue #174): the call as a JSON-RPC
 * request, or (Streamable HTTP) a cURL command with credentials masked.
 */
export default function McpCopyAsMenu({ capability }: { capability: McpCapabilityTab }) {
  const { t } = useTranslation()
  const { copied, copy } = useCopy()
  const transport = useMcpStore((s) => s.transport)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (format: 'jsonrpc' | 'curl'): void => {
    setOpen(false)
    const s = useMcpStore.getState()
    const vars = useEnvironmentStore.getState().getActiveVariables()
    const target = copyTargetOf(s, capability, vars)
    if (!target) {
      toast.error(t('mcp.call.copyInvalid'))
      return
    }
    void copy(
      format === 'curl' ? curlOf(s, target, vars) : JSON.stringify(buildJsonRpc(target), null, 2),
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="mcp-copy-as"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] bg-transparent px-2 text-[12px] text-[var(--muted)] hover:bg-[var(--surface)]"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {t('mcp.call.copyAs')}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1 min-w-[14rem] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--white)] py-1 shadow-lg"
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
        </div>
      )}
    </div>
  )
}
