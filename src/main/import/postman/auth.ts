/**
 * Postman auth → Testnizer `AuthConfig` (issue #276).
 *
 * Testnizer carries: none, basic, bearer, api-key, oauth2, digest, ntlm,
 * aws-signature, hawk (`AuthType` in src/renderer/types/index.ts). Postman
 * types with a Testnizer counterpart map onto it and every attribute the
 * counterpart cannot hold is NAMED in a warning; types without one (oauth1,
 * edgegrid, jwt, asap, …) import as `none` with a warning that names the
 * request — they used to turn into `none` silently.
 *
 * Attribute keys follow `postman-runtime`'s authorizers (research §5). OAuth
 * 2.0 `grant_type` values are the ones Postman writes:
 * `authorization_code`, `authorization_code_with_pkce`, `implicit`,
 * `password_credentials` and `client_credentials` (`password` is accepted as
 * an alias).
 */
import type { PostmanAuth, PostmanAuthAttributes } from './types'
import { toText } from './normalize'

export type AuthConfigLike = { type: string } & Record<string, unknown>

/** One attribute from either the v2.1 array or the v2.0 object form. */
export function readAuthField(
  src: PostmanAuthAttributes | string | undefined,
  key: string,
): string {
  if (!src || typeof src === 'string') return ''
  if (Array.isArray(src)) {
    const hit = src.find((p) => p && p.key === key)
    return hit ? toText(hit.value) : ''
  }
  return key in src ? toText(src[key]) : ''
}

/** Every attribute with a non-empty value, as `key → text`. */
function attributes(src: PostmanAuthAttributes | string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!src || typeof src === 'string') return out
  const pairs: Array<[string, unknown]> = Array.isArray(src)
    ? src.filter((p) => p && typeof p.key === 'string').map((p) => [p.key, p.value])
    : Object.entries(src)
  for (const [k, v] of pairs) {
    const t = toText(v)
    if (t !== '') out.set(k, t)
  }
  return out
}

/** Name the attributes that were set but have nowhere to go. */
function dropped(
  attrs: Map<string, string>,
  ignore: (key: string, value: string) => boolean,
): string[] {
  const out: string[] = []
  for (const [k, v] of attrs) if (!ignore(k, v)) out.push(k)
  return out
}

const OAUTH2_CARRIED = new Set([
  'accessToken',
  'accessTokenUrl',
  'authUrl',
  'clientId',
  'clientSecret',
  'scope',
  'grant_type',
  'username',
  'password',
  'client_authentication',
  // v1 helper names (postman-collection-transformer legacy mapper).
  'grantType',
  'clientAuth',
  'refreshToken',
  // Postman bookkeeping / UI-only keys that carry no request behaviour.
  'tokenName',
  'tokenType',
  'useBrowser',
  'challengeAlgorithm',
  'addTokenTo',
  'headerPrefix',
])

function mapOAuth2(
  src: PostmanAuthAttributes | string | undefined,
  label: string,
  warnings: string[],
): AuthConfigLike {
  const a = attributes(src)
  const grantRaw = a.get('grant_type') ?? a.get('grantType') ?? ''
  let grantType: 'authorization_code' | 'client_credentials' | 'password' | 'implicit'
  const notes: string[] = []
  switch (grantRaw) {
    case 'authorization_code':
      grantType = 'authorization_code'
      break
    case 'authorization_code_with_pkce':
      grantType = 'authorization_code'
      notes.push('PKCE (imported as plain authorization code)')
      break
    case 'implicit':
      grantType = 'implicit'
      break
    case 'password':
    case 'password_credentials':
      grantType = 'password'
      break
    case 'client_credentials':
    case '':
      grantType = 'client_credentials'
      break
    default:
      grantType = 'client_credentials'
      notes.push(`grant type "${grantRaw}" (imported as client credentials)`)
  }
  const addTokenTo = a.get('addTokenTo')
  if (addTokenTo && addTokenTo !== 'header') notes.push(`token location "${addTokenTo}"`)
  const prefix = a.get('headerPrefix')
  if (prefix && prefix.trim() && prefix.trim() !== 'Bearer') notes.push(`header prefix "${prefix}"`)
  const extra = dropped(a, (k) => OAUTH2_CARRIED.has(k))
  if (extra.length > 0) notes.push(extra.join(', '))
  if (notes.length > 0) {
    warnings.push(
      `"${label}": OAuth 2.0 settings Testnizer has no field for were not imported: ${notes.join('; ')}. ` +
        'The token is always sent as an "Authorization: Bearer" header; browser flows (authorization code, implicit) need a pasted token.',
    )
  }
  const clientAuth = a.get('client_authentication') ?? a.get('clientAuth')
  const out: Record<string, unknown> = {
    grantType,
    tokenUrl: a.get('accessTokenUrl') ?? '',
    authUrl: a.get('authUrl') ?? '',
    clientId: a.get('clientId') ?? '',
    clientSecret: a.get('clientSecret') ?? '',
    scope: a.get('scope') ?? '',
    token: a.get('accessToken') ?? '',
  }
  if (grantType === 'password') {
    out.username = a.get('username') ?? ''
    out.password = a.get('password') ?? ''
  }
  if (clientAuth === 'body' || clientAuth === 'header') out.clientAuth = clientAuth
  if (a.get('refreshToken')) out.refreshToken = a.get('refreshToken')
  return { type: 'oauth2', oauth2: out }
}

/**
 * Map one Postman auth block. Returns null when there is no block (inherit),
 * `{type:'none'}` for `noauth` and for unsupported types (with a warning).
 */
export function mapPostmanAuth(
  auth: PostmanAuth | null | undefined,
  label: string,
  warnings: string[],
): AuthConfigLike | null {
  if (!auth || typeof auth !== 'object' || typeof auth.type !== 'string' || !auth.type) return null
  const t = auth.type.toLowerCase()
  const src = auth[auth.type] as PostmanAuthAttributes | string | undefined
  switch (t) {
    case 'inherit':
      return null
    case 'noauth':
      return { type: 'none' }
    case 'basic':
      return {
        type: 'basic',
        basic: {
          username: readAuthField(src, 'username'),
          password: readAuthField(src, 'password'),
        },
      }
    case 'bearer':
      return { type: 'bearer', bearer: { token: readAuthField(src, 'token'), prefix: 'Bearer' } }
    case 'apikey': {
      const inLocation = readAuthField(src, 'in') || 'header'
      return {
        type: 'api-key',
        apiKey: {
          key: readAuthField(src, 'key'),
          value: readAuthField(src, 'value'),
          in: inLocation === 'query' ? 'query' : 'header',
        },
      }
    }
    case 'digest': {
      const extra = dropped(
        attributes(src),
        (k, v) =>
          ['username', 'password', 'saveHelperData', 'showPassword'].includes(k) ||
          // Server-supplied challenge values Postman caches; Testnizer reads them from the 401.
          ['realm', 'nonce', 'algorithm', 'qop', 'opaque', 'nonceCount', 'clientNonce'].includes(
            k,
          ) ||
          (k === 'disableRetryRequest' && v === 'false'),
      )
      if (extra.length > 0)
        warnings.push(`"${label}": Digest settings not imported: ${extra.join(', ')}.`)
      return {
        type: 'digest',
        digest: {
          username: readAuthField(src, 'username'),
          password: readAuthField(src, 'password'),
        },
      }
    }
    case 'ntlm':
      return {
        type: 'ntlm',
        ntlm: {
          username: readAuthField(src, 'username'),
          password: readAuthField(src, 'password'),
          domain: readAuthField(src, 'domain'),
          workstation: readAuthField(src, 'workstation'),
        },
      }
    case 'oauth2':
      return mapOAuth2(src, label, warnings)
    case 'awsv4': {
      const extra = dropped(
        attributes(src),
        (k, v) =>
          ['accessKey', 'secretKey', 'region', 'service'].includes(k) ||
          (k === 'addAuthDataToQuery' && v === 'false'),
      )
      if (extra.length > 0)
        warnings.push(`"${label}": AWS Signature settings not imported: ${extra.join(', ')}.`)
      return {
        type: 'aws-signature',
        awsSignature: {
          accessKey: readAuthField(src, 'accessKey'),
          secretKey: readAuthField(src, 'secretKey'),
          region: readAuthField(src, 'region'),
          service: readAuthField(src, 'service'),
        },
      }
    }
    case 'hawk': {
      const algorithm = readAuthField(src, 'algorithm').toLowerCase()
      const extra = dropped(
        attributes(src),
        (k, v) =>
          ['authId', 'authKey', 'algorithm', 'saveHelperData'].includes(k) ||
          (k === 'includePayloadHash' && v === 'false'),
      )
      if (algorithm && algorithm !== 'sha1' && algorithm !== 'sha256')
        extra.push(`algorithm ${algorithm}`)
      if (extra.length > 0)
        warnings.push(`"${label}": Hawk settings not imported: ${extra.join(', ')}.`)
      return {
        type: 'hawk',
        hawk: {
          authId: readAuthField(src, 'authId'),
          authKey: readAuthField(src, 'authKey'),
          algorithm: algorithm === 'sha1' ? 'sha1' : 'sha256',
        },
      }
    }
    default:
      warnings.push(
        `"${label}": ${auth.type} authentication is not supported by Testnizer; imported as "No auth". Set it up again in the Auth tab.`,
      )
      return { type: 'none' }
  }
}

/** Back-compat wrapper (tests, suite import): same mapping, warnings discarded. */
export function mapPostmanAuthToUi(auth: PostmanAuth | undefined): Record<string, unknown> | null {
  return mapPostmanAuth(auth, '', [])
}
