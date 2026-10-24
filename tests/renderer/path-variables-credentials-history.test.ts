/**
 * Issue #276 — path variables follow the existing credential rules:
 *  - #243/#247: a credential-NAMED path variable (`:token`) with a literal
 *    value is left out of the tab snapshot (localStorage) and refilled from
 *    the saved row; a `{{var}}` value is kept;
 *  - #195: History keeps the rows in `configured` (re-send works), a
 *    credential-named value masked by main comes back empty and is reported.
 */
import { describe, expect, it } from 'vitest'
import { HTTP_CREDENTIALS } from '../../src/renderer/stores/request.store'
import { restoreWithheld, withholdCredentials } from '../../src/renderer/lib/credential-withhold'
import { httpHistoryRestore } from '../../src/renderer/lib/history-restore'
import type { HistoryEntry, KeyValuePair } from '../../src/renderer/types'

const row = (id: string, key: string, value: string): KeyValuePair => ({
  id,
  key,
  value,
  enabled: true,
})

describe('issue #276 — credential-named path variables are not persisted literally', () => {
  it('withholds the literal, keeps {{var}} and plain names, refills from the row', () => {
    const state = {
      url: 'https://x.test/:token/:id/:apiKey',
      pathVariables: [row('a', 'token', 'LITERAL-SECRET'), row('b', 'id', '42'), row('c', 'apiKey', '{{key}}')],
      withheldCredentials: [] as string[],
    }
    const out = withholdCredentials(state, HTTP_CREDENTIALS)
    expect(out.pathVariables.map((r) => r.value)).toEqual(['', '42', '{{key}}'])
    expect(out.withheldCredentials.some((p) => p.startsWith('pathVariables'))).toBe(true)
    expect(JSON.stringify(out)).not.toContain('LITERAL-SECRET')

    const back = restoreWithheld(
      out,
      { pathVariables: [{ id: 'a', key: 'token', value: 'LITERAL-SECRET' }] },
      HTTP_CREDENTIALS,
    ) as { pathVariables: KeyValuePair[]; withheldCredentials: string[] }
    expect(back.pathVariables[0].value).toBe('LITERAL-SECRET')
    expect(back.withheldCredentials).toEqual([])
  })
})

describe('issue #276 — History rows carry the path variables', () => {
  it('reopening restores them from configured; a masked credential value comes back empty', () => {
    const entry = {
      url: 'https://x.test/u/42',
      method: 'GET',
      protocol: 'http',
      request_snapshot: {
        configured: {
          method: 'GET',
          url: 'https://x.test/u/:id/:token',
          pathVariables: [
            { id: 'a', key: 'id', value: '42' },
            { id: 'b', key: 'token', value: '••••••' },
          ],
        },
      },
    } as unknown as HistoryEntry
    const r = httpHistoryRestore(entry)
    expect(r.url).toBe('https://x.test/u/:id/:token')
    expect(r.pathVariables.map((p) => [p.key, p.value])).toEqual([
      ['id', '42'],
      ['token', ''],
    ])
    expect(r.hidden.some((h) => h.includes('pathVariables'))).toBe(true)
  })
})
