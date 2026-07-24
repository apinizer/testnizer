import type { MaterialSource, WsSecurityConfig } from '../types'

/**
 * Renderer-side helpers for the Key Material Provider (#60).
 *
 * A `MaterialSource` is OPAQUE — ids, aliases and paths only — so everything a
 * consumer can render about it is derived from those identifiers. No key bytes
 * are involved here (and none are ever available in the renderer for a
 * provider-backed source).
 */

/**
 * The WRITE-ONLY fields a `MaterialSource` may carry. They are typed by the
 * user once, travel to main inside a send payload, and must never reach a
 * persistence boundary (localStorage or `endpoints.metadata`) — see
 * `stripSourceSecrets`.
 */
const WRITE_ONLY_FIELDS = ['storePassword', 'keyPassword', 'passphrase'] as const

/**
 * Returns the source without its write-only password fields.
 *
 * Referentially honest on purpose: when there is nothing to strip (no source,
 * or a source that carries no password) the SAME object is returned, so a
 * config that predates #60 is persisted byte-for-byte as before — the additive
 * invariant is preserved by identity, not by hand-checking each field.
 */
export function stripSourceSecrets(
  source: MaterialSource | null | undefined,
): MaterialSource | null | undefined {
  if (!source) return source
  const bag = source as unknown as Record<string, unknown>
  if (!WRITE_ONLY_FIELDS.some((k) => k in bag)) return source
  const clean: Record<string, unknown> = { ...bag }
  for (const k of WRITE_ONLY_FIELDS) delete clean[k]
  return clean as unknown as MaterialSource
}

/**
 * Same contract as `stripSourceSecrets`, lifted to a whole WS-Security config:
 * the only secret-bearing member is `sign.keySource` (the pasted PEM fields are
 * the pre-#60 path and are deliberately still persisted). Returns the SAME
 * config object when there is nothing to strip.
 */
export function stripWsSecuritySecrets<T extends WsSecurityConfig>(config: T): T {
  const keySource = config?.sign?.keySource
  const cleaned = stripSourceSecrets(keySource)
  if (cleaned === keySource) return config
  return {
    ...config,
    sign: { ...config.sign, keySource: cleaned as MaterialSource | undefined },
  } as T
}

/** Human label for a stored source, used when a consumer persisted no label. */
export function describeSource(source: MaterialSource | null | undefined): string {
  if (!source) return ''
  switch (source.kind) {
    case 'keystore':
      return `keystore '${source.keystoreId}' › ${source.alias}`
    case 'certRow':
      return `certificate ${source.certificateId}`
    case 'file':
      return source.pfxPath || source.certPath || 'file'
    case 'inline':
      return 'pasted PEM'
    default:
      return ''
  }
}
