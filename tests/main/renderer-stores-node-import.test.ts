// @vitest-environment node
/**
 * Guard — the protocol stores load in a node environment (no DOM).
 *
 * Main-process tests import pure helpers from renderer stores
 * (`tests/main/grpc-engine.test.ts` → `grpc.store`). The issue #244 send
 * guard (`lib/withheld-before-send.ts`) imported `lib/toast` + `lib/i18n`
 * statically; `i18n` loads `ui.store`, whose module body touched `document`
 * (initial theme) — `ReferenceError: document is not defined`, and the whole
 * suite failed to load. The warning modules are now loaded lazily and
 * `ui.store` applies its DOM defaults only when a DOM exists.
 */
import { describe, expect, it } from 'vitest'

describe('protocol stores import without a DOM', () => {
  it('has no document in this environment', () => {
    expect(typeof document).toBe('undefined')
  })

  for (const name of [
    'grpc.store',
    'graphql.store',
    'sse.store',
    'websocket.store',
    'socketio.store',
    'mqtt.store',
    'mcp.store',
    'request.store',
    'soap.store',
  ]) {
    it(`${name} loads`, async () => {
      const mod = (await import(`../../src/renderer/stores/${name}.ts`)) as Record<string, unknown>
      expect(Object.keys(mod).length).toBeGreaterThan(0)
    })
  }

  it('the send guard loads without the toast / i18n modules', async () => {
    const mod = await import('../../src/renderer/lib/withheld-before-send')
    expect(typeof mod.reloadWithheldBeforeSend).toBe('function')
  })
})
