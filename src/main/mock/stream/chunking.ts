/**
 * Cuts an AI mock reply's text into the chunks it is streamed in (issue
 * #221, design §6.6.2). Pure; the one rule every mode keeps: the chunks
 * joined back are exactly the input text (golden-tested, emoji included —
 * splitting is by code point, never inside a surrogate pair).
 *
 *  - `word`: a word plus the whitespace after it (leading whitespace rides
 *    with the first word), the way real providers stream token-ish pieces;
 *  - `char`: one code point per chunk;
 *  - `sentence`: up to and including a run of `.` `!` `?` that ends the
 *    sentence (followed by whitespace or the end), or a line break, plus the
 *    whitespace after it.
 *
 * Any chunk longer than `LLM_MAX_CHUNK_CHARS` is cut further, so one
 * streamed frame always stays far below the SSE writer's frame limit.
 */
import type { MockLlmChunking } from '../../../shared/mock-stream'

/** Longest chunk (code points). A frame of it is at most ~25 KiB of JSON. */
export const LLM_MAX_CHUNK_CHARS = 4096

const WORD = /\s*\S+\s*/gu
const SENTENCE = /[\s\S]*?(?:[.!?]+(?=\s|$)|\n|$)\s*/gu

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = []
  for (const m of text.matchAll(re)) if (m[0] !== '') out.push(m[0])
  return out
}

function capLength(chunk: string): string[] {
  const points = Array.from(chunk)
  if (points.length <= LLM_MAX_CHUNK_CHARS) return [chunk]
  const out: string[] = []
  for (let i = 0; i < points.length; i += LLM_MAX_CHUNK_CHARS) {
    out.push(points.slice(i, i + LLM_MAX_CHUNK_CHARS).join(''))
  }
  return out
}

export function chunkText(text: string, mode: MockLlmChunking): string[] {
  if (text === '') return []
  let chunks: string[]
  if (mode === 'char') return Array.from(text)
  chunks = matchAll(text, mode === 'sentence' ? SENTENCE : WORD)
  // Whitespace-only text matches no word: it is one chunk of its own.
  if (chunks.length === 0) chunks = [text]
  return chunks.flatMap(capLength)
}

/**
 * Tool-call arguments as streamed fragments (design §6.6.2: 8–16 pieces for
 * a typical call): about 4 code points per piece, never more than 16
 * pieces, one piece for short text. Joined back = the input.
 */
export function argumentPieces(json: string): string[] {
  const points = Array.from(json)
  if (points.length === 0) return ['']
  const count = Math.max(1, Math.min(16, Math.ceil(points.length / 4)))
  const size = Math.ceil(points.length / count)
  const out: string[] = []
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size).join(''))
  return out
}
