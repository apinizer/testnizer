/**
 * Send-path half of the Send≡Run parity proof for scripts on MCP results
 * (issues #160, #161). The Run half is `tests/main/mcp-script-parity.test.ts`:
 * both feed the SAME fixtures (`tests/fixtures/mcp-script-parity.ts`) — an MCP
 * call outcome + post-response script + assertion rows — and hold them to the
 * SAME expectations: env writes, pm.test / row outcomes, and the endpoint
 * verdict (`endpointDidPass`, the one rule the Runner and its result UI use).
 *
 * Here the outcome goes through the renderer's real MCP post-call path,
 * `runMcpPostChecks` (what `mcp.store` calls after a tool / resource / prompt
 * call): `mcpOutcomeToResponse` → `pm.response` + assertion rows,
 * `mcpScriptInfo` → `pm.mcp`, env writes → `applyScriptUpdates`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestAssertion } from '../../src/renderer/types'
import { mcpParityCases } from '../fixtures/mcp-script-parity'
import { runMcpPostChecks, type McpScriptContext } from '../../src/renderer/lib/mcp-send-scripts'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { endpointDidPass } from '../../src/shared/runner-verdict'
import { mcpOutcomeToResponse } from '../../src/shared/mcp-response'

let envWrites: Record<string, string>

beforeEach(() => {
  envWrites = {}
  useEnvironmentStore.setState({
    getActiveVariables: () => ({}),
    globalVariables: [],
    applyScriptUpdates: vi.fn(async (env: Record<string, string>) => {
      Object.assign(envWrites, env)
    }),
  } as never)
})

function ctxFor(script: string, assertions: TestAssertion[]): McpScriptContext {
  return {
    tabId: null,
    requestName: 'parity',
    url: 'http://mcp-parity.test',
    headers: [],
    preScripts: [],
    postScripts: script.trim() ? [script] : [],
    assertions,
    overrides: {},
    logs: [],
  }
}

describe('MCP script parity — Send path', () => {
  for (const c of mcpParityCases) {
    it(c.name, async () => {
      const run = await runMcpPostChecks(
        ctxFor(c.script, (c.assertions ?? []) as unknown as TestAssertion[]),
        c.outcome,
      )
      const results = run?.results ?? []
      expect(run?.scriptError).toBeUndefined()

      // Env writes — subset match, like the Run half.
      for (const [key, value] of Object.entries(c.expectEnv)) {
        expect(envWrites[key], `env ${key}`).toBe(value)
      }

      // Rows + pm.test outcomes, by name, in order.
      expect(results.map((r) => ({ name: r.assertion.name, passed: r.passed }))).toEqual(
        c.expectTests,
      )

      // The verdict — the same shared rule the Runner applies to its row.
      const status = mcpOutcomeToResponse(c.outcome)?.code ?? null
      const verdict = endpointDidPass({
        failed: results.filter((r) => !r.passed).length,
        status,
        assertions: results,
      })
      expect(verdict).toBe(c.expectPassed)
    })
  }
})
