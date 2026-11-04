/**
 * Is this document an OpenAPI / Swagger spec at all? The one gate every OpenAPI
 * import passes (APIs tree, mock server, the mock dialog's look before a server
 * exists). A file failing it is refused; a broken `$ref` inside a real spec is not
 * this question, see `src/main/import/openapi-refs.ts`.
 *
 * Decides only the major version: a parser's list of exact minor versions would
 * refuse a spec for being newer than the parser.
 */
export type OpenApiProblem = 'not-openapi' | 'unsupported-version' | 'bad-paths'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

export function openApiProblem(doc: unknown): OpenApiProblem | null {
  if (!isRecord(doc)) return 'not-openapi'
  if (doc.openapi === undefined && doc.swagger === undefined) return 'not-openapi'
  // YAML reads an unquoted `openapi: 3.0` / `swagger: 2.0` as a number.
  const supported =
    doc.openapi !== undefined
      ? /^3(\.|$)/.test(String(doc.openapi))
      : /^2(\.0+)?$/.test(String(doc.swagger))
  if (!supported) return 'unsupported-version'
  if (doc.paths !== undefined && doc.paths !== null && !isRecord(doc.paths)) return 'bad-paths'
  return null
}

/** A `servers` section that cannot be used, in words for the import report. */
export function openApiServersProblem(doc: { servers?: unknown }): string | null {
  const { servers } = doc
  if (servers === undefined || servers === null) return null
  if (!Array.isArray(servers)) {
    return 'The `servers` section is not a list, so it was ignored: requests start at their path.'
  }
  if (servers.length === 0) return null
  const first: unknown = servers[0]
  return isRecord(first) && typeof first.url === 'string'
    ? null
    : 'The first server in this document has no URL: requests start at their path.'
}

export function openApiProblemMessage(problem: OpenApiProblem): string {
  if (problem === 'unsupported-version') {
    return 'This OpenAPI version is not supported. Testnizer reads OpenAPI 3.x and Swagger 2.0.'
  }
  if (problem === 'bad-paths') return 'This OpenAPI document has a `paths` section it cannot read.'
  return 'Not a valid OpenAPI/Swagger document: it has no `openapi` or `swagger` version.'
}
