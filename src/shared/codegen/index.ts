/**
 * Code generation (issue #280) — pure TS, compiled into both bundles.
 *   normalize  — request editor state → `CodegenRequest` (URL, headers, auth, body)
 *   registry   — Language → Variant catalogue and `renderSnippet`
 *   langs/     — one small file per variant; quoting through `quote.ts`
 * cURL variants delegate to `src/shared/curl/` (the one cURL quoting engine).
 */
export * from './types'
export { normalizeRequest, graphqlJson } from './normalize'
export {
  CODEGEN_LANGUAGES,
  ALL_VARIANTS,
  findVariant,
  findLanguage,
  languageOfVariant,
  renderSnippet,
} from './registry'
export { resolveOptions } from './options'
export { curlVariantId, curlDialectOf } from './langs/curl'
export { buildSnippetUrl, encodeSnippetUrl, encodeQueryPart } from './url'
export { base64Utf8 } from './base64'
