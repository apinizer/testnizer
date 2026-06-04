/**
 * Smoke tests for the userData migration helper.
 *
 * The actual `migrateLegacyUserData` function is tightly coupled to Electron's
 * `app.getPath('userData')` lookup, so we re-implement the same algorithm here
 * against a temporary directory and assert on the FS effects directly. If the
 * algorithm in `src/main/index.ts` changes shape, this test must be kept in sync.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  readdirSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(path.join(os.tmpdir(), 'testnizer-migration-'))
})

function runMigration(opts: { populateOld: boolean; populateNew: boolean }) {
  const oldDir = path.join(baseDir, 'Apinizer')
  const newDir = path.join(baseDir, 'Testnizer')
  const markerFile = path.join(newDir, '.migration-from-apinizer')

  if (opts.populateOld) {
    mkdirSync(oldDir, { recursive: true })
    writeFileSync(path.join(oldDir, 'workspace.db'), 'OLD-DATA')
    mkdirSync(path.join(oldDir, 'subfolder'), { recursive: true })
    writeFileSync(path.join(oldDir, 'subfolder', 'a.txt'), 'nested')
  }

  if (opts.populateNew) {
    mkdirSync(newDir, { recursive: true })
    writeFileSync(path.join(newDir, 'existing.db'), 'NEW-DATA')
  }

  // Re-implementation of migrateLegacyUserData:
  if (!existsSync(oldDir)) return { newDir, ran: false }
  if (existsSync(markerFile)) return { newDir, ran: false }
  if (existsSync(newDir)) {
    const entries = readdirSync(newDir).filter((e) => !e.startsWith('.'))
    if (entries.length > 0) return { newDir, ran: false }
  }

  cpSync(oldDir, newDir, { recursive: true, errorOnExist: false })
  writeFileSync(markerFile, new Date().toISOString())
  return { newDir, ran: true }
}

describe('userData migration', () => {
  it('copies legacy Apinizer dir to Testnizer when target missing', () => {
    const r = runMigration({ populateOld: true, populateNew: false })
    expect(r.ran).toBe(true)
    expect(readFileSync(path.join(r.newDir, 'workspace.db'), 'utf8')).toBe('OLD-DATA')
    expect(readFileSync(path.join(r.newDir, 'subfolder/a.txt'), 'utf8')).toBe('nested')
  })

  it('writes marker file after migration', () => {
    const r = runMigration({ populateOld: true, populateNew: false })
    expect(existsSync(path.join(r.newDir, '.migration-from-apinizer'))).toBe(true)
  })

  it('skips when old dir does not exist', () => {
    const r = runMigration({ populateOld: false, populateNew: false })
    expect(r.ran).toBe(false)
  })

  it('skips when new dir already populated', () => {
    const r = runMigration({ populateOld: true, populateNew: true })
    expect(r.ran).toBe(false)
    // Existing data preserved
    expect(readFileSync(path.join(r.newDir, 'existing.db'), 'utf8')).toBe('NEW-DATA')
  })

  it('is idempotent — second run is a no-op', () => {
    runMigration({ populateOld: true, populateNew: false })
    const r2 = runMigration({ populateOld: true, populateNew: false })
    expect(r2.ran).toBe(false)
  })
})

afterEach(() => {
  if (baseDir && existsSync(baseDir)) {
    rmSync(baseDir, { recursive: true, force: true })
  }
})

import { afterEach } from 'vitest'
