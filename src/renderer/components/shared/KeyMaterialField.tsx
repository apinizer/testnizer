import { useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import KeyMaterialPicker, {
  type KeyMaterialFilter,
  type KeyMaterialSelection,
} from './KeyMaterialPicker'
import { describeSource } from '../../lib/key-material'
import type { MaterialSource } from '../../types'

/**
 * The ADDED, NON-DEFAULT "Use from keystore / Security" control (#60).
 *
 * Renders next to a consumer's existing pasted-PEM / file inputs and never
 * replaces them: with nothing selected the consumer's config is byte-for-byte
 * the pre-#60 shape. Selecting a source stores an OPAQUE `MaterialSource`
 * (ids/aliases/paths) — main resolves it at execution time; the renderer never
 * sees key bytes.
 */
export default function KeyMaterialField({
  value,
  label,
  onChange,
  filter = 'privateKey',
  projectId,
  hint,
  requireRemembered = false,
}: {
  value: MaterialSource | null | undefined
  /** Label captured at pick time; falls back to a derived description. */
  label?: string | null
  /** `null` clears the source → the consumer falls back to its default path. */
  onChange: (selection: KeyMaterialSelection | null) => void
  filter?: KeyMaterialFilter
  projectId?: string
  hint?: string
  /** Consumers that PERSIST the selection must require a remembered store. */
  requireRemembered?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-1">
      {value ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className="rounded px-2 py-0.5"
            style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}
          >
            {label || describeSource(value)}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer rounded border px-2 py-0.5 text-xs"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--muted)',
              background: 'var(--white)',
            }}
          >
            {t('keyMaterial.change')}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="cursor-pointer rounded border px-2 py-0.5 text-xs"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--muted)',
              background: 'var(--white)',
            }}
          >
            {t('keyMaterial.usePasted')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer rounded border px-2 py-0.5 text-xs"
          style={{
            borderColor: 'var(--border)',
            color: 'var(--accent-text)',
            background: 'var(--white)',
          }}
        >
          {t('keyMaterial.useKeystore')}
        </button>
      )}
      <div className="text-[10px]" style={{ color: 'var(--hint)' }}>
        {hint ?? t('keyMaterial.optionalHint')}
      </div>
      <KeyMaterialPicker
        open={open}
        onClose={() => setOpen(false)}
        onSelect={(sel) => onChange(sel)}
        filter={filter}
        projectId={projectId}
        value={value ?? null}
        requireRemembered={requireRemembered}
      />
    </div>
  )
}
