/**
 * Unit tests for `src/main/lib/sse-body-parser.ts`.
 *
 * The parser turns a buffered `text/event-stream` body into structured
 * events. We exercise the spec rules that matter for the Postman-style
 * "Events" tab: default event type, named events, multi-line data, retry
 * field, comment lines, missing trailing newline, and CRLF line endings.
 */
import { describe, it, expect } from 'vitest'
import { parseSseBody } from '../../src/main/lib/sse-body-parser'

describe('parseSseBody', () => {
  it('parses a single message event with default type', () => {
    const body = 'data: hello\n\n'
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'message', data: 'hello' })
    expect(events[0].id).toBeUndefined()
  })

  it('parses multiple events separated by blank lines', () => {
    const body = ['data: first', '', 'data: second', '', 'data: third', ''].join('\n')
    const events = parseSseBody(body)

    expect(events.map((e) => e.data)).toEqual(['first', 'second', 'third'])
    expect(events.every((e) => e.type === 'message')).toBe(true)
  })

  it('joins multi-line `data:` fields with newline separator', () => {
    const body = 'data: line1\ndata: line2\ndata: line3\n\n'
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('line1\nline2\nline3')
  })

  it('honours `event:` to set the event type and `id:` for the event id', () => {
    const body = ['event: update', 'id: 42', 'data: payload', '', ''].join('\n')
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'update', id: '42', data: 'payload' })
  })

  it('parses the `retry:` reconnection-time field as an integer', () => {
    const body = 'retry: 5000\ndata: payload\n\n'
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0].retry).toBe(5000)
    expect(events[0].data).toBe('payload')
  })

  it('ignores comment lines (starting with `:`) and dispatches normally', () => {
    const body = [
      ': this is a comment from the server',
      ': another keep-alive ping',
      'data: real-payload',
      '',
      '',
    ].join('\n')
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0].data).toBe('real-payload')
  })

  it('flushes the trailing event when the body has no terminating newline', () => {
    const body = 'event: notification\ndata: bye'
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'notification', data: 'bye' })
  })

  it('handles CRLF line endings the same as LF', () => {
    const body = 'event: update\r\ndata: crlf-data\r\n\r\n'
    const events = parseSseBody(body)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'update', data: 'crlf-data' })
  })

  it('returns an empty array for empty input or only-blank-line input', () => {
    expect(parseSseBody('')).toEqual([])
    expect(parseSseBody('\n\n\n')).toEqual([])
  })
})
