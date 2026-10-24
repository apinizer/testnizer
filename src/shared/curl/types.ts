/**
 * Shared cURL model (issue #279) — the neutral shapes the tokenizer, the
 * parser, the request converter and the snippet generator exchange.
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles
 * (the main-process `import:curl` importer and the renderer URL-bar paste).
 * The request shapes below are STRUCTURAL subsets of the renderer types
 * (`RequestBody`, `AuthConfig`, `KeyValuePair`), the same way
 * `http-auto-headers.ts` mirrors them, so `src/shared` never imports from
 * `src/renderer`.
 */

/** The three shells a cURL command is written for. */
export type CurlDialect = 'bash' | 'cmd' | 'powershell'

export const CURL_DIALECTS: readonly CurlDialect[] = ['bash', 'cmd', 'powershell']

export type CurlWarningCode =
  /** A flag this parser does not know — skipped, its value (if any) is not guessed. */
  | 'unknown-flag'
  /** A known flag whose effect cannot be represented on a Testnizer request (proxy, client cert…). */
  | 'unsupported-flag'
  /** `@file` / `<file` / `-T file` — the file is NOT read; see the message for what was kept. */
  | 'file-reference'
  /** A value-taking flag at the very end of the command. */
  | 'missing-value'
  /** A second URL — curl would request it too; only the first is used. */
  | 'extra-url'
  /** A stray word that is neither a flag, a flag value nor the URL. */
  | 'ignored-arg'
  /** `$VAR`, `$(…)` or a backtick substitution — kept literally, never expanded. */
  | 'shell-expansion'
  /** A quote that never closes — the rest of the text was taken as its content. */
  | 'unterminated-quote'
  /** `| jq`, `; echo`, `&& …` — everything after the curl command is ignored. */
  | 'pipeline-ignored'
  /** A method the HTTP editor cannot select (e.g. `-X PURGE`). */
  | 'unsupported-method'
  /** `-I` together with data and no `-G` (curl itself refuses this) — the data was dropped. */
  | 'head-with-data'
  /** `-u user` with no `:password` — curl would prompt; the password is left empty. */
  | 'password-prompt'
  /** `--next` — only the first request of the command is imported. */
  | 'next-ignored'
  /** `-b file` (a cookie FILE, not `name=value`) — not read. */
  | 'cookie-file'
  /** `-F 'name=value;type=…'` on a TEXT part — the per-part type cannot be stored. */
  | 'form-type-ignored'

export interface CurlWarning {
  code: CurlWarningCode
  /** The flag / word / path the warning is about. */
  arg?: string
  /** English text (the importer IPC returns it as-is; the renderer translates by `code`). */
  message: string
}

/** One `-d` / `--data-*` / `--json` occurrence, in command order. */
export interface CurlDataPart {
  kind: 'data' | 'data-ascii' | 'data-binary' | 'data-raw' | 'data-urlencode' | 'json'
  /** What curl puts on the wire for this part (`--data-urlencode` already encoded). */
  value: string
  /** `@path` — the bytes come from this file (never read here). */
  file?: string
}

/** One `-F` / `--form-string` occurrence. */
export interface CurlFormPart {
  name: string
  /** Text value, or the display file name for a file part. */
  value: string
  kind: 'text' | 'file' | 'text-file'
  /** `@path` (file part) or `<path` (text read from a file). */
  path?: string
  /** `;type=` modifier. */
  contentType?: string
  /** `;filename=` modifier. */
  filename?: string
}

export interface CurlHeader {
  key: string
  value: string
}

export type CurlAuthScheme = 'basic' | 'digest' | 'ntlm' | 'negotiate' | 'anyauth'

/** Everything the command says, before any Testnizer-specific decision. */
export interface ParsedCurl {
  dialect: CurlDialect
  /** Effective method by curl's own rules (`-X` > `-I` > `-G` > data/form > `-T` > GET). */
  method: string
  /** True when `-X/--request` set it. */
  methodExplicit: boolean
  /** The request URL; with `-G` the data is already appended to its query. */
  url: string
  /** `-H`, `-A`, `-e`, `-b`… in command order, duplicates kept. */
  headers: CurlHeader[]
  data: CurlDataPart[]
  form: CurlFormPart[]
  /** The joined body curl would send (absent with `-G`, `-I`, or no data). */
  body?: string
  user?: { username: string; password: string }
  authScheme?: CurlAuthScheme
  bearer?: string
  cookies: string[]
  get: boolean
  head: boolean
  insecure: boolean
  /** `-L` / `--location(-trusted)`; absent = not said. */
  followRedirects?: boolean
  maxRedirects?: number
  maxTimeSeconds?: number
  connectTimeoutSeconds?: number
  compressed: boolean
  /** `-T file`. */
  uploadFile?: string
  warnings: CurlWarning[]
}
