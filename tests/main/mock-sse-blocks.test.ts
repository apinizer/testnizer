/**
 * Issue #221 (Faz 1a, design Ek C R07 / R08) — the SSE mock body as a list of
 * verbatim wire blocks, and where a reconnecting client resumes.
 */
import { describe, it, expect } from 'vitest'
import { resumeCursor, splitSseBlocks } from '../../src/main/mock/stream/sse-blocks'

describe('splitSseBlocks', () => {
  it('splits on blank lines and keeps every block verbatim (control blocks included)', () => {
    const body =
      'retry: 3000\n\n: a comment\n\nid: 7\n\ndata: line1\ndata: line2\nevent: multi\n\ndata: tail'
    expect(splitSseBlocks(body).map((b) => b.raw)).toEqual([
      'retry: 3000',
      ': a comment',
      'id: 7',
      'data: line1\ndata: line2\nevent: multi',
      'data: tail',
    ])
  })

  it('accepts CRLF separators and keeps CRLF inside and after the block', () => {
    const blocks = splitSseBlocks('id: 1\r\ndata: a\r\n\r\ndata: b\r\n')
    expect(blocks.map((b) => [b.raw, b.separator])).toEqual([
      ['id: 1\r\ndata: a', '\r\n\r\n'],
      ['data: b', '\r\n\r\n'],
    ])
  })

  it('one CRLF is never read as a blank line', () => {
    expect(splitSseBlocks('data: a\r\ndata: b').map((b) => b.raw)).toEqual(['data: a\r\ndata: b'])
  })

  it('extra blank lines, leading / trailing separators and whitespace-only blocks are dropped', () => {
    expect(splitSseBlocks('\n\n\ndata: a\n\n\n\n   \n\ndata: b\n\n\n').map((b) => b.raw)).toEqual([
      'data: a',
      'data: b',
    ])
    expect(splitSseBlocks('')).toEqual([])
    expect(splitSseBlocks('\n\n')).toEqual([])
  })

  it('reads the block id the WHATWG way: one leading space dropped, the last id wins', () => {
    const [a, b, c, d, e] = splitSseBlocks(
      'id: 1\ndata: x\n\nid:2\nid:  3\ndata: y\n\nid\n\ndata: none\n\nid: {{stream.seq}}\ndata: z',
    )
    expect([a.id, b.id, c.id, d.id, e.id]).toEqual(['1', ' 3', '', null, '{{stream.seq}}'])
    expect([a.dynamicId, e.dynamicId]).toEqual([false, true])
  })
})

describe('resumeCursor', () => {
  const fixed = splitSseBlocks('id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c')
  const on = { resume: true, loop: false }

  it('no Last-Event-ID / unknown id → from the top', () => {
    expect(resumeCursor(fixed, undefined, on)).toEqual({
      start: 0,
      finished: false,
      resumed: false,
    })
    expect(resumeCursor(fixed, '', on).start).toBe(0)
    expect(resumeCursor(fixed, '99', on).start).toBe(0)
  })

  it('a fixed id → the event after it; the last id → finished; the full list is kept', () => {
    expect(resumeCursor(fixed, '2', on)).toEqual({ start: 2, finished: false, resumed: true })
    expect(resumeCursor(fixed, '3', on)).toEqual({ start: 3, finished: true, resumed: true })
    expect(fixed).toHaveLength(3)
  })

  it('resume off, a loop, or a templated id → never resumes', () => {
    expect(resumeCursor(fixed, '2', { resume: false, loop: false }).start).toBe(0)
    expect(resumeCursor(fixed, '2', { resume: true, loop: true }).start).toBe(0)
    const dynamic = splitSseBlocks('id: {{stream.seq}}\ndata: a\n\nid: 2\ndata: b')
    expect(resumeCursor(dynamic, '2', on).start).toBe(0)
  })
})
