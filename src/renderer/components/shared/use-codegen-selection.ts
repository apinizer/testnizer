import { useMemo } from 'react'
import { useUIStore } from '../../stores/ui.store'
import {
  CODEGEN_LANGUAGES,
  curlDialectOf,
  curlVariantId,
  findLanguage,
  resolveOptions,
  type CodegenLanguage,
  type CodegenOptionValue,
  type CodegenOptions,
  type CodegenVariant,
} from '../../../shared/codegen'

export interface CodegenSelectionView {
  language: CodegenLanguage
  variant: CodegenVariant
  /** Effective options (defaults filled in). */
  options: CodegenOptions
  /** True when an option differs from its default. */
  customised: boolean
  setLanguage: (id: string) => void
  setVariant: (id: string) => void
  setOption: (id: string, value: CodegenOptionValue) => void
  resetOptions: () => void
}

/**
 * The Generate Code Language → Variant choice + per-variant options (issue
 * #280), from `ui.store` so the modal and the right panel agree. cURL's
 * variant is the shell in `curlSnippet.dialect` and its Multi-line option
 * `curlSnippet.multiLine` (issue #279) — one source, no copy.
 */
export function useCodegenSelection(): CodegenSelectionView {
  const codegen = useUIStore((s) => s.codegen)
  const curl = useUIStore((s) => s.curlSnippet)

  return useMemo(() => {
    const ui = useUIStore.getState()
    const language = findLanguage(codegen.language) ?? CODEGEN_LANGUAGES[0]
    const isCurl = language.id === 'curl'
    const wanted = isCurl ? curlVariantId(curl.dialect) : codegen.variantByLanguage[language.id]
    const variant = language.variants.find((v) => v.id === wanted) ?? language.variants[0]
    // cURL options belong to the language: switching the shell keeps them.
    const optionsKey = isCurl ? language.id : variant.id
    const stored = { ...codegen.optionsByVariant[optionsKey] }
    if (isCurl) stored.multiLine = curl.multiLine
    const options = resolveOptions(variant.options, stored)
    const customised = variant.options.some((d) => options[d.id] !== d.default)
    return {
      language,
      variant,
      options,
      customised,
      setLanguage: (id) => ui.setCodegenLanguage(id),
      setVariant: (id) => {
        const dialect = curlDialectOf(id)
        if (isCurl && dialect) ui.setCurlSnippet({ dialect })
        else ui.setCodegenVariant(language.id, id)
      },
      setOption: (id, value) => {
        if (isCurl && id === 'multiLine' && typeof value === 'boolean') {
          ui.setCurlSnippet({ multiLine: value })
        } else ui.setCodegenOption(optionsKey, id, value)
      },
      resetOptions: () => {
        ui.resetCodegenOptions(optionsKey)
        if (isCurl) ui.setCurlSnippet({ multiLine: true })
      },
    }
  }, [codegen, curl])
}
