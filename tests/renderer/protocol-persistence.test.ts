/**
 * #18 — Protocol state must round-trip through snapshotProtocol /
 * restoreProtocolFromMetadata. GraphQL had no branch at all (its query/
 * variables/headers were never captured), so save → close → reopen dropped
 * them. This pins the GraphQL round-trip and the generic mechanism.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotProtocol, restoreProtocolFromMetadata } from '../../src/renderer/lib/save-active-request'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import type { Tab } from '../../src/renderer/types'

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }
})

describe('protocol persistence round-trip (#18)', () => {
  it('captures and restores GraphQL url/query/variables/headers', () => {
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      url: 'https://gql.test/graphql',
      query: 'query { me { id } }',
      variables: '{"x":1}',
      headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer t', enabled: true }],
    })

    const snap = snapshotProtocol({ id: 'tab-1', protocol: 'graphql', name: 'GQL' } as Tab)
    expect(snap.protocolMeta).toHaveProperty('graphql')

    // Simulate close (state cleared) then reopen.
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      url: '',
      query: '',
      variables: '{}',
      headers: [],
    })
    restoreProtocolFromMetadata('graphql', snap.protocolMeta)

    const g = useGraphQLStore.getState()
    expect(g.url).toBe('https://gql.test/graphql')
    expect(g.query).toBe('query { me { id } }')
    expect(g.variables).toBe('{"x":1}')
    expect(g.headers.map((h) => [h.key, h.value])).toEqual([['Authorization', 'Bearer t']])
  })
})
