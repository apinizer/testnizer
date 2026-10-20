/**
 * The body of an SSE mock response (`body_type: 'sse'`, issue #221) as a
 * list of wire blocks — design Ek C R08.
 *
 * The body is raw SSE text (what a user types, or pastes from a captured
 * stream). It is split on blank lines and every block is later written to
 * the wire VERBATIM (after its own template render), followed by one blank
 * line. Nothing is parsed into events and re-serialised, so:
 *  - a `retry:`-only block, an `id:`-only block (id reset), a `: comment`
 *    block and multi-line `data:` all go out exactly as written;
 *  - no `data:` line is ever synthesised — a control block never turns into
 *    an extra (empty) application message;
 *  - a body whose last block lacks the closing blank line still gets one.
 *
 * Deliberately NOT the response viewer's `parseSseBody` (`sse-body-parser.ts`):
 * that one is a consumer view (it drops comments and turns retry-only blocks
 * into empty events) and stays as it is for its own callers.
 *
 * Consequence of block-wise rendering (documented for the editor hint): a
 * Handlebars `{{#each}}` / `{{#if}}` cannot span a blank line — each block
 * compiles on its own (an unbalanced block falls back to its literal text) —
 * and a rendered value that itself contains a blank line splits the event on
 * the wire. JSON data should use `{{json …}}`, which escapes newlines.
 *
 * Pure and import-free (shared by the main engine and the renderer editor,
 * which warns when a body has no events).
 */

export interface SseBlock {
  /** The block's template text, without its trailing line terminators. */
  raw: string
  /** Blank-line separator written after the block (CRLF bodies keep CRLF). */
  separator: '\n\n' | '\r\n\r\n'
  /**
   * Value of the block's last `id:` line (WHATWG: one leading space dropped;
   * the last `id:` field of a block wins), or null when it has none. An empty
   * string is an id reset.
   */
  id: string | null
  /** True when an `id:` line of this block is a template (`{{…}}`). */
  dynamicId: boolean
}

/**
 * Two or more line terminators in a row = a blank line between blocks. A
 * lone `\r` only counts when no `\n` follows — otherwise the regex could
 * backtrack and read one CRLF as two terminators (a false blank line).
 */
const BLOCK_SEPARATOR = /(?:\r\n|\n|\r(?!\n)){2,}/g

const LINE_BREAK = /\r\n|\n|\r/

const TRAILING_BREAKS = /(?:\r\n|\n|\r)+$/

/** `id:` lines of one block → `{ id, dynamicId }`. */
function readId(raw: string): { id: string | null; dynamicId: boolean } {
  let id: string | null = null
  let dynamicId = false
  for (const line of raw.split(LINE_BREAK)) {
    // A field line is `name:value` or a bare `name`; only `id` matters here.
    if (line !== 'id' && !line.startsWith('id:')) continue
    let value = line === 'id' ? '' : line.slice(3)
    if (value.startsWith(' ')) value = value.slice(1)
    // WHATWG ignores an id containing NULL; it never becomes the last event id.
    if (value.includes('\u0000')) continue
    if (value.includes('{{')) dynamicId = true
    id = value
  }
  return { id, dynamicId }
}

/**
 * Split a raw SSE body into blocks. Whitespace-only blocks (extra blank
 * lines) are dropped; a missing final separator is supplied.
 */
export function splitSseBlocks(body: string): SseBlock[] {
  const out: SseBlock[] = []
  if (!body) return out
  let last = 0
  // The last block has no separator of its own: it follows the body's style.
  const bodyCrlf = body.includes('\r\n')
  const push = (text: string, sepText: string | null): void => {
    const raw = text.replace(TRAILING_BREAKS, '')
    if (raw.trim() === '') return
    const crlf = sepText !== null ? sepText.startsWith('\r\n') : bodyCrlf
    out.push({ raw, separator: crlf ? '\r\n\r\n' : '\n\n', ...readId(raw) })
  }
  for (const m of body.matchAll(BLOCK_SEPARATOR)) {
    const at = m.index ?? 0
    push(body.slice(last, at), m[0])
    last = at + m[0].length
  }
  push(body.slice(last), null)
  return out
}

/**
 * Where a (re)connecting client starts, per design Ek C R07:
 *  - resume is honoured ONLY for a finite list (`loop` off) whose `id:` lines
 *    are all fixed text. A looping list or an id rendered from a template
 *    (`{{stream.seq}}`) starts from the top — the id cannot be found again,
 *    and a loop has no "after the last one".
 *  - the full list is kept; only the start cursor moves.
 *  - a `Last-Event-ID` that is not in the list starts from the top.
 *
 * `finished` = the client already saw the last event; the caller answers
 * 204 when the stream would close (so EventSource stops reconnecting).
 */
export function resumeCursor(
  blocks: readonly SseBlock[],
  lastEventId: string | undefined,
  opts: { resume: boolean; loop: boolean },
): { start: number; finished: boolean; resumed: boolean } {
  const fromTop = { start: 0, finished: false, resumed: false }
  if (!opts.resume || opts.loop || lastEventId === undefined || lastEventId === '') return fromTop
  if (blocks.some((b) => b.dynamicId)) return fromTop
  // The first block whose id matches; ids of a resumable list should be unique.
  const at = blocks.findIndex((b) => b.id === lastEventId)
  if (at < 0) return fromTop
  const start = at + 1
  return { start, finished: start >= blocks.length, resumed: true }
}
