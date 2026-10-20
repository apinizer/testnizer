/**
 * Issue #215 guard — an image content block crosses the main process byte for
 * byte. The report blamed Testnizer for a 3017-byte PNG; the hosted
 * Everything server sends exactly that (see
 * `tests/fixtures/mcp/everything-images.ts`). This pins that neither the Send
 * path (mcpConnect → mcpCallTool, what `mcp:callTool` returns verbatim) nor
 * the Run path (mcpCallOnce) shortens or re-encodes `data` — for that broken
 * payload, and for an image far larger than any internal preview limit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import {
  mcpCallOnce,
  mcpCallTool,
  mcpConnect,
  mcpDisconnect,
} from '../../src/main/protocols/mcp.engine'
import { startV2Server, type RunningServer } from './mcp-wire-fixtures'
import { EVERYTHING_TINY_IMAGE_WIRE } from '../fixtures/mcp/everything-images'

// 300 KiB of bytes behind a PNG signature: byte identity is the point, not decodability.
const LARGE_IMAGE = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(300 * 1024),
]).toString('base64')

let server: RunningServer

beforeAll(async () => {
  server = await startV2Server((mcp) => {
    mcp.registerTool(
      'get-tiny-image',
      { description: 'tiny', inputSchema: z.object({}) },
      async () => ({
        content: [
          { type: 'text', text: 'A tiny image:' },
          { type: 'image', data: EVERYTHING_TINY_IMAGE_WIRE, mimeType: 'image/png' },
        ],
      }),
    )
    mcp.registerTool(
      'get-large-image',
      { description: 'large', inputSchema: z.object({}) },
      async () => ({
        content: [{ type: 'image', data: LARGE_IMAGE, mimeType: 'image/png' }],
      }),
    )
  })
})

afterAll(async () => {
  await server?.close()
})

type Block = { type: string; data?: string; mimeType?: string }
const imageOf = (result: unknown): Block | undefined =>
  ((result as { content?: Block[] }).content ?? []).find((b) => b.type === 'image')

describe('MCP image content passes through main unchanged (issue #215)', () => {
  it('Send path: mcpCallTool returns the exact base64 for the broken and the large image', async () => {
    const info = await mcpConnect({ transport: 'http', url: server.url })
    try {
      const tiny = imageOf(await mcpCallTool(info.connectionId, 'get-tiny-image', {}))
      expect(tiny?.mimeType).toBe('image/png')
      expect(tiny?.data).toBe(EVERYTHING_TINY_IMAGE_WIRE)
      expect(Buffer.from(tiny!.data!, 'base64').length).toBe(3017)
      const large = imageOf(await mcpCallTool(info.connectionId, 'get-large-image', {}))
      expect(large?.data).toBe(LARGE_IMAGE)
    } finally {
      await mcpDisconnect(info.connectionId)
    }
  })

  it('Run path: mcpCallOnce returns the exact base64 too', async () => {
    for (const [name, expected] of [
      ['get-tiny-image', EVERYTHING_TINY_IMAGE_WIRE],
      ['get-large-image', LARGE_IMAGE],
    ] as const) {
      const out = await mcpCallOnce({
        connect: { transport: 'http', url: server.url },
        call: { capability: 'tool', name, args: {} },
      })
      expect(out.error).toBeUndefined()
      expect(imageOf(out.result)?.data).toBe(expected)
    }
  })
})
