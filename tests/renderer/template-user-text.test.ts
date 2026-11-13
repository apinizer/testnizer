/**
 * User text in a translated sentence stays exactly as typed.
 *
 * These sentences used to be filled with `t(k).replace('{x}', value)`: the
 * value was a replacement string, so `$&` became the placeholder itself and a
 * value holding another placeholder (`{detail}`) was filled by the next
 * `.replace` in the chain. `t(key, values)` / `fillTemplate` insert the value
 * verbatim (guard: no-template-replace.test.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { saveMockMcpDraft } from '../../src/renderer/components/mock-mcp/mock-mcp-save'
import { serverToDraft } from '../../src/renderer/components/mock-mcp/mock-mcp-draft'
import { useMockMcpStore } from '../../src/renderer/stores/mock-mcp.store'
import { curlWarningText } from '../../src/renderer/lib/curl-paste'
import { skippedFilesMessage } from '../../src/renderer/lib/pull-messages'
import { setLocale, t } from '../../src/renderer/lib/i18n'
import { sampleServer } from './mock-mcp-bridge-stub'

beforeEach(() => setLocale('en'))

describe('a name with `$&` or a placeholder in a translated sentence', () => {
  it('Mock MCP save error names the tool as typed', async () => {
    const draft = serverToDraft(sampleServer({ id: 's1' }))
    draft.tools = [{ ...draft.tools[0], name: '$& {detail}', schemaText: '{ nope' }]
    useMockMcpStore.setState({ drafts: { s1: draft } })

    const r = await saveMockMcpDraft('s1')

    expect(r.ok).toBe(false)
    const error = r.ok ? '' : (r.error ?? '')
    expect(error.startsWith('Tool "$& {detail}": the input schema is not valid JSON — ')).toBe(true)
    // The JSON parser's message is filled once, after the tool name.
    expect(error.split('{detail}')).toHaveLength(2)
  })

  it('cURL paste warning keeps the flag text', () => {
    expect(curlWarningText(t, { code: 'unknown-flag', arg: "--$&-$1-$$-$'", message: 'x' })).toBe(
      "Unknown option --$&-$1-$$-$' was ignored",
    )
  })

  it('pull warning lists file names as they are in the repository', () => {
    expect(skippedFilesMessage(t, ['$&.json'])).toBe(
      '1 file in the repository was not read because it is a link, a special file or too large: $&.json',
    )
  })
})
