/**
 * Review item 17 — one Turkish term for an MCP "prompt". The TR MCP UI calls
 * it "istem" (İstemler tab, "İstemi getir", Mock MCP "İstem ekle", …); a few
 * strings said "prompt". Code identifiers (`prompt`, `prompts/get`,
 * `GetPromptResult`) stay as they are — only prose is checked.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setLocale, t } from '../../src/renderer/lib/i18n'

const SRC = readFileSync(resolve(__dirname, '../../src/renderer/lib/i18n.ts'), 'utf8')
const MCP_KEY = /^(mcp\.|mockMcp\.|scriptHelp\.api\.mcp|scriptHelp\.mcp\.|scriptHelp\.section\.mcp)/

const keys = [...new Set([...SRC.matchAll(/^ {4}'([a-zA-Z0-9_.]+)':/gm)].map((m) => m[1]))].filter(
  (k) => MCP_KEY.test(k),
)

/** Prose only: code spans and API identifiers removed. */
const prose = (text: string): string =>
  text
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b[A-Za-z]*Prompt[A-Za-z]*Result\b/g, ' ')
    .replace(/\bprompts\/[a-z]+\b/g, ' ')

afterEach(() => setLocale('en'))

describe('TR MCP strings call a prompt "istem"', () => {
  it('no Turkish MCP string says "prompt" in prose', () => {
    setLocale('tr')
    expect(keys.length).toBeGreaterThan(50)
    const offenders = keys.filter((k) => /\bprompt/i.test(prose(t(k)))).map((k) => `${k}: ${t(k)}`)
    expect(offenders).toEqual([])
  })
})
