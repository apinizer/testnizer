/**
 * Paste a cURL command into the HTTP URL bar (issue #278) — Postman's
 * "paste cURL into the request URL box". The command is parsed by the shared
 * parser (`src/shared/curl/`, issue #279 — the same one `import:curl` uses,
 * all three shells) and REPLACES the active request through the request
 * store's own setters (so the URL ⇄ Params sync, the dirty dot and the
 * credential-withhold tracking all run as for a typed edit). The previous
 * request is snapshotted first; `undo()` puts it back exactly, dirty flag and
 * tab-strip method included.
 *
 * What the pasted command does not say is reset to the new-request default
 * rather than kept from the old request: the command is the whole request.
 * Auth (`pastedAuth`): an auth flag maps to its type; a credential header
 * (stays a header) → "No Auth"; neither → "Inherit" (folder / project auth
 * still applies). Settings the command does not set return to
 * follow-redirects on (5), SSL verification on, inherited timeout.
 *
 * No DOM, no toast — the UrlBar wiring is `components/layout/CurlPasteToast.tsx`.
 */
import { useRequestStore } from '../stores/request.store'
import { useTabsStore } from '../stores/tabs.store'
import { makeId } from './utils'
import {
  curlToRequest,
  looksLikeCurl,
  parseCurl,
  type CurlDialect,
  type CurlWarning,
} from '../../shared/curl'
import { isCredentialHeaderName } from '../../shared/credential-headers'
import { requestSslVerification } from '../../shared/request-settings'
import type { AuthConfig, HttpMethod, KeyValuePair, RequestBody, Tab } from '../types'

type RequestSlice = Pick<
  ReturnType<typeof useRequestStore.getState>,
  | 'method'
  | 'url'
  | 'params'
  | 'headers'
  | 'body'
  | 'auth'
  | 'followRedirects'
  | 'maxRedirects'
  | 'sslVerification'
  | 'requestTimeout'
  | 'withheldCredentials'
>

export type CurlPasteResult =
  | { status: 'ignored' }
  | { status: 'no-url'; dialect: CurlDialect; warnings: CurlWarning[] }
  | { status: 'applied'; dialect: CurlDialect; warnings: CurlWarning[]; undo: () => boolean }

/** One parser warning in the UI language (`curlPaste.warning.<code>`, `{arg}` filled). */
export function curlWarningText(t: (key: string) => string, w: CurlWarning): string {
  const key = `curlPaste.warning.${w.code}`
  const text = t(key)
  return text === key ? w.message : text.replace('{arg}', w.arg ?? '')
}

/**
 * Auth of a pasted command: its own auth flag (`-u`, `--oauth2-bearer`) wins;
 * a credential header (`Authorization`, `X-API-Key`, … — `isCredentialHeaderName`)
 * means the command authenticates itself → "No Auth", so no second auth
 * header is added; otherwise "Inherit", so a request inside a folder with
 * folder / project auth keeps it.
 */
export function pastedAuth(
  auth: AuthConfig | undefined,
  headers: ReadonlyArray<{ key: string }>,
): AuthConfig {
  if (auth) return auth
  return headers.some((h) => isCredentialHeaderName(h.key.trim()))
    ? { type: 'none' }
    : { type: 'inherit' }
}

/** Only the HTTP request editor turns a paste into a request (other protocols keep plain paste). */
export function isHttpEditorTab(tab: Pick<Tab, 'protocol'> | undefined): boolean {
  return !tab || tab.protocol === 'http' || tab.protocol === undefined
}

function snapshot(): RequestSlice {
  const s = useRequestStore.getState()
  return {
    method: s.method,
    url: s.url,
    params: s.params,
    headers: s.headers,
    body: s.body,
    auth: s.auth,
    followRedirects: s.followRedirects,
    maxRedirects: s.maxRedirects,
    sslVerification: s.sslVerification,
    requestTimeout: s.requestTimeout,
    withheldCredentials: s.withheldCredentials,
  }
}

/**
 * Parse `text` and, when it is a cURL command with a URL, replace the active
 * HTTP request with it. `ignored` = not a cURL command (let the browser paste).
 */
export function applyCurlPaste(text: string): CurlPasteResult {
  if (!looksLikeCurl(text)) return { status: 'ignored' }
  const tabs = useTabsStore.getState()
  const tab = tabs.tabs.find((t) => t.id === tabs.activeTabId)
  if (!isHttpEditorTab(tab)) return { status: 'ignored' }

  const parsed = parseCurl(text)
  if (!parsed.url) return { status: 'no-url', dialect: parsed.dialect, warnings: parsed.warnings }
  const req = curlToRequest(parsed, { makeId })

  const before = snapshot()
  const tabId = tab?.id ?? null
  const wasDirty = tab?.isDirty ?? false
  const tabMethod = tab?.method

  const store = useRequestStore.getState()
  store.setMethod(req.method as HttpMethod)
  // Clear first so the old request's disabled param rows do not survive the URL merge.
  store.setParams([])
  store.setUrl(req.url)
  store.setHeaders(req.headers as KeyValuePair[])
  store.setBody(req.body as RequestBody)
  store.setAuth(pastedAuth(req.auth as AuthConfig | undefined, req.headers))
  // Issue #287: only what the command says (`-L` / `--no-location` / `-k`)
  // is an override; otherwise the request inherits the project / app setting.
  // A curl command's `followRedirects` is always its own flag (never a legacy
  // row value), so it is taken as is.
  store.setFollowRedirects(req.settings.followRedirects ?? null)
  store.setMaxRedirects(req.settings.maxRedirects ?? 5)
  store.setSslVerification(requestSslVerification(req.settings) ?? null)
  store.setRequestTimeout(req.settings.timeout ?? null)
  // The old request's withheld-credential markers (issue #244) point at values
  // the pasted request replaced — Ctrl+S must not refill them from the row.
  useRequestStore.setState({ withheldCredentials: [] })

  const undo = (): boolean => {
    const now = useTabsStore.getState()
    if ((now.activeTabId ?? null) !== tabId) return false
    useRequestStore.setState(before)
    if (tabId) {
      now.updateTab(tabId, { method: tabMethod })
      now.markDirty(tabId, wasDirty)
    }
    return true
  }
  return { status: 'applied', dialect: parsed.dialect, warnings: req.warnings, undo }
}
