/**
 * Issue #162 — schema-driven tool arguments. The tool pane gets a Form / JSON
 * toggle (remembered per user); the form is built from `inputSchema` and
 * edits the SAME `toolArgs` JSON the JSON view edits. `{{var}}` is allowed in
 * every input, numeric ones included (kept as a string, typed back at call
 * time). Schemas the form cannot represent fall back to JSON with a one-line
 * note. The form view validates before Invoke ("Invoke anyway" sends as is),
 * and the store's error texts come from i18n.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  REMOVE,
  leafValue,
  loadArgsView,
  planArgsForm,
  prepareToolArgs,
  validateArgs,
} from '../../src/renderer/lib/mcp-args-form'
import { toField } from '../../src/renderer/lib/mcp-elicitation'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { setLocale } from '../../src/renderer/lib/i18n'
import McpToolPane from '../../src/renderer/components/protocols/mcp/McpToolPane'

const SCHEMA = {
  type: 'object',
  properties: {
    city: { type: 'string', description: 'City name', minLength: 2 },
    days: { type: 'integer', minimum: 1, maximum: 7, default: 3 },
    units: { type: 'string', enum: ['metric', 'imperial'] },
    alerts: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
    where: {
      type: 'object',
      properties: { lat: { type: 'number' }, lon: { type: 'number' } },
      required: ['lat'],
    },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['city'],
}

describe('planArgsForm', () => {
  it('builds leaves, arrays of primitives and nested objects', () => {
    const plan = planArgsForm(SCHEMA)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const kinds = plan.fields.map((f) =>
      f.kind === 'leaf'
        ? `${f.name}:${f.field.kind}${f.field.required ? '*' : ''}`
        : `${f.name}:${f.kind}`,
    )
    expect(kinds).toEqual([
      'city:string*',
      'days:integer',
      'units:enum',
      'alerts:boolean',
      'tags:array',
      'where:object',
      // Optional[str] (pydantic's anyOf [X, null]) is just a string field.
      'note:string',
    ])
    const where = plan.fields.find((f) => f.name === 'where')
    expect(where?.kind === 'object' && where.children.map((c) => c.path.join('.'))).toEqual([
      'where.lat',
      'where.lon',
    ])
  })

  it.each([
    [
      { type: 'object', properties: { a: { oneOf: [{ type: 'string' }, { type: 'number' }] } } },
      'composition',
    ],
    [{ type: 'object', properties: { a: { $ref: '#/$defs/A' } } }, 'ref'],
    [{ type: 'object', patternProperties: { '^x': { type: 'string' } } }, 'patternProperties'],
    [
      { type: 'object', properties: { a: { type: 'array', items: { type: 'object' } } } },
      'arrayOfObjects',
    ],
  ])('%j → JSON only (%s)', (schema, reason) => {
    expect(planArgsForm(schema)).toEqual({ ok: false, reason })
  })

  it('a titled oneOf-const enum is a form field, not a composition', () => {
    const plan = planArgsForm({
      type: 'object',
      properties: {
        size: {
          oneOf: [
            { const: 's', title: 'Small' },
            { const: 'l', title: 'Large' },
          ],
        },
      },
    })
    expect(plan.ok && plan.fields[0].kind === 'leaf' && plan.fields[0].field.kind).toBe('enum')
  })
})

describe('leafValue / validateArgs / prepareToolArgs', () => {
  const int = toField('n', { type: 'integer' }, false)
  it('number inputs: canonical text → number, partial text stays text, {{var}} stays a string', () => {
    expect(leafValue(int, '5')).toBe(5)
    expect(leafValue(int, '1.0')).toBe('1.0')
    expect(leafValue(int, '{{n}}')).toBe('{{n}}')
    expect(leafValue(int, '')).toBe(REMOVE)
  })

  it('review item 5: a number field takes non-canonical decimals; an integer only whole numbers', () => {
    const num = toField('x', { type: 'number' }, false)
    expect(leafValue(num, '0.70')).toBe(0.7)
    expect(leafValue(num, '1.0')).toBe(1)
    expect(leafValue(num, '2.50')).toBe(2.5)
    expect(leafValue(num, '1.')).toBe('1.')
    expect(leafValue(int, '10')).toBe(10)
    // `1.0` in an integer field stays text → the form flags it, never sends it as 1.
    expect(validateArgs({ n: leafValue(int, '1.0') }, { type: 'object', properties: { n: { type: 'integer' } } })).toEqual([
      { path: 'n', reason: 'type', expected: 'integer' },
    ])
    expect(validateArgs({ x: leafValue(num, '0.70') }, { type: 'object', properties: { x: { type: 'number' } } })).toEqual([])
  })

  it('reports required / type / enum / bounds, skipping {{var}} values', () => {
    const problems = validateArgs(
      { days: 9, units: 'kelvin', tags: ['a', 3], where: {}, city: '{{city}}' },
      SCHEMA,
    )
    // Schema property order: days, units, tags, where.
    expect(problems).toEqual([
      { path: 'days', reason: 'maximum', limit: 7 },
      { path: 'units', reason: 'enum', expected: 'metric, imperial' },
      { path: 'tags[1]', reason: 'type', expected: 'string' },
      { path: 'where.lat', reason: 'required' },
    ])
    expect(validateArgs({ city: 'x' }, SCHEMA)).toEqual([
      { path: 'city', reason: 'minLength', limit: 2 },
    ])
    expect(validateArgs({}, SCHEMA)).toEqual([{ path: 'city', reason: 'required' }])
  })

  it('a {{var}} in a number / boolean field reaches the call typed', () => {
    const prepared = prepareToolArgs(
      '{"city":"{{c}}","days":"{{n}}","alerts":"{{on}}"}',
      { c: 'Rome', n: '5', on: 'true' },
      SCHEMA,
    )
    expect(prepared.args).toEqual({ city: 'Rome', days: 5, alerts: true })
  })
})

// ─── Store + UI ─────────────────────────────────────────────────────────────

function installApi() {
  const mcp = {
    connect: vi.fn(async () => ({
      success: true,
      data: { connectionId: 'conn-1', transport: 'http', url: 'http://x/mcp' },
    })),
    cancelConnect: vi.fn(async () => ({ success: true, data: { canceled: true } })),
    disconnect: vi.fn(async () => ({ success: true, data: true })),
    listTools: vi.fn(async () => ({
      success: true,
      data: [
        { name: 'forecast', inputSchema: SCHEMA },
        {
          name: 'union',
          inputSchema: {
            type: 'object',
            properties: { a: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
          },
        },
      ],
    })),
    callTool: vi.fn(async () => ({ success: true, data: { content: [] } })),
  }
  ;(window as unknown as { api: { mcp: typeof mcp } }).api = { mcp }
  return mcp
}

let mcp: ReturnType<typeof installApi>

async function connected(tool = 'forecast'): Promise<void> {
  useTabsStore.setState({
    tabs: [{ id: 'tab-f', name: 'f', protocol: 'mcp', isDirty: false } as never],
    activeTabId: 'tab-f',
  })
  useMcpStore.getState().switchToTab('tab-f')
  useMcpStore.setState({ url: 'http://x/mcp', transport: 'http' })
  await useMcpStore.getState().connect()
  useMcpStore.getState().setSelectedTool(tool)
}

const args = (): Record<string, unknown> => JSON.parse(useMcpStore.getState().toolArgs)

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
  mcp = installApi()
  useEnvironmentStore.setState({ getActiveVariables: () => ({ n: '4' }) } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
})
afterEach(() => {
  cleanup()
  setLocale('en')
})

describe('Form / JSON toggle (issue #162)', () => {
  it('Form is the default (issue #162 decision); a JSON choice is remembered across remounts', async () => {
    await connected()
    const { unmount } = render(<McpToolPane />)
    expect(screen.queryByTestId('mcp-tool-args')).toBeNull()
    expect(screen.getByTestId('mcp-arg-city')).toBeTruthy()
    expect(screen.getByTestId('mcp-args-view-form').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('mcp-args-view-json'))
    expect(screen.getByTestId('mcp-tool-args')).toBeTruthy()
    expect(localStorage.getItem('testnizer-mcp-args-view')).toBe('json')
    unmount()
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-tool-args')).toBeTruthy()
  })

  it('a stored Form choice still wins, and so does a stored JSON one', () => {
    localStorage.setItem('testnizer-mcp-args-view', 'json')
    expect(loadArgsView()).toBe('json')
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    expect(loadArgsView()).toBe('form')
    localStorage.removeItem('testnizer-mcp-args-view')
    expect(loadArgsView()).toBe('form')
  })

  it('both views edit the same toolArgs (single source of truth)', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'json')
    await connected()
    render(<McpToolPane />)
    fireEvent.change(screen.getByTestId('mcp-tool-args'), {
      target: { value: '{"city":"Oslo","extra":true}' },
    })
    fireEvent.click(screen.getByTestId('mcp-args-view-form'))
    expect((screen.getByTestId('mcp-arg-city') as HTMLInputElement).value).toBe('Oslo')
    fireEvent.change(screen.getByTestId('mcp-arg-city'), { target: { value: 'Rome' } })
    fireEvent.change(screen.getByTestId('mcp-arg-days'), { target: { value: '{{n}}' } })
    fireEvent.click(screen.getByTestId('mcp-arg-alerts'))
    fireEvent.change(screen.getByTestId('mcp-arg-where_lat'), { target: { value: '41.9' } })
    // A key the form does not know survives a form edit.
    expect(args()).toEqual({
      city: 'Rome',
      days: '{{n}}',
      alerts: true,
      where: { lat: 41.9 },
      extra: true,
    })
    fireEvent.click(screen.getByTestId('mcp-args-view-json'))
    expect(JSON.parse((screen.getByTestId('mcp-tool-args') as HTMLTextAreaElement).value)).toEqual(
      args(),
    )
  })

  it('array rows can be added and removed; a nested object is an indented group', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-arg-group-where')).toBeTruthy()
    fireEvent.click(screen.getByTestId('mcp-arg-tags-add'))
    fireEvent.click(screen.getByTestId('mcp-arg-tags-add'))
    fireEvent.change(screen.getByTestId('mcp-arg-tags-0'), { target: { value: 'a' } })
    fireEvent.change(screen.getByTestId('mcp-arg-tags-1'), { target: { value: 'b' } })
    expect(args().tags).toEqual(['a', 'b'])
    fireEvent.click(screen.getByTestId('mcp-arg-tags-remove-0'))
    expect(args().tags).toEqual(['b'])
  })

  it('shows required markers and descriptions', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    const city = screen.getByTestId('mcp-arg-city').closest('label')
    expect(city?.textContent).toContain('*')
    expect(city?.textContent).toContain('City name')
  })

  it('a schema the form cannot represent opens JSON with a one-line note', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected('union')
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-tool-args')).toBeTruthy()
    expect(screen.getByTestId('mcp-args-unsupported').textContent).toMatch(/oneOf \/ anyOf/)
    expect((screen.getByTestId('mcp-args-view-form') as HTMLButtonElement).disabled).toBe(true)
  })

  it('invalid JSON in the form view shows a note and never rewrites the args', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    useMcpStore.setState({ toolArgs: '{"city": ' })
    render(<McpToolPane />)
    expect(screen.getByTestId('mcp-args-invalid-json')).toBeTruthy()
    expect(useMcpStore.getState().toolArgs).toBe('{"city": ')
  })
})

describe('validation before Invoke (issue #162)', () => {
  it('form view: problems block the call; "Invoke anyway" sends as typed', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(mcp.callTool).not.toHaveBeenCalled()
    expect(screen.getByTestId('mcp-args-problems').textContent).toContain('"city" is required')
    expect(screen.getByTestId('mcp-arg-city').className).toContain('border-[var(--red)]')

    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-args-invoke-anyway'))
    })
    expect(mcp.callTool).toHaveBeenCalledTimes(1)
  })

  it('fixing the field clears its problem', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(screen.getByTestId('mcp-args-problems').textContent).toContain('"city"')
    // Starting the optional `where` group makes its required `lat` count.
    fireEvent.change(screen.getByTestId('mcp-arg-where_lon'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('mcp-arg-city'), { target: { value: 'Rome' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    // `where.lat` is still missing; the city marker and line are gone.
    expect(screen.getByTestId('mcp-args-problems').textContent).toContain('"where.lat"')
    expect(screen.getByTestId('mcp-args-problems').textContent).not.toContain('"city"')
    expect(screen.getByTestId('mcp-arg-city').className).not.toContain('border-[var(--red)]')
    fireEvent.change(screen.getByTestId('mcp-arg-where_lat'), { target: { value: '1' } })
    expect(screen.queryByTestId('mcp-args-problems')).toBeNull()
  })

  it('a {{var}} typed into the integer field reaches callTool as a number', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    fireEvent.change(screen.getByTestId('mcp-arg-city'), { target: { value: 'Rome' } })
    fireEvent.change(screen.getByTestId('mcp-arg-days'), { target: { value: '{{n}}' } })
    fireEvent.change(screen.getByTestId('mcp-arg-where_lat'), { target: { value: '41.9' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-1',
      'forecast',
      expect.objectContaining({ city: 'Rome', days: 4 }),
      expect.anything(),
    )
  })

  it('review item 5: 0.70 / 2.50 in a number field are valid and sent as numbers; the input keeps the text', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    fireEvent.change(screen.getByTestId('mcp-arg-city'), { target: { value: 'Rome' } })
    fireEvent.change(screen.getByTestId('mcp-arg-where_lat'), { target: { value: '0.70' } })
    fireEvent.change(screen.getByTestId('mcp-arg-where_lon'), { target: { value: '2.50' } })
    // Typing is never rewritten under the cursor.
    expect((screen.getByTestId('mcp-arg-where_lat') as HTMLInputElement).value).toBe('0.70')
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(screen.queryByTestId('mcp-args-problems')).toBeNull()
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-1',
      'forecast',
      expect.objectContaining({ where: { lat: 0.7, lon: 2.5 } }),
      expect.anything(),
    )
  })

  it('JSON view sends without pre-validation (negative tests stay possible)', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'json')
    await connected()
    useMcpStore.setState({ toolArgs: '{"days": 99}' })
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).toHaveBeenCalledWith('conn-1', 'forecast', { days: 99 }, expect.anything())
  })
})

describe('empty optional fields are not sent from the Form view (#162 follow-up)', () => {
  it('form view: selecting a tool seeds only required fields + schema defaults', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    // `city` is required (empty → validation error), `days` has a default;
    // every other optional field is left out instead of being sent as "" / [] / {}.
    expect(args()).toEqual({ city: '', days: 3 })
    render(<McpToolPane />)
    fireEvent.change(screen.getByTestId('mcp-arg-city'), { target: { value: 'Rome' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-1',
      'forecast',
      { city: 'Rome', days: 3 },
      expect.anything(),
    )
  })

  it('a required field left empty is still a validation error', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('mcp-invoke'))
    })
    expect(mcp.callTool).not.toHaveBeenCalled()
    expect(screen.getByTestId('mcp-args-problems').textContent).toContain('"city" is required')
  })

  it('JSON view keeps the full skeleton and sends exactly what is typed', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'json')
    await connected()
    expect(args()).toEqual({
      city: '',
      days: 3,
      units: 'metric',
      alerts: false,
      tags: [],
      where: {},
      note: null,
    })
    await useMcpStore.getState().callTool()
    expect(mcp.callTool).toHaveBeenCalledWith(
      'conn-1',
      'forecast',
      { city: '', days: 3, units: 'metric', alerts: false, tags: [], where: {}, note: null },
      expect.anything(),
    )
  })

  it('switching JSON → Form drops the empty optional values the form cannot show', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'json')
    await connected()
    render(<McpToolPane />)
    fireEvent.click(screen.getByTestId('mcp-args-view-form'))
    // "" / [] / {} / null under optional keys go; typed values and required keys stay.
    expect(args()).toEqual({ city: '', days: 3, units: 'metric', alerts: false })
  })

  it('removing the last row of an optional array removes the key', async () => {
    localStorage.setItem('testnizer-mcp-args-view', 'form')
    await connected()
    render(<McpToolPane />)
    fireEvent.click(screen.getByTestId('mcp-arg-tags-add'))
    fireEvent.change(screen.getByTestId('mcp-arg-tags-0'), { target: { value: 'a' } })
    expect(args().tags).toEqual(['a'])
    fireEvent.click(screen.getByTestId('mcp-arg-tags-remove-0'))
    expect('tags' in args()).toBe(false)
  })
})

describe('store error texts come from i18n (issue #162)', () => {
  it('invalid JSON reads in Turkish when the UI is Turkish', async () => {
    await connected()
    setLocale('tr')
    useMcpStore.setState({ toolArgs: '{nope' })
    await useMcpStore.getState().callTool()
    expect(useMcpStore.getState().resultError).toBe('Argümanlarda geçersiz JSON')
  })
})
