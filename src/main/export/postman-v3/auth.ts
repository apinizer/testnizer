/**
 * Testnizer `AuthConfig` → Postman auth attributes (issue #277): the
 * inverse of the importer's `mapPostmanAuth` (src/main/import/postman/auth.ts),
 * key for key, so an auth exported here imports back unchanged. Shared by the
 * v3 writer (credentials list) and the v2.1 writer for the types it had no
 * branch for (AWS Signature, Hawk).
 */

export interface PostmanAttr {
  key: string
  value: string
}

export interface PostmanAuthParts {
  /** Postman type name (`noauth`, `inherit`, `basic`, `apikey`, `awsv4`, …). */
  type: string
  attrs: PostmanAttr[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

const GRANT_TO_POSTMAN: Record<string, string> = {
  authorization_code: 'authorization_code',
  client_credentials: 'client_credentials',
  password: 'password_credentials',
  implicit: 'implicit',
}

/**
 * One AuthConfig → Postman parts; null when there is nothing to write (no
 * auth object, or a type Postman has no counterpart for — WS-Security).
 */
export function authToPostmanParts(auth: unknown): PostmanAuthParts | null {
  if (!isRecord(auth) || typeof auth.type !== 'string') return null
  const sub = (k: string): Record<string, unknown> =>
    isRecord(auth[k]) ? (auth[k] as Record<string, unknown>) : {}
  switch (auth.type) {
    case 'none':
      return { type: 'noauth', attrs: [] }
    case 'inherit':
      return { type: 'inherit', attrs: [] }
    case 'basic': {
      const a = sub('basic')
      return {
        type: 'basic',
        attrs: [
          { key: 'username', value: s(a.username) },
          { key: 'password', value: s(a.password) },
        ],
      }
    }
    case 'bearer':
      return { type: 'bearer', attrs: [{ key: 'token', value: s(sub('bearer').token) }] }
    case 'api-key': {
      const a = sub('apiKey')
      return {
        type: 'apikey',
        attrs: [
          { key: 'key', value: s(a.key) },
          { key: 'value', value: s(a.value) },
          { key: 'in', value: a.in === 'query' ? 'query' : 'header' },
        ],
      }
    }
    case 'digest': {
      const a = sub('digest')
      return {
        type: 'digest',
        attrs: [
          { key: 'username', value: s(a.username) },
          { key: 'password', value: s(a.password) },
        ],
      }
    }
    case 'ntlm': {
      const a = sub('ntlm')
      return {
        type: 'ntlm',
        attrs: [
          { key: 'username', value: s(a.username) },
          { key: 'password', value: s(a.password) },
          { key: 'domain', value: s(a.domain) },
          { key: 'workstation', value: s(a.workstation) },
        ],
      }
    }
    case 'oauth2': {
      const a = sub('oauth2')
      const grant = GRANT_TO_POSTMAN[s(a.grantType)] ?? 'client_credentials'
      const attrs: PostmanAttr[] = [
        { key: 'grant_type', value: grant },
        { key: 'accessTokenUrl', value: s(a.tokenUrl) },
        { key: 'authUrl', value: s(a.authUrl) },
        { key: 'clientId', value: s(a.clientId) },
        { key: 'clientSecret', value: s(a.clientSecret) },
        { key: 'scope', value: s(a.scope) },
        { key: 'accessToken', value: s(a.token) },
      ]
      if (grant === 'password_credentials') {
        attrs.push(
          { key: 'username', value: s(a.username) },
          { key: 'password', value: s(a.password) },
        )
      }
      if (a.clientAuth === 'body' || a.clientAuth === 'header')
        attrs.push({ key: 'client_authentication', value: s(a.clientAuth) })
      if (s(a.refreshToken)) attrs.push({ key: 'refreshToken', value: s(a.refreshToken) })
      return { type: 'oauth2', attrs }
    }
    case 'aws-signature': {
      const a = sub('awsSignature')
      return {
        type: 'awsv4',
        attrs: [
          { key: 'accessKey', value: s(a.accessKey) },
          { key: 'secretKey', value: s(a.secretKey) },
          { key: 'region', value: s(a.region) },
          { key: 'service', value: s(a.service) },
        ],
      }
    }
    case 'hawk': {
      const a = sub('hawk')
      return {
        type: 'hawk',
        attrs: [
          { key: 'authId', value: s(a.authId) },
          { key: 'authKey', value: s(a.authKey) },
          { key: 'algorithm', value: s(a.algorithm) || 'sha256' },
        ],
      }
    }
    default:
      return null
  }
}

/** v3 auth object: `{type, credentials: [{key, value}]}`; `inherit` keeps `credentials: []` (schema). */
export function authToV3(auth: unknown): Record<string, unknown> | undefined {
  const p = authToPostmanParts(auth)
  if (!p) return undefined
  if (p.type === 'noauth') return { type: 'noauth' }
  return { type: p.type, credentials: p.attrs }
}
