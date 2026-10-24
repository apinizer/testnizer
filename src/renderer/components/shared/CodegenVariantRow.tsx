import { useTranslation } from '../../lib/i18n'
import CurlVariantPicker from './CurlVariantPicker'
import CodegenOptionsPopover from './CodegenOptionsPopover'
import type { CodegenSelectionView } from './use-codegen-selection'

/**
 * The Variant row of the Generate Code surfaces (issue #280): the variants of
 * the selected language as a segmented control (the same anatomy as the
 * cURL shell switch, `CurlVariantPicker`, which cURL keeps — its shells ARE
 * the cURL variants) and the Options popover on the right.
 */
export default function CodegenVariantRow({ selection }: { selection: CodegenSelectionView }) {
  const { t } = useTranslation()
  const isCurl = selection.language.id === 'curl'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="codegen-variant-row">
      {isCurl ? (
        <CurlVariantPicker />
      ) : (
        <div
          role="group"
          aria-label={t('codeGen.variant')}
          className="flex items-center gap-0.5 rounded-md border border-[var(--border)] p-0.5"
        >
          {selection.language.variants.map((v) => {
            const active = v.id === selection.variant.id
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={active}
                data-testid={`codegen-variant-${v.id}`}
                onClick={() => selection.setVariant(v.id)}
                className={`flex cursor-pointer items-center rounded px-2 py-0.5 text-[11px] ${
                  active
                    ? 'bg-[var(--accent-light)] font-medium text-[var(--accent-text)]'
                    : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {v.label}
              </button>
            )
          })}
        </div>
      )}
      <CodegenOptionsPopover selection={selection} hidden={isCurl ? ['multiLine'] : []} />
    </div>
  )
}
