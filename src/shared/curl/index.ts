/**
 * cURL in three dialects (bash / Windows CMD / PowerShell) — generate and
 * parse (issue #279). Pure TS, compiled into both bundles:
 *  - main: `import:curl` / `export:curl` (`import-export.handler.ts`);
 *  - renderer: the URL-bar paste (issue #278), the Generate Code `curl`
 *    snippet, mock and MCP "Copy as cURL".
 */
export * from './types'
export { detectDialect, stripPrompt, tokenizeShell, msvcrtSplit, psNativeArg } from './tokenize'
export type { TokenizeResult } from './tokenize'
export { parseCurl, parseCurlAs, looksLikeCurl, startsWithCurl, curlUrlEncode } from './parse'
export type { ParseCurlOptions } from './parse'
export { curlToRequest, paramsFromUrl, CURL_HTTP_METHODS } from './to-request'
export type {
  CurlRequest,
  CurlRequestBody,
  CurlRequestAuth,
  CurlKv,
  CurlFormKv,
  CurlBodyType,
  CurlToRequestOptions,
} from './to-request'
export {
  quoteCurlArg,
  renderCurl,
  curlArgsFor,
  curlInlineCount,
  generateCurl,
  curlCommandWord,
} from './generate'
export type { CurlArg, RenderCurlOptions, CurlGenRequest, CurlArgsOptions } from './generate'
