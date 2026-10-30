/** Postman `request.body` → the renderer's RequestBody shape. */
import type { PostmanBody } from './types'
import { genKvId, toText, tryParseJson } from './normalize'

export interface UiBody {
  type: string
  content?: string
  formData?: Array<{
    id: string
    key: string
    value: string
    enabled: boolean
    type?: 'text' | 'file'
    filePath?: string
  }>
  urlEncoded?: Array<{ id: string; key: string; value: string; enabled: boolean }>
}

/**
 * Map one body. `label` + `warnings` name what could not be carried: an
 * unknown mode, a GraphQL operation name, per-part content types and a body
 * Postman has switched off. Without them the old behaviour applies (silent).
 */
export function mapPostmanBody(
  body: PostmanBody | null | undefined,
  label = '',
  warnings: string[] = [],
): UiBody {
  if (!body || typeof body !== 'object' || !body.mode) return { type: 'none' }
  const mapped = mapMode(body, label, warnings)
  if (body.disabled === true && mapped.type !== 'none') {
    warnings.push(
      `"${label}": the body is switched off in Postman; imported with body type "none" (its content is kept — pick a body type to send it).`,
    )
    return { ...mapped, type: 'none' }
  }
  return mapped
}

function mapMode(body: PostmanBody, label: string, warnings: string[]): UiBody {
  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language ?? 'text'
      const map: Record<string, string> = {
        json: 'json',
        xml: 'xml',
        html: 'html',
        javascript: 'javascript',
        text: 'text',
        graphql: 'json',
      }
      return { type: map[lang] ?? 'text', content: toText(body.raw) }
    }
    case 'graphql': {
      const g = body.graphql
      if (g && typeof g.operationName === 'string' && g.operationName.trim()) {
        warnings.push(
          `"${label}": the GraphQL operation name "${g.operationName}" was not imported (the request body keeps query and variables).`,
        )
      }
      const payload = g
        ? JSON.stringify(
            {
              query: g.query ?? '',
              variables:
                tryParseJson(typeof g.variables === 'string' ? g.variables : undefined) ??
                (g.variables && typeof g.variables === 'object' ? g.variables : {}),
            },
            null,
            2,
          )
        : ''
      return { type: 'json', content: payload }
    }
    case 'formdata': {
      const parts = Array.isArray(body.formdata) ? body.formdata : []
      const typed = parts.filter((fd) => fd && fd.contentType).map((fd) => fd.key)
      if (typed.length > 0) {
        warnings.push(
          `"${label}": per-field content types of form-data fields were not imported (${typed.join(', ')}).`,
        )
      }
      const formData = parts
        .filter((fd) => fd && typeof fd === 'object')
        .map((fd) => {
          const isFile = (fd.type ?? '').toLowerCase() === 'file'
          const filePath = Array.isArray(fd.src) ? fd.src[0] : fd.src
          if (isFile) {
            // For file fields the human-readable filename goes in `value`
            // and the path the main process opens lives in `filePath`.
            const fileName = filePath ? (filePath.split(/[\\/]/).pop() ?? filePath) : ''
            return {
              id: genKvId(),
              key: toText(fd.key),
              value: fileName,
              enabled: !fd.disabled,
              type: 'file' as const,
              filePath: filePath ?? undefined,
            }
          }
          return {
            id: genKvId(),
            key: toText(fd.key),
            value:
              fd.value !== undefined && fd.value !== null
                ? toText(fd.value)
                : Array.isArray(fd.src)
                  ? fd.src.join(',')
                  : toText(fd.src),
            enabled: !fd.disabled,
            type: 'text' as const,
          }
        })
      return { type: 'form-data', formData }
    }
    case 'urlencoded': {
      const urlEncoded = (Array.isArray(body.urlencoded) ? body.urlencoded : [])
        .filter((ue) => ue && typeof ue === 'object')
        .map((ue) => ({
          id: genKvId(),
          key: toText(ue.key),
          value: toText(ue.value),
          enabled: !ue.disabled,
        }))
      return { type: 'urlencoded', urlEncoded }
    }
    case 'file':
      // Binary upload — content path can't survive an export, so we record the
      // hint. The user re-attaches the file in the UI.
      return { type: 'binary', content: toText(body.file?.src) }
    default:
      warnings.push(
        `"${label}": body mode "${String(body.mode)}" is not supported; imported without a body.`,
      )
      return { type: 'none' }
  }
}

/** Back-compat name (tests): same mapping, warnings discarded. */
export function mapPostmanBodyToUi(body: PostmanBody | undefined): UiBody {
  return mapPostmanBody(body)
}
