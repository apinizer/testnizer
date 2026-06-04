/**
 * URL ⇄ query-param sync (issue #22). Adding a param through the Params tab
 * must reflect in the URL bar, and typing a query in the URL must populate the
 * Params tab — without losing disabled rows.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'

function reset(): void {
  useRequestStore.setState({ url: '', params: [] })
}

describe('request store — URL ⇄ params sync (#22)', () => {
  beforeEach(reset)

  it('adding + filling a param updates the URL query string', () => {
    const s = useRequestStore.getState()
    s.setUrl('https://api.example.com/users')
    s.addParam()
    const id = useRequestStore.getState().params[0].id
    s.updateParam(id, { key: 'id', value: '42' })
    expect(useRequestStore.getState().url).toBe('https://api.example.com/users?id=42')
  })

  it('removing a param strips it from the URL', () => {
    const s = useRequestStore.getState()
    s.setUrl('https://api.example.com/users?id=42')
    expect(useRequestStore.getState().params).toHaveLength(1)
    s.removeParam(useRequestStore.getState().params[0].id)
    expect(useRequestStore.getState().url).toBe('https://api.example.com/users')
  })

  it('typing a query in the URL populates the Params tab', () => {
    const s = useRequestStore.getState()
    s.setUrl('https://api.example.com/s?empNo={{test_empNo}}&active=true')
    const params = useRequestStore.getState().params
    expect(params.map((p) => [p.key, p.value])).toEqual([
      ['empNo', '{{test_empNo}}'],
      ['active', 'true'],
    ])
  })

  it('preserves {{variables}} unencoded in the URL', () => {
    const s = useRequestStore.getState()
    s.setUrl('https://api.example.com/s')
    s.addParam()
    const id = useRequestStore.getState().params[0].id
    s.updateParam(id, { key: 'token', value: '{{authToken}}' })
    expect(useRequestStore.getState().url).toBe('https://api.example.com/s?token={{authToken}}')
  })

  it('keeps disabled params (which never appear in the URL) when the URL changes', () => {
    const s = useRequestStore.getState()
    useRequestStore.setState({
      url: 'https://api.example.com/s?a=1',
      params: [
        { id: 'p1', key: 'a', value: '1', enabled: true },
        { id: 'p2', key: 'secret', value: 'x', enabled: false },
      ],
    })
    s.setUrl('https://api.example.com/s?a=2')
    const params = useRequestStore.getState().params
    expect(params.find((p) => p.key === 'a')?.value).toBe('2')
    // The disabled row survives even though it's not in the URL.
    expect(params.find((p) => p.key === 'secret' && !p.enabled)).toBeTruthy()
  })
})
