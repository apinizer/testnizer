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

/** Code points of `text`, counting stops past `limit`. */
function codePoints(text: string, limit = Infinity): number {
  let n = 0
  for (const _ of text) if (++n > limit) break
  return n
}

/** Pieces `capLength` cuts one non-empty chunk into. */
function capCount(chunk: string): number {
  return Math.max(1, Math.ceil(codePoints(chunk) / LLM_MAX_CHUNK_CHARS))
}

/**
 * `chunkText(text, mode).length` without building the chunks — for the
 * frame limit, checked BEFORE a reply is encoded (a 5 MB echoed prompt with
 * `char` chunking would otherwise build millions of events only to be
 * refused). Counting stops as soon as it passes `limit` (the result is then
 * some number above it), so a huge text costs O(limit), not O(text).
 */
export function countChunks(text: string, mode: MockLlmChunking, limit = Infinity): number {
  if (text === '') return 0
  if (mode === 'char') return codePoints(text, limit)
  let n = 0
  for (const m of text.matchAll(mode === 'sentence' ? SENTENCE : WORD)) {
    if (m[0] === '') continue
    n += capCount(m[0])
    if (n > limit) return n
  }
  // Whitespace-only text matches no word: it is one chunk of its own (then capped).
  return n === 0 ? capCount(text) : n
}

/** `argumentPieces(json).length`, without building the pieces. */
export function argumentPieceCount(json: string): number {
  const points = codePoints(json)
  if (points === 0) return 1
  const count = Math.max(1, Math.min(16, Math.ceil(points / 4)))
  return Math.ceil(points / Math.ceil(points / count))
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
