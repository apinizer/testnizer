/**
 * Issue #309 — the mock editor's "Insert example…" pickers listed their 24
 * presets (`lib/mock-snippets.ts`) by English names in the Turkish UI.
 *
 * CONTRACT:
 *   - every snippet has a stable `id`; its name and description come from
 *     `mock.snippet.<id>.label` / `mock.snippet.<id>.description`, defined
 *     in BOTH locales (dynamic keys, so the key-coverage test cannot see them);
 *   - the pickers render the name in the active locale and the description as
 *     the option's `title`;
 *   - option VALUES stay the array index (`0…n-1`) and the inserted body is
 *     the unchanged code — only the names are translated.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import {
  httpEndpoint,
  httpResponse,
  httpServer,
  resetHttpBridge,
  seedHttpBridge,
} from './mock-http-bridge-stub'

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: ({ value }: { value?: string }) =>
    React.createElement('div', { 'data-monaco': '' }, value),
}))

import MockServerEditor from '../../src/renderer/components/mock/MockServerEditor'
import { useMockStore } from '../../src/renderer/stores/mock.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { valuesInAllLocales } from '../../src/renderer/lib/i18n'
import { CONDITION_SNIPPETS, SCRIPT_SNIPPETS } from '../../src/renderer/lib/mock-snippets'
import { useLocale } from './helpers/default-locale-shim'
import type { MockServer } from '../../src/renderer/types'

async function mount(server: MockServer): Promise<void> {
  resetHttpBridge([server])
  seedHttpBridge({ endpoints: [httpEndpoint()], responses: [httpResponse()] })
  useMockStore.setState({
    servers: [server],
    endpointsByServer: {},
    responsesByEndpoint: {},
    statusByServer: {},
    errorByServer: {},
    logsByServer: {},
  })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  render(React.createElement(MockServerEditor, { serverId: server.id }))
  await screen.findByTestId('mock-endpoint-path')
  await screen.findByTestId('mock-response-body-type')
}

interface PickerOption {
  value: string
  text: string
  title: string
}

/** The two pickers' snippet options (the placeholder option dropped), condition first. */
function pickerOptions(title: string): PickerOption[][] {
  const selects = Array.from(document.querySelectorAll(`select[title="${title}"]`))
  return selects.map((sel) =>
    Array.from((sel as HTMLSelectElement).options)
      .filter((o) => o.value !== '')
      .map((o) => ({ value: o.value, text: o.textContent ?? '', title: o.title })),
  )
}

afterEach(() => {
  cleanup()
  useLocale('en')
})

const ALL = [...CONDITION_SNIPPETS, ...SCRIPT_SNIPPETS]

describe('mock snippet names are translated (issue #309)', () => {
  it('every snippet has a unique id with a label + description in both locales', () => {
    expect(ALL).toHaveLength(24)
    const ids = ALL.map((s) => (s as { id?: unknown }).id)
    for (const id of ids) expect(typeof id, String(id)).toBe('string')
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      for (const part of ['label', 'description']) {
        const key = `mock.snippet.${String(id)}.${part}`
        const [en, tr] = valuesInAllLocales(key)
        expect(valuesInAllLocales(key), key).toHaveLength(2)
        expect(en.trim().length, key).toBeGreaterThan(0)
        expect(tr.trim().length, key).toBeGreaterThan(0)
      }
    }
  })

  it('TR pickers show Turkish names; values and bodies are unchanged', async () => {
    useLocale('en')
    await mount(httpServer())
    const en = pickerOptions('Insert example…')
    cleanup()

    useLocale('tr')
    await mount(httpServer())
    const tr = pickerOptions('Örnek ekle…')

    expect(en).toHaveLength(2)
    expect(tr).toHaveLength(2)
    const groups = [CONDITION_SNIPPETS, SCRIPT_SNIPPETS]
    groups.forEach((snippets, g) => {
      expect(tr[g].map((o) => o.value)).toEqual(snippets.map((_, i) => String(i)))
      expect(en[g].map((o) => o.value)).toEqual(snippets.map((_, i) => String(i)))
      snippets.forEach((s, i) => {
        const id = (s as { id?: string }).id ?? ''
        const [enLabel, trLabel] = valuesInAllLocales(`mock.snippet.${id}.label`)
        const [enDesc, trDesc] = valuesInAllLocales(`mock.snippet.${id}.description`)
        expect(en[g][i].text, id).toBe(enLabel)
        expect(en[g][i].title, id).toBe(enDesc)
        expect(tr[g][i].text, id).toBe(trLabel)
        expect(tr[g][i].title, id).toBe(trDesc)
        expect(tr[g][i].text, `${id} TR name differs from EN`).not.toBe(en[g][i].text)
        expect(tr[g][i].title, `${id} TR description differs from EN`).not.toBe(en[g][i].title)
      })
    })
  })

  it('the inserted body is still the code preset (not translated)', () => {
    // Bodies are code: they keep their identifiers and English comments.
    expect(CONDITION_SNIPPETS[0].body).toBe(JSON.stringify({ type: 'always' }, null, 2))
    expect(SCRIPT_SNIPPETS[0].body).toMatch(/^\/\/ In-memory CRUD stub\./)
  })
})
