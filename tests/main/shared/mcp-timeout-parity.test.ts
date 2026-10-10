/**
 * Send ≡ Run for the MCP TIMEOUT (issue #185).
 *
 * Before: Send passed no timeout, so the SDK's implicit 60 s decided; Run
 * used its own 120 s (`MCP_ONE_SHOT_TIMEOUT_MS`) and read a `timeout` key
 * nothing wrote. Now the same saved row gives the same bound on both paths:
 *  - Send: the row is reopened the way the open paths do
 *    (`readRequestSettings` → the tab's `requestTimeout`), then the store's
 *    `mcpSendTimeout` → `timeoutMs` on the IPC call → engine `sdkTimeout`;
 *  - Run: `runner.handler.ts` `mcpRunTimeout(row)` → `mcpCallOnce`.
 * Absent → both the shared `MCP_DEFAULT_TIMEOUT_MS`; 0 → both "no limit".
 */
import { describe, expect, it, vi } from 'vitest'
import { makeElectronMock } from '../handlers/helpers'

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))
vi.mock('../../../src/main/db/database', () => ({ getDb: () => null }))

const { mcpRunTimeout } = await import('../../../src/main/ipc/runner.handler')
const { sdkTimeout, MCP_ONE_SHOT_TIMEOUT_MS, MCP_NO_TIMEOUT_MS } =
  await import('../../../src/main/protocols/mcp.engine')
const { MCP_DEFAULT_TIMEOUT_MS, readRequestSettings } =
  await import('../../../src/shared/request-settings')
const { mcpSendTimeout } = await import('../../../src/renderer/lib/mcp-send-request')

/** An MCP endpoint row as Ctrl+S writes it, with optional top-level timeout keys. */
function row(extra: Record<string, unknown>): { request_schema: string } {
  return {
    request_schema: JSON.stringify({
      url: 'http://x/mcp',
      ...extra,
      metadata: { mcp: { transport: 'http', url: 'http://x/mcp' } },
    }),
  }
}

/** Send: reopen the row into a tab (what the open paths restore), then the store's value. */
function sendSide(r: { request_schema: string }): number {
  const tabTimeout = readRequestSettings(JSON.parse(r.request_schema)).timeout ?? null
  return mcpSendTimeout(tabTimeout)
}

const CASES: Array<[string, Record<string, unknown>, number]> = [
  ['no timeout → the shared default', {}, MCP_DEFAULT_TIMEOUT_MS],
  ['explicit 5000', { timeout: 5000 }, 5000],
  ['0 = no limit', { timeout: 0 }, 0],
  ['legacy imported timeoutSeconds', { timeoutSeconds: 7 }, 7000],
  ['garbage → the default', { timeout: 'soon' }, MCP_DEFAULT_TIMEOUT_MS],
]

describe('MCP timeout: Send ≡ Run (issue #185)', () => {
  it.each(CASES)('%s', (_name, extra, expected) => {
    const r = row(extra)
    expect(sendSide(r)).toBe(expected)
    expect(mcpRunTimeout(r)).toBe(expected)
  })

  it("one default for both paths and the engine — not the SDK's implicit 60 s", () => {
    expect(MCP_ONE_SHOT_TIMEOUT_MS).toBe(MCP_DEFAULT_TIMEOUT_MS)
    expect(MCP_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(mcpSendTimeout(null)).toBe(mcpRunTimeout({ request_schema: null }))
  })

  it('engine sdkTimeout: always explicit — default, 0 → largest timer, >0 as given', () => {
    expect(sdkTimeout({})).toEqual({ timeout: MCP_DEFAULT_TIMEOUT_MS })
    // A delay above int32 (or Infinity) fires after 1 ms in Node — never use it.
    expect(sdkTimeout({ timeoutMs: 0 })).toEqual({ timeout: MCP_NO_TIMEOUT_MS })
    expect(MCP_NO_TIMEOUT_MS).toBe(2 ** 31 - 1)
    expect(sdkTimeout({ timeoutMs: 4321 })).toEqual({ timeout: 4321 })
    expect(sdkTimeout({ timeoutMs: -3 })).toEqual({ timeout: MCP_DEFAULT_TIMEOUT_MS })
    expect(sdkTimeout({ timeoutMs: 1e12 })).toEqual({ timeout: MCP_NO_TIMEOUT_MS })
  })
})
