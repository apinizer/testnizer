import { describe, it, expect } from 'vitest'
import { tabBelongsToPage } from '../../src/renderer/lib/sidebar-pages'

describe('tabBelongsToPage', () => {
  it('routes suite-item tabs to the Tests page regardless of protocol', () => {
    const suiteTab = { protocol: 'http', testSuiteItemId: 'item-1' }
    expect(tabBelongsToPage(suiteTab, 'tests')).toBe(true)
    expect(tabBelongsToPage(suiteTab, 'apis')).toBe(false)
    expect(tabBelongsToPage(suiteTab, 'mocks')).toBe(false)
  })

  it('routes mock-server tabs to the Mocks page regardless of protocol', () => {
    const mockTab = { protocol: 'http', mockServerId: 'server-1' }
    expect(tabBelongsToPage(mockTab, 'mocks')).toBe(true)
    expect(tabBelongsToPage(mockTab, 'apis')).toBe(false)
    expect(tabBelongsToPage(mockTab, 'tests')).toBe(false)
  })

  it('runner protocol pins to Tests', () => {
    expect(tabBelongsToPage({ protocol: 'runner' }, 'tests')).toBe(true)
    expect(tabBelongsToPage({ protocol: 'runner' }, 'apis')).toBe(false)
  })

  it('mockServer protocol pins to Mocks', () => {
    expect(tabBelongsToPage({ protocol: 'mockServer' }, 'mocks')).toBe(true)
    expect(tabBelongsToPage({ protocol: 'mockServer' }, 'apis')).toBe(false)
  })

  it('tools.* tabs show on both APIs and Tools pages', () => {
    const tool = { protocol: 'tools.jwt' }
    expect(tabBelongsToPage(tool, 'apis')).toBe(true)
    expect(tabBelongsToPage(tool, 'tools')).toBe(true)
    expect(tabBelongsToPage(tool, 'tests')).toBe(false)
    expect(tabBelongsToPage(tool, 'mocks')).toBe(false)
  })

  it.each(['http', 'soap', 'websocket', 'graphql', 'grpc', 'sse', 'mcp', 'ai-chat', 'socketio'])(
    'request-style protocol %s pins to APIs',
    (protocol) => {
      expect(tabBelongsToPage({ protocol }, 'apis')).toBe(true)
      expect(tabBelongsToPage({ protocol }, 'tests')).toBe(false)
      expect(tabBelongsToPage({ protocol }, 'mocks')).toBe(false)
      expect(tabBelongsToPage({ protocol }, 'tools')).toBe(false)
    },
  )

  it('tab-kind takes priority — a runner protocol with testSuiteItemId still goes to Tests', () => {
    // Defensive: real code won't set both, but the predicate should still be
    // deterministic so a future bug doesn't flip pages.
    const oddTab = { protocol: 'runner', testSuiteItemId: 'x' }
    expect(tabBelongsToPage(oddTab, 'tests')).toBe(true)
    expect(tabBelongsToPage(oddTab, 'apis')).toBe(false)
  })
})
