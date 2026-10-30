/**
 * The network settings BELOW a request's own on the Send path (issue #287):
 * the project's `project.<id>.settings` (Certificates pane: SSL verification +
 * TLS protocol / ciphers; General pane: follow redirects; Proxy pane) and the
 * app Settings' `sslVerification` / `followRedirects` / `proxy` (issue #254:
 * the app proxy is the fallback when the project configures none) /
 * `defaultTimeout` (shown by the project dialog as the inherited value).
 *
 * ONE loader + ONE payload builder for every Send that goes out through
 * `request:send` — HTTP (`request.store.ts`), SOAP (`soap.store.ts`) and
 * GraphQL (`graphql.store.ts`) — resolved with the same shared resolvers Run
 * uses (`src/shared/request-settings.ts`), so Send ≡ Run. The request
 * Settings tab reads the same loader to show the inherited value.
 */
import {
  resolveFollowRedirects,
  resolveProxy,
  resolveSslVerification,
  type ProxySetting,
} from '../../shared/request-settings'

export interface ProjectNetSettings {
  requestTimeout?: number
  sslVerification?: boolean
  followRedirects?: boolean
  proxy?: ProxySetting
  tls?: {
    minVersion?: string
    maxVersion?: string
    cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
    ciphersCustom?: string
  }
}

export interface InheritedNetwork {
  /** `project.<id>.settings` as `settings:get` returns it (`{}` when none). */
  project: ProjectNetSettings
  /** App Settings `sslVerification` — `undefined` when unreadable. */
  appSslVerification?: boolean
  /** App Settings `followRedirects`. */
  appFollowRedirects?: boolean
  /** App Settings `proxy` (password decrypted by `settings:get`), issue #254. */
  appProxy?: ProxySetting
  /** App Settings `defaultTimeout` (ms), issue #254 — display only; Send reads it itself. */
  appTimeout?: number
}

type SettingsResult = { success?: boolean; data?: unknown } | undefined

async function readSetting(key: string): Promise<unknown> {
  try {
    const res = (await window.api?.settings?.get(key)) as SettingsResult
    return res?.success ? res.data : undefined
  } catch {
    return undefined
  }
}

const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)

/** Best effort: any failure reads as "not set" (the resolvers then verify / follow). */
export async function loadInheritedNetwork(
  projectId: string | null | undefined,
): Promise<InheritedNetwork> {
  const [project, appSsl, appFollow, appProxy, appTimeout] = await Promise.all([
    projectId ? readSetting(`project.${projectId}.settings`) : Promise.resolve(undefined),
    readSetting('sslVerification'),
    readSetting('followRedirects'),
    readSetting('proxy'),
    readSetting('defaultTimeout'),
  ])
  return {
    project:
      project && typeof project === 'object' && !Array.isArray(project)
        ? (project as ProjectNetSettings)
        : {},
    appSslVerification: bool(appSsl),
    appFollowRedirects: bool(appFollow),
    appProxy: isObj(appProxy) ? (appProxy as ProxySetting) : undefined,
    appTimeout:
      typeof appTimeout === 'number' && Number.isFinite(appTimeout) && appTimeout >= 0
        ? appTimeout
        : undefined,
  }
}

const isObj = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)

/** The proxy Send uses: the project's own, else the app Settings proxy (issue #254). */
export function effectiveProxy(net: InheritedNetwork): ProxySetting | undefined {
  return resolveProxy(net.project.proxy, net.appProxy)
}

/** The value a request inherits when its own is `null` (Settings tab display). */
export function inheritedSslVerification(net: InheritedNetwork): boolean {
  return resolveSslVerification(null, net.project.sslVerification, net.appSslVerification)
}

export function inheritedFollowRedirects(net: InheritedNetwork): boolean {
  return resolveFollowRedirects(null, net.project.followRedirects, net.appFollowRedirects)
}

/**
 * The network part of a `request:send` payload: SSL verification and redirects
 * through the shared request → project → app chain, plus the project's TLS
 * (the preset NAME — main resolves it, `resolveTlsPayload`) and the proxy
 * (`resolveProxy`: project → app, the rule Run uses too).
 */
export function networkPayload(
  request: { sslVerification?: boolean | null; followRedirects?: boolean | null },
  net: InheritedNetwork,
): {
  sslVerification: boolean
  followRedirects: boolean
  proxy?: ProxySetting
  tls?: {
    minVersion?: string
    maxVersion?: string
    cipherPreset?: 'modern' | 'intermediate' | 'legacy' | 'custom'
    ciphersCustom?: string
  }
} {
  const tls = net.project.tls
  return {
    sslVerification: resolveSslVerification(
      request.sslVerification,
      net.project.sslVerification,
      net.appSslVerification,
    ),
    followRedirects: resolveFollowRedirects(
      request.followRedirects,
      net.project.followRedirects,
      net.appFollowRedirects,
    ),
    proxy: effectiveProxy(net),
    tls: tls
      ? {
          minVersion: tls.minVersion || undefined,
          maxVersion: tls.maxVersion || undefined,
          cipherPreset: tls.cipherPreset,
          ciphersCustom: tls.ciphersCustom,
        }
      : undefined,
  }
}
