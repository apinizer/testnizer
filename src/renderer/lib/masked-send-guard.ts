/**
 * Send refuses while a History mask (`••••••`) still sits in a
 * credential-named field of the outgoing request (issue #195) — a reopened
 * History row empties masked values, but the mask can survive inside a text
 * (JSON body, GraphQL variables, a WebSocket / Socket.IO payload, a SOAP
 * envelope) or be pasted back. One helper per editor shape; the scan itself
 * is `src/shared/masked-credentials.ts`.
 *
 * Only what would go on the wire is checked: the ACTIVE body slot, the
 * active auth type, enabled rows.
 */
import type { AuthConfig, KeyValuePair, RequestBody } from '../types'
import { maskedCredentialsGuard } from '../../shared/masked-credentials'

const AUTH_FIELD: Record<string, keyof AuthConfig> = {
  basic: 'basic',
  bearer: 'bearer',
  'api-key': 'apiKey',
  oauth2: 'oauth2',
  digest: 'digest',
  ntlm: 'ntlm',
  'aws-signature': 'awsSignature',
  hawk: 'hawk',
  wsse: 'wsse',
}

function activeBody(body: RequestBody | undefined): Record<string, unknown> | undefined {
  if (!body || body.type === 'none' || body.type === 'binary') return undefined
  if (body.type === 'form-data') return { formData: body.formData }
  if (body.type === 'urlencoded') return { urlEncoded: body.urlEncoded }
  return { content: body.content }
}

function activeAuth(auth: AuthConfig | undefined): Record<string, unknown> | undefined {
  if (!auth) return undefined
  const field = AUTH_FIELD[auth.type]
  return field ? { [field]: auth[field] } : undefined
}

/** HTTP (and GraphQL / manual SOAP sent through `request:send`). */
export function httpMaskedSendError(req: {
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  body?: RequestBody
  auth?: AuthConfig
}): string | null {
  return maskedCredentialsGuard({
    url: req.url,
    params: req.params,
    headers: req.headers,
    body: activeBody(req.body),
    auth: activeAuth(req.auth),
  })
}

/** GraphQL (`graphql:execute`). */
export function graphqlMaskedSendError(req: {
  url: string
  variables?: string
  headers: KeyValuePair[]
}): string | null {
  return maskedCredentialsGuard({
    url: req.url,
    variables: req.variables ?? '',
    headers: req.headers,
  })
}

/** WebSocket connect (URL + headers + params) or a composer message. */
export function wsMaskedSendError(req: {
  url?: string
  customHeaders?: KeyValuePair[]
  params?: KeyValuePair[]
  composerContent?: string
}): string | null {
  return maskedCredentialsGuard(req)
}

/** Socket.IO connect (URL + headers + params + auth token) or an emit's arguments. */
export function socketioMaskedSendError(req: {
  url?: string
  bearerToken?: string
  customHeaders?: KeyValuePair[]
  params?: KeyValuePair[]
  /** Pre-#283 single payload. */
  emitPayload?: string
  /** Each argument's content (issue #283). */
  emitArgs?: string[]
}): string | null {
  return maskedCredentialsGuard(req)
}

/**
 * MQTT connect (URL, password, CONNECT / will user properties, will payload)
 * or a publish (payload + its user properties). Issue #284.
 */
export function mqttMaskedSendError(req: {
  url?: string
  password?: string
  userProperties?: KeyValuePair[]
  willUserProperties?: KeyValuePair[]
  willPayload?: string
  payload?: string
}): string | null {
  return maskedCredentialsGuard(req)
}

/** SOAP: endpoint URL + the envelope that goes on the wire + the Headers / Auth tabs. */
export function soapMaskedSendError(req: {
  endpointUrl: string
  envelope: string
  headers?: KeyValuePair[]
  auth?: AuthConfig
}): string | null {
  return maskedCredentialsGuard({
    endpointUrl: req.endpointUrl,
    envelope: req.envelope,
    headers: req.headers,
    auth: activeAuth(req.auth),
  })
}
