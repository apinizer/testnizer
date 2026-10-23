/**
 * Main-side Postman detection: parse JSON or YAML (js-yaml's default schema in
 * v4 is the safe one — no custom tags / JS types) and classify with the one
 * shared classifier (`src/shared/postman-detect.ts`).
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
  const yaml = require('js-yaml') as { load: (s: string) => unknown }
  return yaml.load(trimmed)
}

/** Parse + classify. Throws on unparseable text (the caller reports it). */
export function detectPostman(text: string): ParsedPostmanInput {
  const doc = parsePostmanText(text)
  return { doc, detection: classifyPostmanDocument(doc) }
}
