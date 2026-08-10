/**
 * Regression test for the Security-page IA migration: the four security tools
 * (JWT, WS-Security, Password Generator, OTP) moved out of the Tools panel into
 * the Security panel. This locks two invariants halil flagged:
 *   1. TOOL_CATALOG is partitioned into TOOLS_MENU + SECURITY_TOOLS with NO loss
 *      and NO double-listing (a tool has exactly one home).
 *   2. The full TOOL_CATALOG is untouched, so command-registry (Cmd+K, which
 *      iterates TOOL_CATALOG) and tools-bridge (which opens by protocol) keep
 *      resolving the moved tools.
 */
import { describe, it, expect } from 'vitest'
import { TOOL_CATALOG, TOOLS_MENU, SECURITY_TOOLS } from '../../src/renderer/lib/tools-catalog'
import type { ToolProtocol } from '../../src/renderer/types'

const SECURITY_PROTOCOLS: ToolProtocol[] = [
  'tools.jwt',
  'tools.wsSecurity',
  'tools.passwordGen',
  'tools.otp',
]

describe('Security page tool migration', () => {
  it('partitions TOOL_CATALOG into TOOLS_MENU + SECURITY_TOOLS with no loss or overlap', () => {
    expect(TOOLS_MENU.length + SECURITY_TOOLS.length).toBe(TOOL_CATALOG.length)
    const menu = new Set(TOOLS_MENU.map((t) => t.protocol))
    const sec = new Set(SECURITY_TOOLS.map((t) => t.protocol))
    // No tool appears in both panels.
    for (const p of sec) expect(menu.has(p)).toBe(false)
    // The union covers exactly the full catalog.
    const union = new Set([...menu, ...sec])
    expect(union.size).toBe(TOOL_CATALOG.length)
    for (const tool of TOOL_CATALOG) expect(union.has(tool.protocol)).toBe(true)
  })

  it('routes the four security tools to SECURITY_TOOLS, out of TOOLS_MENU', () => {
    const menu = new Set(TOOLS_MENU.map((t) => t.protocol))
    const sec = new Set(SECURITY_TOOLS.map((t) => t.protocol))
    for (const p of SECURITY_PROTOCOLS) {
      expect(sec.has(p)).toBe(true)
      expect(menu.has(p)).toBe(false)
    }
  })

  it('keeps every moved tool in TOOL_CATALOG so Cmd+K + tools-bridge still resolve them', () => {
    const protocols = new Set(TOOL_CATALOG.map((t) => t.protocol))
    for (const p of SECURITY_PROTOCOLS) expect(protocols.has(p)).toBe(true)
    // The WS-Security bridge target (tools-bridge#openWsSecurityToolWith) must exist.
    expect(protocols.has('tools.wsSecurity')).toBe(true)
  })
})
