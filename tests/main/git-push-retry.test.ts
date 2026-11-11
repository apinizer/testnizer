/**
 * Transient remote errors on Push (tester report: GitHub `remote: Internal
 * Server Error` a few times a day, the next click works). Pins the
 * classifier in `git-config.ts` and the shared `pushWithRetry` every push
 * path uses: retry ONLY server-side, short-lived failures — never auth,
 * never non-fast-forward, never branch protection, never an explicit 4xx.
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

const { isTransientRemoteError, isPushRejectedError, pushWithRetry, describeGitFailure } =
  await import('../../src/main/lib/git-config')
const { GitCodedError, GIT_ERROR_TEXT } = await import('../../src/shared/git-errors')

/** GitHub's actual 500 on push (request id redacted). */
const GITHUB_500 = [
  'remote: Internal Server Error',
  'To https://github.com/acme/apis.git',
  ' ! [remote rejected] test -> test (Internal Server Error)',
  "error: failed to push some refs to 'https://github.com/acme/apis.git'",
].join('\n')

const TRANSIENT_FORMS: Record<string, string> = {
  'remote: Internal Server Error': GITHUB_500,
  '[remote rejected] (Internal Server Error)':
    ' ! [remote rejected] test -> test (Internal Server Error)',
  'RPC failed; HTTP 500':
    'error: RPC failed; HTTP 500 curl 22 The requested URL returned error: 500\nfatal: the remote end hung up unexpectedly',
  'returned error: 500':
    "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 500",
  'returned error: 502':
    "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 502",
  'returned error: 503':
    "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 503",
  'returned error: 504':
    "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 504",
  'hung up unexpectedly': 'fatal: the remote end hung up unexpectedly',
  'HTTP/2 stream reset':
    'error: RPC failed; curl 92 HTTP/2 stream 0 was not closed cleanly: CANCEL (err 8)',
  'sideband disconnect': 'error: unexpected disconnect while reading sideband packet',
  '502 Bad Gateway': 'remote: 502 Bad Gateway',
}

const NOT_TRANSIENT: Record<string, string> = {
  'non-fast-forward':
    " ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to 'x'\nhint: Updates were rejected because the tip of your current branch is behind",
  'fetch first': ' ! [rejected]        main -> main (fetch first)',
  '401':
    "fatal: unable to access 'https://github.com/a/b.git/': The requested URL returned error: 401",
  '403':
    "remote: Permission to a/b.git denied.\nfatal: unable to access 'x': The requested URL returned error: 403",
  'auth failed':
    "remote: Invalid username or token.\nfatal: Authentication failed for 'https://github.com/a/b.git/'",
  '413 + hung up':
    'error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\nfatal: the remote end hung up unexpectedly',
  'branch protection':
    'remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)',
  'pre-receive declined': ' ! [remote rejected] main -> main (pre-receive hook declined)',
  offline: "fatal: unable to access 'x': Could not resolve host: github.com",
}

describe('isTransientRemoteError', () => {
  for (const [name, text] of Object.entries(TRANSIENT_FORMS)) {
    it(`transient: ${name}`, () => expect(isTransientRemoteError(text)).toBe(true))
  }
  for (const [name, text] of Object.entries(NOT_TRANSIENT)) {
    it(`not transient: ${name}`, () => expect(isTransientRemoteError(text)).toBe(false))
  }

  it('GitHub 500 is not a "remote is ahead" refusal', () => {
    expect(isPushRejectedError(GITHUB_500)).toBe(false)
  })
})

describe('describeGitFailure — transient forms', () => {
  it('GitHub 500 on a non-push op → GIT_REMOTE_TRANSIENT ("try again"), not the raw stderr / pull-first', () => {
    const out = describeGitFailure(new Error(GITHUB_500), 'tok')
    expect(out.errorCode).toBe('GIT_REMOTE_TRANSIENT')
    expect(out.errorDetail).toContain('remote: Internal Server Error')
    expect(out.error).toBe(
      GIT_ERROR_TEXT.GIT_REMOTE_TRANSIENT.replace('{detail}', out.errorDetail ?? ''),
    )
  })

  it('auth and non-ff keep their own codes', () => {
    expect(describeGitFailure(new Error(NOT_TRANSIENT['401']), 'tok-123').errorCode).toBe(
      'GIT_AUTH_FAILED',
    )
    expect(describeGitFailure(new Error(NOT_TRANSIENT['non-fast-forward']), 'tok-123')).toEqual({
      error: GIT_ERROR_TEXT.GIT_PUSH_REJECTED,
      errorCode: 'GIT_PUSH_REJECTED',
    })
  })

  it('a short token never mangles our own sentence', () => {
    // The sentence says "5xx"; a token "x" must only be scrubbed from git's detail.
    const e = new GitCodedError('GIT_PUSH_TRANSIENT', {
      detail: 'remote: Internal Server Error (x)',
    })
    const out = describeGitFailure(e, 'x')
    expect(out.errorCode).toBe('GIT_PUSH_TRANSIENT')
    expect(out.errorDetail).toBe('remote: Internal Server Error (***)')
    expect(out.error).toBe(
      GIT_ERROR_TEXT.GIT_PUSH_TRANSIENT.replace('{detail}', 'remote: Internal Server Error (***)'),
    )
  })
})

/** Fake git whose push fails with `failures[i]` on attempt i, then succeeds. */
function fakeGit(failures: string[]): { push: ReturnType<typeof vi.fn> } {
  let i = 0
  return {
    push: vi.fn(async () => {
      const f = failures[i++]
      if (f !== undefined) throw new Error(f)
      return { pushed: [] }
    }),
  }
}

describe('pushWithRetry', () => {
  const noSleep = { sleep: vi.fn(async () => undefined), delaysMs: [1000, 3000] }

  it('succeeds on the 2nd attempt after a 500, waiting the first backoff', async () => {
    const sleep = vi.fn(async () => undefined)
    const git = fakeGit([GITHUB_500])
    await pushWithRetry(git, 'origin', 'main', ['--set-upstream'], {
      sleep,
      delaysMs: [1000, 3000],
    })
    expect(git.push).toHaveBeenCalledTimes(2)
    expect(git.push).toHaveBeenLastCalledWith('origin', 'main', ['--set-upstream'])
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('gives up after 1 + N attempts with the transient message', async () => {
    const sleep = vi.fn(async () => undefined)
    const git = fakeGit([GITHUB_500, GITHUB_500, GITHUB_500, GITHUB_500])
    const thrown = await pushWithRetry(git, 'origin', 'main', [], {
      sleep,
      delaysMs: [1000, 3000],
    }).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(GitCodedError)
    expect((thrown as InstanceType<typeof GitCodedError>).code).toBe('GIT_PUSH_TRANSIENT')
    expect(
      (thrown as Error).message.startsWith(GIT_ERROR_TEXT.GIT_PUSH_TRANSIENT.split('{detail}')[0]),
    ).toBe(true)
    expect(git.push).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 3000])
  })

  it('the final message keeps the server line for support', async () => {
    const git = fakeGit([GITHUB_500, GITHUB_500, GITHUB_500])
    const err = await pushWithRetry(git, 'origin', 'main', [], noSleep).catch((e: Error) => e)
    expect((err as Error).message).toContain('remote: Internal Server Error')
  })

  for (const name of [
    '401',
    'auth failed',
    'non-fast-forward',
    'branch protection',
    '413 + hung up',
  ]) {
    it(`no retry on ${name}`, async () => {
      const git = fakeGit([NOT_TRANSIENT[name], NOT_TRANSIENT[name]])
      await expect(pushWithRetry(git, 'origin', 'main', [], noSleep)).rejects.toThrow(
        NOT_TRANSIENT[name].split('\n')[0].trim(),
      )
      expect(git.push).toHaveBeenCalledTimes(1)
    })
  }

  it('a transient error followed by a non-ff refusal stops at the refusal', async () => {
    const git = fakeGit([GITHUB_500, NOT_TRANSIENT['non-fast-forward']])
    await expect(pushWithRetry(git, 'origin', 'main', [], noSleep)).rejects.toThrow(
      /non-fast-forward/,
    )
    expect(git.push).toHaveBeenCalledTimes(2)
  })
})
