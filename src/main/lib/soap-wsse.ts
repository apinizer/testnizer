/**
 * SOAP editor WS-Security on the wire — the single owner for Send and Run
 * (tester report 2026-10-30).
 *
 * The SOAP editor sends the user's own envelope (`rawXml`) through the HTTP
 * engine. Before this helper existed, Send swapped WS-Security for an HTTP
 * Basic header and Run ignored the saved `metadata.soap.wsSecurity`: neither
 * put a `wsse:Security` header in the envelope. Both paths now call
 * `applySoapWsSecurityToBody` right before `executeHttpRequest`:
 *
 *   - Send: `request:send` (`ipc/request.handler.ts`) with the `_wsSecurity`
 *     payload `soap.store.sendSoap` passes;
 *   - Run:  `runner.handler.ts` with the row's `metadata.soap.wsSecurity`.
 *
 * Callers pass an envelope AND a config whose `{{var}}` are already resolved
 * (`resolveWsSecurityVariables`, src/shared/soap-wsse.ts): the signature is
 * computed over the final bytes, so nothing may change the body afterwards.
 * Key material is resolved here, in main (keystore-bridge rule) — the renderer
 * only ever holds an opaque `keySource`.
 *
 * `soap:execute` (`executeSoap`) is a different entry point: it builds its own
 * envelope from the operation and params; it shares the engine, not this file.
 */

import {
  applyWsSecurity,
  migrateLegacyConfig,
  type WsSecurityConfig,
} from '../protocols/wsse.engine'
import { resolveWsseKeyMaterial } from './wsse-key-material'
import { isWsSecurityEnabled } from '../../shared/soap-wsse'

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The engine's multi-mode shape. A row an old build wrote carries the legacy
 * single-mode fields (`type: 'username-token'`, `username`, `password`); the
 * editor merges it over its default, so it may also carry an EMPTY `modes`
 * array — which `migrateLegacyConfig` would take as "already migrated" and
 * apply nothing. Both paths go through here, so they agree on that row.
 */
export function toEngineWsSecurity(raw: unknown): WsSecurityConfig {
  if (!isRecord(raw)) return { enabled: false, modes: [] }
  const hasModes = Array.isArray(raw.modes) && raw.modes.length > 0
  if (!hasModes && typeof raw.type === 'string') {
    const { modes: _modes, ...legacy } = raw
    void _modes
    return migrateLegacyConfig(legacy)
  }
  return migrateLegacyConfig(raw)
}

/**
 * The credential values a WS-Security config puts on the wire — the
 * UsernameToken password (PasswordText sends it verbatim). Fed to the value
 * scrub of History, the Console and the Runner results; a password too short
 * for the value scan is still masked there by the `wsse:Password` name rule.
 */
export function wsSecuritySecretValues(raw: unknown): string[] {
  if (!isWsSecurityEnabled(raw) || !isRecord(raw)) return []
  const out: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v) out.push(v)
  }
  if (isRecord(raw.usernameToken)) push(raw.usernameToken.password)
  push(raw.password)
  return out
}

/**
 * Apply WS-Security to an already-resolved envelope. A disabled config returns
 * the envelope unchanged; an enabled one that cannot be applied (no SOAP
 * Envelope, signing without key material, …) throws — the request must fail
 * visibly instead of going out without the security the user configured.
 */
export async function applySoapWsSecurity(envelope: string, raw: unknown): Promise<string> {
  if (!isWsSecurityEnabled(raw)) return envelope
  const config = resolveWsseKeyMaterial(toEngineWsSecurity(raw))
  return applyWsSecurity(envelope, config)
}

/** The part of an HTTP-engine request body this helper reads. */
interface BodyLike {
  type?: string
  content?: string
}

/**
 * `applySoapWsSecurity` over an HTTP-engine body: returns a NEW body whose
 * `content` is the secured envelope (the input is not mutated). With
 * WS-Security off the same body object comes back.
 */
export async function applySoapWsSecurityToBody<B extends BodyLike>(
  body: B | undefined,
  raw: unknown,
): Promise<B | undefined> {
  if (!isWsSecurityEnabled(raw)) return body
  const content = typeof body?.content === 'string' ? body.content : ''
  const secured = await applySoapWsSecurity(content, raw)
  return { ...(body ?? ({} as B)), type: body?.type ?? 'xml', content: secured }
}
