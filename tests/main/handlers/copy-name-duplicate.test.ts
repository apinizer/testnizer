/**
 * Turkish UI sweep — a duplicate's name follows the UI language.
 *
 * Every Duplicate (tree request / endpoint / folder, tab, Tests item, project)
 * appended a fixed English " (copy)", so a Turkish UI saved "Siparişler
 * (copy)". The rule now has one owner, `lib/copy-name.ts` (`common.copyName`):
 * the suffix is worded in the UI language when the copy is created and saved
 * as data. Main has no dictionary, so the renderer sends the name; the folder
 * deep clone (`folder:duplicate`) used to ignore it and always wrote English.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerProjectHandlers } = await import('../../../src/main/ipc/project.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')
const { copyName } = await import('../../../src/renderer/lib/copy-name')
const { setLocale } = await import('../../../src/renderer/lib/i18n')

let projectId: string

function seedFolder(name: string): string {
  const id = `f-${name}`
  testDb
    .prepare(
      'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)',
    )
    .run(id, projectId, name)
  return id
}

function folderNames(): string[] {
  return (
    testDb.prepare('SELECT name FROM folders ORDER BY name').all() as Array<{ name: string }>
  ).map((r) => r.name)
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerProjectHandlers()
  registerTestSuiteHandlers()
})

afterEach(() => setLocale('en'))

describe('copyName — the duplicate suffix in the UI language', () => {
  it('is " (copy)" in English, byte-identical to the old suffix', () => {
    setLocale('en')
    expect(copyName('Orders')).toBe('Orders (copy)')
  })

  it('is " (kopya)" in Turkish', () => {
    setLocale('tr')
    expect(copyName('Siparişler')).toBe('Siparişler (kopya)')
  })

  it('keeps a name with $& / $1 intact (no String.replace patterns)', () => {
    setLocale('tr')
    expect(copyName('a$&b$1')).toBe('a$&b$1 (kopya)')
  })
})

describe('folder:duplicate takes the renderer-worded name', () => {
  it('names the copied root folder with the name it is given (TR)', async () => {
    const id = seedFolder('Siparişler')
    setLocale('tr')
    const res = (await harness.invoke('folder:duplicate', id, copyName('Siparişler'))) as {
      success: boolean
    }
    expect(res.success).toBe(true)
    expect(folderNames()).toEqual(['Siparişler', 'Siparişler (kopya)'])
  })

  it('falls back to the English suffix when no name is sent', async () => {
    const id = seedFolder('Orders')
    await harness.invoke('folder:duplicate', id)
    expect(folderNames()).toEqual(['Orders', 'Orders (copy)'])
  })
})

/**
 * Source guard: the rule has one owner. A code line that appends a literal
 * " (copy)" (template or string) anywhere in the renderer bypasses
 * `copyName`; in main only the two documented fallbacks may (a caller that
 * sends no name). Comment lines are ignored.
 */
describe('testSuite:duplicate takes the renderer-worded name', () => {
  function seedSuite(name: string): string {
    const id = `s-${name}`
    testDb
      .prepare(
        'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)',
      )
      .run(id, projectId, name)
    return id
  }
  const suiteNames = (): string[] =>
    (
      testDb.prepare('SELECT name FROM test_suites ORDER BY name').all() as Array<{ name: string }>
    ).map((r) => r.name)

  it('names the copied suite with the name it is given (TR)', async () => {
    const id = seedSuite('Duman')
    setLocale('tr')
    await harness.invoke('testSuite:duplicate', id, copyName('Duman'))
    expect(suiteNames()).toEqual(['Duman', 'Duman (kopya)'])
  })

  it('falls back to the English suffix when no name is sent', async () => {
    const id = seedSuite('Smoke')
    await harness.invoke('testSuite:duplicate', id)
    expect(suiteNames()).toEqual(['Smoke', 'Smoke (copy)'])
  })
})

describe('one owner for the copy suffix', () => {
  const SRC = resolve(__dirname, '../../../src')
  const literalCopy = /\s\(copy\)[`'"]/

  function linesWithLiteral(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry) && !full.endsWith('lib/i18n.ts')) {
          readFileSync(full, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              const code = line.trim()
              if (code.startsWith('//') || code.startsWith('*')) return
              if (literalCopy.test(line)) out.push(`${relative(SRC, full)}:${i + 1}`)
            })
        }
      }
    }
    walk(dir)
    return out
  }

  it('the renderer never writes " (copy)" itself', () => {
    expect(linesWithLiteral(join(SRC, 'renderer'))).toEqual([])
  })

  it('main keeps only the folder, project and suite fallbacks', () => {
    expect(linesWithLiteral(join(SRC, 'main')).map((l) => l.replace(/:\d+$/, ''))).toEqual([
      'main/ipc/project.handler.ts',
      'main/ipc/save.handler.ts',
      'main/ipc/test-suite.handler.ts',
    ])
  })
})
