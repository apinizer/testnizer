/**
 * Project Settings → General: may this project's scripts run on this computer?
 * Same anatomy as the row above it. Main owns the state and shows the prompt;
 * Allow only opens it (`projectTrust:ensure`), Block is the safe direction. A
 * machine-local state, so it takes effect at once rather than on Save Changes.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { formatCount } from '../../lib/plural'
import type { ProjectTrustStatus } from '../../types'

export default function ProjectScriptTrustRow({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<ProjectTrustStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<ProjectTrustStatus | null> => {
    const res = await window.api?.projectTrust?.status(projectId)
    return res?.success && res.data ? res.data : null
  }, [projectId])

  useEffect(() => {
    let live = true
    void load().then((next) => {
      if (live) setStatus(next)
    })
    return () => {
      live = false
    }
  }, [load])

  const act = async (call: () => Promise<unknown> | undefined): Promise<void> => {
    setBusy(true)
    try {
      await call()
      setStatus(await load())
    } finally {
      setBusy(false)
    }
  }

  if (!status) return null
  const hint = status.blocked
    ? formatCount(
        status.scriptCount,
        t('general.scriptTrustBlockedOne'),
        t('general.scriptTrustBlocked'),
      )
    : t('general.scriptTrustAllowed')

  return (
    <div
      className="flex items-start gap-3 border-b border-dashed border-[var(--border)] py-2"
      data-testid="project-script-trust"
      data-blocked={status.blocked}
    >
      <div className="flex-1">
        <div className="text-[var(--text)]">{t('general.scriptTrust')}</div>
        <div className="mt-0.5 text-[var(--muted)]" data-testid="project-script-trust-state">
          {hint}
        </div>
      </div>
      {status.blocked ? (
        <button
          type="button"
          disabled={busy}
          data-testid="project-script-trust-allow"
          className="cursor-pointer whitespace-nowrap rounded-[7px] border-none bg-[var(--accent)] px-4 py-2 font-semibold text-white disabled:cursor-default disabled:opacity-60"
          onClick={() =>
            void act(() => window.api?.projectTrust?.ensure(projectId, { hasScript: true }))
          }
        >
          {t('general.scriptTrustAllow')}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          data-testid="project-script-trust-block"
          className="cursor-pointer whitespace-nowrap rounded-[7px] border border-[var(--border)] bg-transparent px-4 py-2 font-semibold text-[var(--text)] disabled:cursor-default disabled:opacity-60"
          onClick={() => void act(() => window.api?.projectTrust?.block(projectId))}
        >
          {t('general.scriptTrustBlock')}
        </button>
      )}
    </div>
  )
}
