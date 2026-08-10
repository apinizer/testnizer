/**
 * Generated passwords, with the two things the old list lacked: a visible
 * confirmation when one is copied (the header literally invites the click), and
 * a note when the options have moved on since these were produced.
 */
import CopyButton from '../../shared/CopyButton'
import { useCopy } from '../../../lib/use-copy'
import type { StrengthLevel } from '../../../lib/tools/password-generator'
import type { Tr } from './atoms'

const STRENGTH_META: Record<StrengthLevel, { labelKey: string; color: string; pct: number }> = {
  'very-weak': { labelKey: 'tools.passwordGen.strengthVeryWeak', color: '#cc2200', pct: 20 },
  weak: { labelKey: 'tools.passwordGen.strengthWeak', color: '#e0821a', pct: 40 },
  fair: { labelKey: 'tools.passwordGen.strengthFair', color: '#b38f00', pct: 60 },
  strong: { labelKey: 'tools.passwordGen.strengthStrong', color: '#1a7a4a', pct: 80 },
  'very-strong': { labelKey: 'tools.passwordGen.strengthVeryStrong', color: '#0a7a5a', pct: 100 },
}

export function StrengthBar({
  bits,
  strength,
  t,
}: {
  bits: number
  strength: StrengthLevel
  t: Tr
}) {
  const s = STRENGTH_META[strength]
  return (
    <div
      className="shrink-0 border-b px-3 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
    >
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span style={{ color: s.color, fontWeight: 600 }}>{t(s.labelKey)}</span>
        <span style={{ color: 'var(--muted)' }}>
          ~{Math.round(bits)} {t('tools.passwordGen.entropyBits')}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded"
        style={{ background: 'var(--surface)' }}
      >
        <div className="h-full rounded" style={{ width: `${s.pct}%`, background: s.color }} />
      </div>
    </div>
  )
}

export default function OutputList({
  output,
  stale,
  t,
}: {
  output: string[]
  /** True once the options changed after these were generated. */
  stale: boolean
  t: Tr
}) {
  const rowCopy = useCopy()

  return (
    <>
      <div
        className="flex shrink-0 items-center justify-between border-b px-3 py-1.5 text-xs"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <span style={{ color: 'var(--muted)' }}>
          {output.length} {t('tools.passwordGen.generated')}
          {/*
            Marked stale, NOT cleared: these are the user's output and they may
            be halfway through copying one. Verdicts get cleared; artifacts get
            labelled.
          */}
          {stale ? (
            <span style={{ color: 'var(--orange, #b35a00)' }}>
              {' · '}
              {t('tools.common.staleOutput')}
            </span>
          ) : null}
          {rowCopy.copied ? (
            <span style={{ color: 'var(--green, #1a7a4a)' }}>
              {' · '}
              {t('tools.common.copied')}
            </span>
          ) : null}
        </span>
        <CopyButton
          text={output.join('\n')}
          label={`⧉ ${t('tools.common.copy')}`}
          ariaLabel={t('tools.passwordGen.copyAll')}
          className="rounded border px-2 py-0.5 text-[11px]"
        />
      </div>
      <div
        className="flex-1 overflow-auto p-3 font-mono text-sm"
        style={{ opacity: stale ? 0.55 : 1 }}
      >
        {output.map((pw, i) => (
          <button
            key={i}
            type="button"
            className="block w-full cursor-pointer rounded px-2 py-1 text-left break-all hover:bg-[var(--surface)]"
            onClick={() => void rowCopy.copy(pw)}
            aria-label={`${t('tools.common.copy')}: ${pw}`}
            title={t('tools.common.copy')}
            style={{ color: 'var(--text)' }}
          >
            {pw}
          </button>
        ))}
      </div>
    </>
  )
}
