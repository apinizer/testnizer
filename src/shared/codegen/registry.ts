/**
 * The Generate Code catalogue (issue #280): Language → Variant, Postman's
 * grouping. cURL first (the default), then alphabetical. Variant ids are
 * globally unique; the 11 ids that existed before #280 (`curl`, `js-fetch`,
 * `js-axios`, `python-requests`, `java-okhttp`, `go`, `php`, `ruby`, `swift`,
 * `kotlin`, `csharp`) are kept as variant ids.
 */
import { resolveOptions } from './options'
import type { CodegenLanguage, CodegenOptions, CodegenRequest, CodegenVariant } from './types'
import { cLibcurl } from './langs/c-libcurl'
import { csharpHttpClient } from './langs/csharp-httpclient'
import { csharpRestsharp } from './langs/csharp-restsharp'
import { curlBash, curlCmd, curlPowershell } from './langs/curl'
import { dartDio } from './langs/dart-dio'
import { dartHttp } from './langs/dart-http'
import { goNetHttp } from './langs/go'
import { httpRaw } from './langs/http-raw'
import { javaOkhttp } from './langs/java-okhttp'
import { javaUnirest } from './langs/java-unirest'
import { jsFetch } from './langs/js-fetch'
import { jsJquery, jsXhr } from './langs/js-xhr'
import { kotlinOkhttp } from './langs/kotlin-okhttp'
import { nodeAxios } from './langs/node-axios'
import { nodeNative } from './langs/node-native'
import { nodeRequest } from './langs/node-request'
import { nodeUnirest } from './langs/node-unirest'
import { objcNsurlsession } from './langs/objc-nsurlsession'
import { ocamlCohttp } from './langs/ocaml-cohttp'
import { phpCurl } from './langs/php-curl'
import { phpGuzzle } from './langs/php-guzzle'
import { phpHttpRequest2 } from './langs/php-http-request2'
import { phpPeclHttp } from './langs/php-pecl-http'
import { powershellRestMethod } from './langs/powershell-restmethod'
import { pythonHttpClient } from './langs/python-http-client'
import { pythonRequests } from './langs/python-requests'
import { rHttr } from './langs/r-httr'
import { rRcurl } from './langs/r-rcurl'
import { rubyNetHttp } from './langs/ruby'
import { rustReqwest } from './langs/rust-reqwest'
import { shellHttpie, shellWget } from './langs/shell'
import { swiftUrlSession } from './langs/swift'

export const CODEGEN_LANGUAGES: readonly CodegenLanguage[] = [
  { id: 'curl', label: 'cURL', variants: [curlBash, curlCmd, curlPowershell] },
  { id: 'c', label: 'C', variants: [cLibcurl] },
  { id: 'csharp', label: 'C#', variants: [csharpHttpClient, csharpRestsharp] },
  { id: 'dart', label: 'Dart', variants: [dartHttp, dartDio] },
  { id: 'go', label: 'Go', variants: [goNetHttp] },
  { id: 'http', label: 'HTTP', variants: [httpRaw] },
  { id: 'java', label: 'Java', variants: [javaOkhttp, javaUnirest] },
  { id: 'javascript', label: 'JavaScript', variants: [jsFetch, jsXhr, jsJquery] },
  { id: 'kotlin', label: 'Kotlin', variants: [kotlinOkhttp] },
  { id: 'nodejs', label: 'NodeJS', variants: [nodeAxios, nodeNative, nodeRequest, nodeUnirest] },
  { id: 'objective-c', label: 'Objective-C', variants: [objcNsurlsession] },
  { id: 'ocaml', label: 'OCaml', variants: [ocamlCohttp] },
  { id: 'php', label: 'PHP', variants: [phpCurl, phpGuzzle, phpHttpRequest2, phpPeclHttp] },
  { id: 'powershell', label: 'PowerShell', variants: [powershellRestMethod] },
  { id: 'python', label: 'Python', variants: [pythonRequests, pythonHttpClient] },
  { id: 'r', label: 'R', variants: [rHttr, rRcurl] },
  { id: 'ruby', label: 'Ruby', variants: [rubyNetHttp] },
  { id: 'rust', label: 'Rust', variants: [rustReqwest] },
  { id: 'shell', label: 'Shell', variants: [shellWget, shellHttpie] },
  { id: 'swift', label: 'Swift', variants: [swiftUrlSession] },
]

const BY_ID = new Map<string, CodegenVariant>()
for (const lang of CODEGEN_LANGUAGES) for (const v of lang.variants) BY_ID.set(v.id, v)

export const ALL_VARIANTS: readonly CodegenVariant[] = [...BY_ID.values()]

export function findVariant(id: string): CodegenVariant | undefined {
  return BY_ID.get(id)
}

export function findLanguage(id: string): CodegenLanguage | undefined {
  return CODEGEN_LANGUAGES.find((l) => l.id === id)
}

/** The language a variant belongs to. */
export function languageOfVariant(variantId: string): CodegenLanguage | undefined {
  const v = BY_ID.get(variantId)
  return v ? findLanguage(v.language) : undefined
}

/** Render a normalised request with a variant (options defaulted). */
export function renderSnippet(
  variantId: string,
  req: CodegenRequest,
  options?: CodegenOptions,
): string {
  const v = BY_ID.get(variantId)
  if (!v) return `// Code generation for ${variantId} is not supported yet.`
  return v.generate(req, resolveOptions(v.options, options))
}
