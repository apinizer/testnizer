/**
 * What a saved GraphQL row sends. The GraphQL tab keeps its state in
 * `metadata.graphql` (`snapshotProtocol`, the Postman v3 importer) and Send posts
 * that state, so this reads the same place: the query, the variables as typed, and
 * the editor's headers, which replace the `headers` column on that tab.
 *
 * `null` for a row with neither: an imported JSON `{query, variables}` body is an
 * ordinary JSON request.
 */
import { parse } from 'graphql/language/parser'
import { graphqlJson, graphqlParts } from './codegen/normalize'
import type { CodegenInputBody } from './codegen/types'

export interface SavedGraphql {
  query: string
  variables: string
  /** The operation Send posts: only for a document with several, and always one of them. */
  operationName?: string
  /** Absent when the row has no editor headers: the `headers` column then applies. */
  headers?: unknown[]
}

export function readSavedGraphql(body: unknown, metadata: unknown): SavedGraphql | null {
  const meta = (metadata as { graphql?: Record<string, unknown> } | null | undefined)?.graphql
  const stored = body as CodegenInputBody | null | undefined
  const fromBody = stored?.type === 'graphql' ? graphqlParts(stored) : null

  const query = typeof meta?.query === 'string' ? meta.query : fromBody?.query
  if (query === undefined) return null

  const variables =
    typeof meta?.variables === 'string'
      ? meta.variables
      : meta?.variables && typeof meta.variables === 'object'
        ? JSON.stringify(meta.variables)
        : (fromBody?.variables ?? '{}')

  const operationName = chooseGraphqlOperation(
    query,
    typeof meta?.operationName === 'string' ? meta.operationName : fromBody?.operationName,
  ).operationName

  return {
    query,
    variables,
    ...(operationName ? { operationName } : {}),
    ...(Array.isArray(meta?.headers) ? { headers: meta.headers as unknown[] } : {}),
  }
}

// ─── A document with several operations ──────────────────────────────────────

export type GraphqlOperationType = 'query' | 'mutation' | 'subscription'

export interface GraphqlOperation {
  name: string
  type: GraphqlOperationType
}

export interface GraphqlOperationChoice {
  /** What the Operation select lists. Empty: no select, and no name is ever sent. */
  operations: GraphqlOperation[]
  /** The name to send: the selection, or the first operation. Always in the document. */
  operationName?: string
  /** Which path runs: a subscription subscribes, anything else is a POST. */
  isSubscription: boolean
  /** A selection the document no longer holds, so `operationName` is the first one instead. */
  staleSelection?: string
}

/**
 * A Name token: `{{id}}` in a value or a selection is not GraphQL until it is
 * resolved, and the select has to work on the text as typed. `{{` never occurs in
 * a valid document outside a string, where the replacement changes nothing.
 */
const VAR_PLACEHOLDER = '__testnizer_var__'
const TEMPLATE_VAR = /\{\{[^{}]*\}\}/g

function readSelectableOperations(document: string): GraphqlOperation[] {
  try {
    const doc = parse(document.replace(TEMPLATE_VAR, VAR_PLACEHOLDER), { noLocation: true })
    const operations: GraphqlOperation[] = []
    const names = new Set<string>()
    for (const def of doc.definitions) {
      if (def.kind !== 'OperationDefinition') continue
      const name = def.name?.value
      // Anonymous beside others or a repeated name: invalid, however the server words
      // it. A `{{var}}` in the name: not knowable until it is resolved.
      if (!name || names.has(name) || name.includes(VAR_PLACEHOLDER)) return []
      names.add(name)
      operations.push({ name, type: def.operation as GraphqlOperationType })
    }
    return operations.length > 1 ? operations : []
  } catch {
    return []
  }
}

// Store selectors call this on every store update, a subscription event included.
let lastRead: { document: string; operations: GraphqlOperation[] } | null = null

/**
 * The operations to choose between: two or more, all named, names unique. Anything
 * else (one operation, an anonymous one, a document that does not parse) has
 * nothing to choose and stays exactly as it was: no select, no name on the wire.
 */
export function selectableGraphqlOperations(
  document: string | null | undefined,
): GraphqlOperation[] {
  const text = document ?? ''
  if (lastRead?.document !== text) {
    lastRead = { document: text, operations: readSelectableOperations(text) }
  }
  return lastRead.operations
}

/**
 * ONE rule for what runs and which path it takes: the editor, Send, Subscribe, Run,
 * Generate Code and the export writers. With nothing selected, or a selection that
 * is gone, the first operation runs and the select shows it.
 */
export function chooseGraphqlOperation(
  document: string | null | undefined,
  selected: string | null | undefined,
): GraphqlOperationChoice {
  const operations = selectableGraphqlOperations(document)
  if (operations.length === 0) {
    return { operations, isSubscription: isSubscriptionQuery(document) }
  }
  const match = operations.find((op) => op.name === selected)
  const chosen = match ?? operations[0]
  return {
    operations,
    operationName: chosen.name,
    isSubscription: chosen.type === 'subscription',
    ...(selected && !match ? { staleSelection: selected } : {}),
  }
}

/**
 * Is the document's first operation a subscription? `chooseGraphqlOperation`'s rule
 * for a document with nothing to choose between. Reads the first operation definition,
 * past comments, strings and fragments, so `fragment F on T { a } subscription { … }`
 * counts and a `subscription` word in a comment does not. Anything it cannot read
 * is not a subscription, and stays the ordinary POST it was.
 */
export function isSubscriptionQuery(query: string | null | undefined): boolean {
  const src = query ?? ''
  let depth = 0
  let inFragment = false
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '"') {
      const fence = src.startsWith('"""', i) ? '"""' : '"'
      i += fence.length
      while (i < src.length && !src.startsWith(fence, i)) i += src[i] === '\\' ? 2 : 1
      i += fence.length
    } else if (c === '{') {
      if (depth === 0 && !inFragment) return false // shorthand `{ … }`: a query
      depth++
      i++
    } else if (c === '}') {
      depth--
      if (depth === 0) inFragment = false
      i++
    } else if (depth === 0 && !inFragment && /[A-Za-z_]/.test(c)) {
      const start = i
      while (i < src.length && /\w/.test(src[i])) i++
      const word = src.slice(start, i)
      if (word === 'fragment') inFragment = true
      else return word === 'subscription'
    } else {
      i++
    }
  }
  return false
}

/**
 * An operation name from an imported file. Kept when the document has several
 * operations and it names one. With one operation it adds nothing on the wire, so
 * it is dropped quietly; a name the document does not hold is reported (`lost`).
 */
export function importedOperationName(
  document: string,
  name: unknown,
): { keep?: string; lost: boolean } {
  if (typeof name !== 'string' || !name.trim()) return { lost: false }
  const operations = selectableGraphqlOperations(document)
  if (operations.length === 0) return { lost: !document.includes(name) }
  return operations.some((op) => op.name === name) ? { keep: name, lost: false } : { lost: true }
}

/** Saved row → subscription? Covers the editor's shape and an imported `{query}` JSON body. */
export function isSavedSubscription(body: unknown, metadata: unknown): boolean {
  const saved = readSavedGraphql(body, metadata)
  if (saved) return chooseGraphqlOperation(saved.query, saved.operationName).isSubscription
  const content = (body as { content?: unknown } | null | undefined)?.content
  if (typeof content !== 'string') return false
  try {
    const parsed = JSON.parse(content) as { query?: unknown; operationName?: unknown } | null
    if (typeof parsed?.query !== 'string') return false
    const selected = typeof parsed.operationName === 'string' ? parsed.operationName : undefined
    return chooseGraphqlOperation(parsed.query, selected).isSubscription
  } catch {
    return false
  }
}

/** The `{query, operationName?, variables}` of a subscription: Send's exact JSON (`graphqlJson`). */
export function subscriptionPayload(
  query: string,
  variables: string,
  operationName?: string,
): { query: string; variables: Record<string, unknown>; operationName?: string } {
  return JSON.parse(graphqlJson(query, variables, operationName)) as {
    query: string
    variables: Record<string, unknown>
    operationName?: string
  }
}
