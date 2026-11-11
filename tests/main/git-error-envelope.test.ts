/**
 * The git failure envelope (tester finding 6 + Codex review of df03936):
 *
 *  - `fillTemplate` inserts values verbatim (`$&`, `$1`, `` $` ``, `$'` are
 *    String.replace patterns — a project named `$&` used to get a wrong
 *    toast) and fills in ONE pass (a value holding `{name}` stays as-is).
 *  - A pull / merge import that fails on a CODED error keeps that code as
 *    `errorCause`; an uncoded inner error stays raw.
 *  - Token canary: the token — raw and percent-encoded — is placed in the
 *    detail, the params AND the cause; the WHOLE IPC envelope must not hold it.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf-8'),
  },
  app: { getPath: () => '/tmp', getName: () => 'Testnizer' },
}))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
  },
}))
vi.mock('../../src/main/db/database', () => ({ getDb: () => ({}) }))

const { describeGitFailure, describeWrappedGitFailure } =
  await import('../../src/main/lib/git-config')
const { GitCodedError, GIT_ERROR_TEXT, wrappedGitFailure } =
  await import('../../src/shared/git-errors')
const { fillTemplate } = await import('../../src/shared/fill-template')

describe('fillTemplate — the one placeholder filler', () => {
  it('inserts replacement-pattern values verbatim', () => {
    for (const v of ['$&', '$1', '$`', "$'", '$$', 'a $& b $1 c']) {
      expect(fillTemplate('Duplicated "{name}"', { name: v })).toBe(`Duplicated "${v}"`)
    }
  })

  it('fills in one pass: an inserted value is never substituted again', () => {
    expect(fillTemplate('{a} / {b}', { a: '{b}', b: 'B' })).toBe('{b} / B')
  })

  it('keeps an unknown placeholder and stringifies numbers', () => {
    expect(fillTemplate('{count} of {missing}', { count: 3 })).toBe('3 of {missing}')
  })
})

describe('wrappedGitFailure — the inner coded failure travels as errorCause', () => {
  it('a coded inner error keeps its code and params; the detail is its English text', () => {
    const inner = new GitCodedError('GIT_PROJECT_FILE_AMBIGUOUS', {
      params: { files: 'a.json, b.json', name: 'p.json' },
    })
    const f = wrappedGitFailure('GIT_PULL_IMPORT_FAILED', inner)
    expect(f).toEqual({
      error: GIT_ERROR_TEXT.GIT_PULL_IMPORT_FAILED.replace('{detail}', inner.message),
      errorCode: 'GIT_PULL_IMPORT_FAILED',
      errorDetail: inner.message,
      errorCause: {
        code: 'GIT_PROJECT_FILE_AMBIGUOUS',
        params: { files: 'a.json, b.json', name: 'p.json' },
      },
    })
  })

  it('an uncoded inner error stays raw, with no cause', () => {
    const f = wrappedGitFailure('GIT_MERGE_IMPORT_FAILED', new Error('SQLITE_BUSY'))
    expect(f).toEqual({
      error: GIT_ERROR_TEXT.GIT_MERGE_IMPORT_FAILED.replace('{detail}', 'SQLITE_BUSY'),
      errorCode: 'GIT_MERGE_IMPORT_FAILED',
      errorDetail: 'SQLITE_BUSY',
    })
  })
})

describe('token canary — nothing in the envelope carries the token', () => {
  // Percent-encoding differs from the raw form (`/`, `+`, space), so the
  // encoded half is a real check.
  const TOKEN = 'ghp_a/b+c d'
  const ENC = encodeURIComponent(TOKEN)
  const holds = (s: string): boolean => s.includes(TOKEN) || s.includes(ENC)

  it('describeGitFailure: detail, params and cause (raw and encoded) are all redacted', () => {
    const e = new GitCodedError('GIT_FOREIGN_REPO', {
      detail: `raw ${TOKEN} enc ${ENC}`,
      params: { path: `/home/${TOKEN}`, remote: `https://u:${ENC}@host/r.git` },
      inner: {
        code: 'GIT_REMOTE_UNREACHABLE',
        detail: `https://${TOKEN}@host and ${ENC}`,
        params: { extra: ENC },
      },
    })
    const envelope = { success: false, ...describeGitFailure(e, TOKEN) }
    expect(envelope.errorCode).toBe('GIT_FOREIGN_REPO')
    expect(envelope.errorCause?.code).toBe('GIT_REMOTE_UNREACHABLE')
    expect(holds(JSON.stringify(envelope))).toBe(false)
    expect(JSON.stringify(envelope)).toContain('***')
  })

  it('describeWrappedGitFailure: the cause and the rebuilt detail are redacted', () => {
    const inner = new GitCodedError('GIT_PROJECT_FILE_AMBIGUOUS', {
      params: { files: `${TOKEN}.json, ${ENC}.json`, name: 'p.json' },
    })
    const envelope = {
      success: false,
      ...describeWrappedGitFailure('GIT_PULL_IMPORT_FAILED', inner, TOKEN),
    }
    expect(envelope.errorCode).toBe('GIT_PULL_IMPORT_FAILED')
    expect(envelope.errorCause?.code).toBe('GIT_PROJECT_FILE_AMBIGUOUS')
    expect(holds(JSON.stringify(envelope))).toBe(false)
  })

  it('an uncoded failure (raw stderr) is redacted as a whole', () => {
    const envelope = {
      success: false,
      ...describeGitFailure(new Error(`fatal: could not read ${TOKEN} / ${ENC}`), TOKEN),
    }
    expect(envelope.errorCode).toBeUndefined()
    expect(holds(JSON.stringify(envelope))).toBe(false)
  })
})

describe('gitFailureOf — connection-text scrub (Codex review of e6e82a7)', () => {
  const CANARY = 'CANARY-pw-7731'
  const BASIC = Buffer.from(`e2e:${CANARY}`).toString('base64')
  const envelope = (f: object): string => JSON.stringify({ success: false, ...f })

  it('drops URL userinfo from a raw git message', async () => {
    const { gitFailureOf } = await import('../../src/shared/git-errors')
    const f = gitFailureOf(new Error(`fatal: unable to access 'https://u:${CANARY}@h/r.git/'`))
    expect(envelope(f)).not.toContain(CANARY)
    expect(f.error).toContain('https://h/r.git/')
  })

  it('drops an Authorization: Basic / Bearer credential (raw and base64)', async () => {
    const { gitFailureOf } = await import('../../src/shared/git-errors')
    for (const msg of [
      `error: http.extraHeader=Authorization: Basic ${BASIC} rejected`,
      `> Authorization: Bearer ${CANARY}`,
    ]) {
      const f = gitFailureOf(new Error(msg))
      expect(envelope(f)).not.toContain(CANARY)
      expect(envelope(f)).not.toContain(BASIC)
      expect(f.error).toMatch(/Authorization: (Basic|Bearer) /)
    }
  })

  it('scrubs a coded error’s values and a wrapped cause too', () => {
    const remote = `https://old:${CANARY}@host/repo.git`
    const coded = new GitCodedError('GIT_FOREIGN_REPO', {
      params: { path: '/tmp/x', remote },
    })
    const viaDescribe = describeGitFailure(coded, undefined)
    expect(envelope(viaDescribe)).not.toContain(CANARY)
    expect(viaDescribe.errorParams?.remote).toBe('https://host/repo.git')
    const wrapped = describeWrappedGitFailure('GIT_PULL_IMPORT_FAILED', coded, undefined)
    expect(envelope(wrapped)).not.toContain(CANARY)
    expect(wrapped.errorCause?.code).toBe('GIT_FOREIGN_REPO')
  })
})
