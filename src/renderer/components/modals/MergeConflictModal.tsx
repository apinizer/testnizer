import { useState } from 'react'
import { useBranchStore, type ConflictEntry, type ConflictStats } from '../../stores/branch.store'
import { useTranslation } from '../../lib/i18n'
import Modal from '../shared/Modal'

/**
 * Renders when a merge or pull leaves the working tree with at least one
 * conflicted file. Three-way manual editing is intentionally not offered —
 * project state is one big JSON, and a binary "use mine / use theirs"
 * choice resolves the realistic case (divergent collections) without
 * asking the user to read structural diffs.
 *
 * Lifecycle:
 *  - branch.store.pendingConflict is set after a merge/pull returns conflicts
 *  - This modal is mounted unconditionally in AppShell; visibility is driven
 *    by `pendingConflict !== null`
 *  - Resolution per file calls store.resolveConflict; once the last conflict
 *    clears, the store nulls out pendingConflict and we unmount
 */
// Busy state is a per-side tag so the UI can disable BOTH cards while
// resolving but show the spinner only on the one being processed. `null`
// means idle; `aborting` blocks both cards too.
type BusyState = { kind: 'resolving'; side: 'ours' | 'theirs' } | { kind: 'aborting' } | null

export default function MergeConflictModal() {
  const { t } = useTranslation()
  const conflict = useBranchStore((s) => s.pendingConflict)
  const resolveConflict = useBranchStore((s) => s.resolveConflict)
  const abortConflict = useBranchStore((s) => s.abortConflict)
  const [activeFileIdx, setActiveFileIdx] = useState(0)
  const [busy, setBusy] = useState<BusyState>(null)
  const [error, setError] = useState<string | null>(null)

  if (!conflict) return null

  // Clamp active index in case the resolved-files list shrunk underneath us.
  const fileIdx = Math.min(activeFileIdx, conflict.conflicts.length - 1)
  const current: ConflictEntry | undefined = conflict.conflicts[fileIdx]
  if (!current) return null

  async function pick(side: 'ours' | 'theirs'): Promise<void> {
    if (!current) return
    setBusy({ kind: 'resolving', side })
    setError(null)
    const r = await resolveConflict(
      current.file,
      side,
      // Locale-aware so collaborators see the commit message in whichever
      // language the resolver uses. Falls back inside the handler if blank.
      `${t('mergeConflict.commitMessage')} (${t(`mergeConflict.${side}`)})`,
    )
    setBusy(null)
    if (!r.success) {
      setError(r.error || t('mergeConflict.resolveFailed'))
      return
    }
    if (!r.complete) setActiveFileIdx(0)
  }

  async function abort(): Promise<void> {
    setBusy({ kind: 'aborting' })
    setError(null)
    const r = await abortConflict()
    setBusy(null)
    if (!r.success) setError(r.error || t('mergeConflict.abortFailed'))
  }

  const sides = [
    {
      side: 'ours' as const,
      title: t('mergeConflict.ours'),
      subtitle: t('mergeConflict.oursSubtitle'),
      stats: current.stats.ours,
      accent: '#0066cc',
      accentBg: '#e8f4ff',
    },
    {
      side: 'theirs' as const,
      title: t('mergeConflict.theirs'),
      subtitle:
        conflict.origin === 'merge'
          ? (conflict.sourceBranch ?? '')
          : t('mergeConflict.theirsSubtitlePull'),
      stats: current.stats.theirs,
      accent: '#1a7a4a',
      accentBg: '#e8f9f1',
    },
  ]

  return (
    <Modal
      open={conflict !== null}
      onOpenChange={(o) => {
        if (!o && busy === null) void abort()
      }}
      title="Merge conflict"
      zIndex={100}
      preventClose={busy !== null}
    >
      <div
        className="flex w-[640px] max-w-[92vw] flex-col rounded-lg shadow-xl outline-none"
        style={{ background: 'var(--white)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }} aria-hidden="true">
              ⚠️
            </span>
            <div>
              <div
                id="merge-conflict-title"
                className="text-sm font-semibold"
                style={{ color: 'var(--text)' }}
              >
                {conflict.origin === 'merge'
                  ? t('mergeConflict.titleMerge')
                  : t('mergeConflict.titlePull')}
              </div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {conflict.origin === 'merge'
                  ? `${conflict.sourceBranch} → ${conflict.currentBranch}`
                  : conflict.currentBranch}
              </div>
            </div>
          </div>
          <span
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{ background: 'var(--accentLight)', color: 'var(--accentText)' }}
          >
            {conflict.conflicts.length} {t('mergeConflict.files')}
          </span>
        </div>

        {/* File tabs (one strip per conflicted file) */}
        {conflict.conflicts.length > 1 && (
          <div
            className="flex gap-1 overflow-x-auto border-b px-3 py-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {conflict.conflicts.map((c, i) => (
              <button
                key={c.file}
                onClick={() => setActiveFileIdx(i)}
                className="rounded px-2 py-1 text-xs font-mono transition-colors"
                style={{
                  background: i === fileIdx ? 'var(--white)' : 'transparent',
                  color: i === fileIdx ? 'var(--accentText)' : 'var(--muted)',
                  border: '1px solid',
                  borderColor: i === fileIdx ? 'var(--accentText)' : 'var(--border)',
                }}
              >
                {c.file}
              </button>
            ))}
          </div>
        )}

        {/* Body — file label + side-by-side stats */}
        <div className="px-5 py-4">
          <div className="mb-1 font-mono text-xs font-semibold" style={{ color: 'var(--text)' }}>
            {current.file}
          </div>
          <div className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
            {t('mergeConflict.description')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {sides.map((s) => (
              <SideCard
                key={s.side}
                title={s.title}
                subtitle={s.subtitle}
                stats={s.stats}
                accent={s.accent}
                accentBg={s.accentBg}
                onPick={() => pick(s.side)}
                disabled={busy !== null}
                picking={busy?.kind === 'resolving' && busy.side === s.side}
                t={t}
              />
            ))}
          </div>

          {error && (
            <div
              className="mt-3 rounded border px-3 py-2 text-xs"
              style={{
                borderColor: '#cc2200',
                background: '#fff0f0',
                color: '#cc2200',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer — abort everything */}
        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
            {t('mergeConflict.footerHint')}
          </div>
          <button
            onClick={abort}
            disabled={busy !== null}
            className="rounded border px-3 py-1 text-xs font-medium transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--white)',
              color: '#cc2200',
              opacity: busy !== null ? 0.5 : 1,
              cursor: busy !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {busy?.kind === 'aborting' ? t('mergeConflict.aborting') : t('mergeConflict.abort')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

interface SideCardProps {
  title: string
  subtitle: string
  stats: ConflictStats
  accent: string
  accentBg: string
  onPick: () => void
  disabled: boolean
  picking: boolean
  t: (k: string) => string
}

function SideCard({
  title,
  subtitle,
  stats,
  accent,
  accentBg,
  onPick,
  disabled,
  picking,
  t,
}: SideCardProps) {
  // Hide rows with zero count to keep the card compact when one side has no
  // mocks / certificates etc.
  const rows: { label: string; value: number }[] = [
    { label: t('mergeConflict.endpoints'), value: stats.endpoints },
    { label: t('mergeConflict.savedRequests'), value: stats.savedRequests },
    { label: t('mergeConflict.folders'), value: stats.folders },
    { label: t('mergeConflict.environments'), value: stats.environments },
    { label: t('mergeConflict.testSuites'), value: stats.testSuites },
    { label: t('mergeConflict.mockServers'), value: stats.mockServers },
    { label: t('mergeConflict.mockEndpoints'), value: stats.mockEndpoints },
    { label: t('mergeConflict.certificates'), value: stats.certificates },
  ]
  const visibleRows = rows.filter((r) => r.value > 0)

  return (
    <div
      className="flex flex-col rounded-md border p-3"
      style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: accentBg, color: accent }}
        >
          {title}
        </span>
        <span className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
          {subtitle}
        </span>
      </div>
      <div className="flex-1 py-2">
        {!stats.parsable ? (
          <div className="text-xs italic" style={{ color: 'var(--muted)' }}>
            {t('mergeConflict.unparseable')}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="text-xs italic" style={{ color: 'var(--muted)' }}>
            {t('mergeConflict.empty')}
          </div>
        ) : (
          <div className="space-y-0.5 text-xs" style={{ color: 'var(--text)' }}>
            {visibleRows.map((r) => (
              <div key={r.label} className="flex items-center justify-between">
                <span style={{ color: 'var(--muted)' }}>{r.label}</span>
                <span className="tabular-nums font-medium">{r.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onPick}
        disabled={disabled}
        className="rounded px-3 py-1.5 text-xs font-semibold text-white transition-opacity"
        style={{
          background: accent,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {picking ? t('mergeConflict.applying') : `${t('mergeConflict.use')} ${title}`}
      </button>
    </div>
  )
}
