/**
 * `src/main/lib/git-config.ts` — the single source for Git credentials
 * (issue #127 follow-up). Both handlers import it, so the drift that produced
 * "Invalid username or token" cannot recur; these tests pin its contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const encryptionAvailable = vi.hoisted(() => ({ value: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable.value,
    encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
    decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8'),
  },
  app: { getPath: () => '/tmp', getName: () => 'Testnizer' },
}))

const stores = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  legacy: {} as Record<string, unknown>,
}))
vi.mock('electron-store', () => ({
  default: class FakeStore {
    private bag: Record<string, unknown>
    constructor(opts: { name: string }) {
      this.bag = opts.name === 'git-credentials' ? stores.legacy : stores.settings
    }
    get(key: string): unknown {
      return this.bag[key]
    }
    set(key: string, value: unknown): void {
      this.bag[key] = value
    }
  },
}))

vi.mock('../../src/main/db/database', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ local_path: '/repo/dir' }) }),
  }),
}))

const {
  getProjectGitConfig,
  buildAuthUrl,
  gitAuth,
  gitProcessEnv,
  gitClientOptions,
  isGitAuthError,
  redactToken,
  legacyCredentialKey,
  GIT_SSH_URL_ERROR,
} = await import('../../src/main/lib/git-config')

const enc = (s: string) => 'enc:v1:' + Buffer.from(s, 'utf-8').reverse().toString('base64')

beforeEach(() => {
  encryptionAvailable.value = true
  stores.settings = {}
  stores.legacy = {}
})

describe('getProjectGitConfig', () => {
  it('returns null when no remote is configured', async () => {
    expect(await getProjectGitConfig('p1')).toBeNull()
    stores.settings.git = { p1: { username: 'u' } }
    expect(await getProjectGitConfig('p1')).toBeNull()
  })

  it('decrypts the safeStorage token and joins the project local_path', async () => {
    stores.settings.git = {
      p1: {
        repoUrl: 'https://github.com/a/b.git',
        username: 'u',
        branch: 'dev',
        token: enc('ghp_x'),
      },
    }
    expect(await getProjectGitConfig('p1')).toEqual({
      repoUrl: 'https://github.com/a/b.git',
      username: 'u',
      branch: 'dev',
      token: 'ghp_x',
      localPath: '/repo/dir',
    })
  })

  it('passes legacy plaintext tokens through and defaults branch to main', async () => {
    stores.settings.git = { p1: { repoUrl: 'https://h/r.git', token: 'plain' } }
    const c = await getProjectGitConfig('p1')
    expect(c?.token).toBe('plain')
    expect(c?.branch).toBe('main')
    expect(c?.username).toBe('')
  })

  it('falls back to the legacy git-credentials store when settings carries no token', async () => {
    const repoUrl = 'https://gitlab.example/g/r.git'
    stores.settings.git = { p1: { repoUrl, username: 'u' } }
    stores.legacy[legacyCredentialKey(repoUrl)] = {
      repoUrl,
      username: 'u',
      token: enc('legacy-pat'),
    }
    expect((await getProjectGitConfig('p1'))?.token).toBe('legacy-pat')
  })

  it('yields an empty token (not ciphertext) when the keychain cannot decrypt', async () => {
    encryptionAvailable.value = false
    stores.settings.git = { p1: { repoUrl: 'https://h/r.git', token: enc('secret') } }
    const c = await getProjectGitConfig('p1')
    expect(c?.token).toBe('')
    expect(c?.token).not.toContain('enc:v1')
  })
})

describe('buildAuthUrl', () => {
  it('embeds user + token, percent-encoding reserved characters exactly once', () => {
    const u = new URL(buildAuthUrl('https://github.com/a/b.git', 'me@x', 'p@ss:w/rd'))
    expect(decodeURIComponent(u.username)).toBe('me@x')
    expect(decodeURIComponent(u.password)).toBe('p@ss:w/rd')
    expect(u.origin + u.pathname).toBe('https://github.com/a/b.git')
  })

  it('replaces userinfo already present in the stored URL instead of doubling it', () => {
    const out = buildAuthUrl('https://old:stale@github.com/a/b.git', 'new', 'tok')
    expect(out).toBe('https://new:tok@github.com/a/b.git')
  })

  it('never sends an empty username (some servers reject it)', () => {
    expect(new URL(buildAuthUrl('https://h/r.git', '', 'tok')).username).toBe('token')
    expect(new URL(buildAuthUrl('https://h/r.git', '   ', 'tok')).username).toBe('token')
  })

  it('rejects SSH remotes with an explicit message instead of "Invalid URL"', () => {
    expect(() => buildAuthUrl('git@github.com:a/b.git', 'u', 't')).toThrow(GIT_SSH_URL_ERROR)
    expect(() => buildAuthUrl('ssh://git@github.com/a/b.git', 'u', 't')).toThrow(GIT_SSH_URL_ERROR)
  })

  it('passes file:// mirrors and plain paths through untouched (e2e bare-repo fixtures)', () => {
    expect(buildAuthUrl('file:///tmp/bare.git', 'u', 't')).toBe('file:///tmp/bare.git')
    expect(buildAuthUrl('/tmp/bare.git', 'u', 't')).toBe('/tmp/bare.git')
    expect(buildAuthUrl('C:\\repos\\bare.git', 'u', 't')).toBe('C:\\repos\\bare.git')
  })
})

describe('gitAuth (per-process credential, clean remote URL)', () => {
  it('strips userinfo from the URL and carries the credential as http.extraHeader', () => {
    const a = gitAuth('https://old:stale@github.com/a/b.git', 'me', 'ghp_x')
    expect(a.cleanUrl).toBe('https://github.com/a/b.git')
    const basic = Buffer.from('me:ghp_x', 'utf8').toString('base64')
    expect(a.config).toContain(`http.extraHeader=Authorization: Basic ${basic}`)
    expect(a.config).toContain('credential.helper=')
    expect(a.env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(JSON.stringify(a)).not.toContain('ghp_x')
  })

  it('emits no Authorization header without a token, and defaults an empty username', () => {
    expect(
      gitAuth('https://h/r.git', 'u', '').config.some((c) => c.startsWith('http.extraHeader')),
    ).toBe(false)
    const basic = Buffer.from('token:t', 'utf8').toString('base64')
    expect(gitAuth('https://h/r.git', '', 't').config).toContain(
      `http.extraHeader=Authorization: Basic ${basic}`,
    )
  })

  it('file:// remotes get no header and keep their URL; SSH is rejected', () => {
    const a = gitAuth('file:///tmp/bare.git', 'u', 't')
    expect(a.cleanUrl).toBe('file:///tmp/bare.git')
    expect(a.config.some((c) => c.startsWith('http.extraHeader'))).toBe(false)
    expect(() => gitAuth('git@github.com:a/b.git', 'u', 't')).toThrow(GIT_SSH_URL_ERROR)
  })
})

describe('gitProcessEnv / gitClientOptions', () => {
  it('drops the variables simple-git refuses (GIT_EDITOR, PAGER, GIT_SSH_COMMAND, GIT_CONFIG_*) and keeps PATH', async () => {
    const saved = { ...process.env }
    process.env.GIT_EDITOR = 'vim'
    process.env.PAGER = 'less'
    process.env.GIT_SSH_COMMAND = 'ssh -i x'
    process.env.GIT_CONFIG_COUNT = '1'
    process.env.GIT_CONFIG_KEY_0 = 'x'
    process.env.KEEP_ME = '1'
    try {
      const env = gitProcessEnv(gitAuth('https://h/r.git', 'u', 't'))
      for (const k of [
        'GIT_EDITOR',
        'PAGER',
        'GIT_SSH_COMMAND',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0',
      ]) {
        expect(k in env).toBe(false)
      }
      expect(env.KEEP_ME).toBe('1')
      expect(env.PATH).toBe(process.env.PATH)
      expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
    const opts = await gitClientOptions(gitAuth('https://h/r.git', 'u', 't'), '/repo')
    expect(opts.baseDir).toBe('/repo')
    expect(opts.unsafe).toEqual({ allowUnsafeCredentialHelper: true })
    expect(opts.config).toContain('credential.helper=')
  })
})

describe('isGitAuthError', () => {
  it('recognises the 401/403 texts git and curl emit', () => {
    expect(isGitAuthError("fatal: Authentication failed for 'https://github.com/a/b.git/'")).toBe(
      true,
    )
    expect(isGitAuthError('The requested URL returned error: 403')).toBe(true)
    expect(isGitAuthError('remote: Invalid username or token.')).toBe(true)
    expect(
      isGitAuthError(
        'fatal: could not read Username for https://github.com: terminal prompts disabled',
      ),
    ).toBe(true)
    expect(isGitAuthError('fatal: repository not found')).toBe(false)
    expect(isGitAuthError('Could not resolve host: github.com')).toBe(false)
  })
})

describe('redactToken', () => {
  it('masks the raw and the percent-encoded token', () => {
    const tok = 'ghp_ab/c=d'
    const msg = `fatal: unable to access 'https://u:${encodeURIComponent(tok)}@h/r.git': 401 (${tok})`
    const out = redactToken(msg, tok)
    expect(out).not.toContain(tok)
    expect(out).not.toContain(encodeURIComponent(tok))
    expect(out).toContain('***')
  })

  it('is a no-op without a token', () => {
    expect(redactToken('x', '')).toBe('x')
    expect(redactToken('x', undefined)).toBe('x')
  })
})
