/**
 * The app's copy-to-clipboard button. Behaviour lives in `lib/use-copy`.
 *
 * This merges the two identical private copies that had drifted into
 * `JwkTool` and `jwt/atoms` (both of which swallowed clipboard failures).
 * `jwt/atoms` now re-exports this one, so existing imports keep working.
 *
 * `ariaLabel` is REQUIRED on purpose. A single JWT panel renders five buttons
 * whose accessible name was the glyph "⧉", and the Diff tool renders two that
 * both read "Copy" while copying different sides. Making the name a mandatory
 * prop means the compiler asks every call site what exactly it copies — which
 * also matters for the private-JWK button, whose generic "Copy" never said it
 * was putting a private key on the clipboard.
 */
import { useTranslation } from '../../lib/i18n'
import { useCopy } from '../../lib/use-copy'

const GREEN = 'var(--green, #1a7a4a)'

export interface CopyButtonProps {
  text: string
  /** Accessible name — say WHAT is copied, e.g. "Copy private JWK". */
  ariaLabel: string
  /** Visible text; the ⧉ glyph is used when omitted. */
  label?: string
  className?: string
}

export default function CopyButton({ text, ariaLabel, label, className }: CopyButtonProps) {
  const { t } = useTranslation()
  const { copied, copy } = useCopy()

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={ariaLabel}
      title={copied ? t('tools.common.copied') : ariaLabel}
      className={className ?? 'rounded border px-1.5 py-0.5 text-[11px]'}
      style={{
        borderColor: 'var(--border)',
        background: 'var(--white)',
        color: copied ? GREEN : 'var(--muted)',
      }}
    >
      {copied ? '✓' : (label ?? '⧉')}
    </button>
  )
}
