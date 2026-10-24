/**
 * Main-side Postman detection: parse JSON or YAML and classify with the one
 * shared classifier (`src/shared/postman-detect.ts`). YAML uses js-yaml's
 * CORE schema — plain JSON types only: no custom tags, unquoted dates stay
 * strings, no `<<` merge keys (issue #276 part 2).
 */
import { classifyPostmanDocument, type PostmanDetection } from '../../../shared/postman-detect'

export interface ParsedPostmanInput {
  doc: unknown
  detection: PostmanDetection | null
}

export function parsePostmanText(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const yaml = require('js-yaml') as {
    load: (s: string, o?: { schema?: unknown }) => unknown
    CORE_SCHEMA: unknown
  }
  return yaml.load(trimmed, { schema: yaml.CORE_SCHEMA })
}

/** Parse + classify. Throws on unparseable text (the caller reports it). */
export function detectPostman(text: string): ParsedPostmanInput {
  const doc = parsePostmanText(text)
  return { doc, detection: classifyPostmanDocument(doc) }
}
