/**
 * URL ⇄ Params-tab sync (issue #22) — one implementation for every editor
 * with a Params tab: HTTP (`request.store`), WebSocket and Socket.IO
 * (issues #282 / #283). The URL bar and the Params rows stay in lockstep
 * without encoding (so `{{vars}}` survive intact, matching what the URL bar
 * renders) and without losing disabled rows (they never appear in the URL).
 */
import type { KeyValuePair } from '../types'
import { makeId } from './utils'

function buildQueryString(params: KeyValuePair[]): string {
  return params
    .filter((p) => p.enabled && p.key.trim() !== '')
    .map((p) => (p.value !== '' ? `${p.key}=${p.value}` : p.key))
    .join('&')
}

/** Rewrite the URL's query string from the current params (enabled only). */
export function applyParamsToUrl(url: string, params: KeyValuePair[]): string {
  const base = url.split('?')[0]
  const qs = buildQueryString(params)
  return qs ? `${base}?${qs}` : base
}

/**
 * Derive params from the URL's query, preserving any disabled rows the user
 * set in the Params tab (those never appear in the URL). Enabled rows are
 * rebuilt from the query.
 */
export function mergeParamsFromUrl(url: string, existing: KeyValuePair[]): KeyValuePair[] {
  const qIdx = url.indexOf('?')
  const fromUrl: KeyValuePair[] = []
  if (qIdx !== -1) {
    const qs = url.slice(qIdx + 1)
    for (const pair of qs.split('&')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? '' : pair.slice(eq + 1)
      fromUrl.push({ id: makeId(), key, value, enabled: true })
    }
  }
  const disabled = existing.filter((p) => !p.enabled)
  return [...fromUrl, ...disabled]
}
