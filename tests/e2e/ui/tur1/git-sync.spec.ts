/**
 * Issue #127 — Git Push/Pull with a Personal Access Token, end to end against
 * the local smart-HTTP git server (Basic auth, see servers/git-server.ts).
 *
 * The token is saved the way the Storage pane saves it (`settings.set`
 * encrypts it); the assertions read the server's auth log to prove WHAT the
 * app actually sent: the decrypted token, never the `enc:v1:` ciphertext,
 * and never a token embedded in the remote URL.
 */
import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject } from '../../helpers/ui/bootstrap'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { getTestServerUrls, getTestGitCredentials } from '../../helpers/test-servers'

type Win = Window & {
  api?: {
    settings?: { set: (k: string, v: unknown) => Promise<{ success: boolean; error?: string }> }
    project?: { update: (id: string, p: unknown) => Promise<{ success: boolean }> }
    endpoint?: { create: (p: unknown) => Promise<{ success: boolean; error?: string }> }
    git?: {
      push: (id: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      pull: (id: string) => Promise<{ success: boolean; data?: unknown; error?: string }>
      hasConfig: (
        id: string,
      ) => Promise<{ success: boolean; data?: { hasGit: boolean; hasToken: boolean } }>
    }
  }
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function authLog(
  gitUrl: string,
): Promise<Array<{ username: string | null; password: string | null; ok: boolean }>> {
  return (await (await fetch(`${gitUrl}/__auth-log`)).json()) as never
}

/** Run git as a "teammate" outside the app (file-path access to the bare repo — no auth). */
function teammate(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Teammate', '-c', 'user.email=t@example.com', ...args],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  ).toString()
}

/** Clone the bare repo, commit `file` on `branch`, push — the remote moves on without us. */
function advanceRemote(bareDir: string, branch: string, file: string, content: string): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-teammate-'))
  try {
    teammate(work, ['init', '-q', '-b', branch])
    teammate(work, ['remote', 'add', 'origin', bareDir])
    try {
      teammate(work, ['fetch', '-q', 'origin', branch])
      teammate(work, ['reset', '-q', '--hard', `origin/${branch}`])
    } catch {
      /* branch does not exist yet — first commit seeds it */
    }
    fs.writeFileSync(path.join(work, file), content)
    teammate(work, ['add', file])
    teammate(work, ['commit', '-q', '-m', `teammate: ${file}`])
    teammate(work, ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`])
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
}

function remoteBranches(bareDir: string): string[] {
  return teammate(bareDir, ['branch', '--format=%(refname:short)'])
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
}

uiTest.describe('Tur1 — Git sync with PAT [issue #127]', () => {
  uiTest(
    'push + pull authenticate with the decrypted PAT; wrong PAT fails explicitly',
    async ({ window }) => {
      uiTest.setTimeout(120_000)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      const projectId = await getActiveProjectId(window)
      const { git: gitUrl } = getTestServerUrls()
      const creds = getTestGitCredentials()
      const label = uid()
      const { repo } = (await (
        await fetch(`${gitUrl}/__create/e2e-${label}`, { method: 'POST' })
      ).json()) as { repo: string }
      await fetch(`${gitUrl}/__auth-log/clear`)
      const localPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-gitsync-${label}-`))

      try {
        // Configure exactly like Settings → Storage does (token gets encrypted by settings:set).
        await window.evaluate(
          async ({ pid, repoUrl, lp, username, token }) => {
            const w = window as unknown as Win
            const r = await w.api!.settings!.set(`git.${pid}`, {
              repoUrl,
              username,
              branch: 'main',
              token,
            })
            if (!r.success) throw new Error(r.error)
            await w.api!.project!.update(pid, { local_path: lp, save_mode: 'both' })
          },
          {
            pid: projectId,
            repoUrl: repo,
            lp: localPath,
            username: creds.username,
            token: creds.token,
          },
        )

        const has = await window.evaluate(
          (pid) => (window as unknown as Win).api!.git!.hasConfig(pid),
          projectId,
        )
        expect(has.data).toEqual({ hasGit: true, hasToken: true })

        // ── Push
        const push = await window.evaluate(
          (pid) => (window as unknown as Win).api!.git!.push(pid),
          projectId,
        )
        expect(push.success, JSON.stringify(push)).toBe(true)

        let log = await authLog(gitUrl)
        expect(
          log.some((a) => a.ok && a.password === creds.token && a.username === creds.username),
        ).toBe(true)
        expect(log.every((a) => !(a.password ?? '').startsWith('enc:v1'))).toBe(true)

        // The remote URL persisted in .git/config must be clean — no token.
        const gitConfig = fs.readFileSync(path.join(localPath, '.git', 'config'), 'utf8')
        expect(gitConfig).toContain(repo.replace(/^http:\/\//, ''))
        expect(gitConfig).not.toContain(creds.token)
        expect(gitConfig).not.toContain('@127.0.0.1')

        // The project file landed on the remote.
        const refs = await (
          await fetch(`${repo}/info/refs?service=git-upload-pack`, {
            headers: {
              Authorization:
                'Basic ' + Buffer.from(`${creds.username}:${creds.token}`).toString('base64'),
            },
          })
        ).text()
        expect(refs).toContain('refs/heads/main')

        // ── Pull (no-op, but must authenticate and succeed)
        await fetch(`${gitUrl}/__auth-log/clear`)
        const pull = await window.evaluate(
          (pid) => (window as unknown as Win).api!.git!.pull(pid),
          projectId,
        )
        expect(pull.success, JSON.stringify(pull)).toBe(true)
        log = await authLog(gitUrl)
        expect(log.some((a) => a.ok && a.password === creds.token)).toBe(true)

        // ── Wrong PAT → explicit auth error, and the server saw the wrong value (not ciphertext)
        await fetch(`${gitUrl}/__auth-log/clear`)
        await window.evaluate(
          async ({ pid, repoUrl, username }) => {
            const w = window as unknown as Win
            await w.api!.settings!.set(`git.${pid}`, {
              repoUrl,
              username,
              branch: 'main',
              token: 'definitely-wrong',
            })
          },
          { pid: projectId, repoUrl: repo, username: creds.username },
        )
        const bad = await window.evaluate(
          (pid) => (window as unknown as Win).api!.git!.push(pid),
          projectId,
        )
        expect(bad.success).toBe(false)
        expect(bad.error ?? '').toMatch(/kimlik doğrulaması|401|Authentication/i)
        expect(bad.error ?? '').not.toContain('definitely-wrong')
        log = await authLog(gitUrl)
        expect(log.some((a) => !a.ok && a.password === 'definitely-wrong')).toBe(true)

        // ── No token at all → explicit "token missing" without touching the remote
        await fetch(`${gitUrl}/__auth-log/clear`)
        await window.evaluate(
          async ({ pid, repoUrl, username }) => {
            const w = window as unknown as Win
            await w.api!.settings!.set(`git.${pid}`, {
              repoUrl,
              username,
              branch: 'main',
              token: '',
            })
          },
          { pid: projectId, repoUrl: repo, username: creds.username },
        )
        const none = await window.evaluate(
          (pid) => (window as unknown as Win).api!.git!.push(pid),
          projectId,
        )
        expect(none.success).toBe(false)
        expect(none.error ?? '').toMatch(/token/i)
        expect(await authLog(gitUrl)).toEqual([])
      } finally {
        // Detach git from the canonical project so later specs see a plain local project.
        await window.evaluate(async (pid) => {
          const w = window as unknown as Win
          await w.api?.settings?.set(`git.${pid}`, { repoUrl: '' })
          await w.api?.project?.update(pid, { local_path: null, save_mode: 'local' })
        }, projectId)
        fs.rmSync(localPath, { recursive: true, force: true })
      }
    },
  )

  uiTest(
    'remote on master, divergent pull, non-fast-forward push, unreachable remote, foreign checkout',
    async ({ window }) => {
      uiTest.setTimeout(180_000)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      const projectId = await getActiveProjectId(window)
      const { git: gitUrl } = getTestServerUrls()
      const creds = getTestGitCredentials()
      const label = uid()
      const { repo, dir } = (await (
        await fetch(`${gitUrl}/__create/e2e-master-${label}`, { method: 'POST' })
      ).json()) as { repo: string; dir: string }
      const localPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-gitdiv-${label}-`))
      const foreignPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-foreign-${label}-`))
      const deadPath = fs.mkdtempSync(path.join(os.tmpdir(), `testnizer-dead-${label}-`))

      const configure = (repoUrl: string, lp: string) =>
        window.evaluate(
          async ({ pid, repoUrl, lp, username, token }) => {
            const w = window as unknown as Win
            const r = await w.api!.settings!.set(`git.${pid}`, {
              repoUrl,
              username,
              branch: 'main',
              token,
            })
            if (!r.success) throw new Error(r.error)
            await w.api!.project!.update(pid, { local_path: lp, save_mode: 'both' })
          },
          { pid: projectId, repoUrl, lp, username: creds.username, token: creds.token },
        )
      const push = () =>
        window.evaluate((pid) => (window as unknown as Win).api!.git!.push(pid), projectId)
      const pull = () =>
        window.evaluate((pid) => (window as unknown as Win).api!.git!.pull(pid), projectId)

      try {
        // ── The remote was created by someone else with `master`; Storage says `main`.
        advanceRemote(dir, 'master', 'README.md', '# created on master\n')
        await configure(repo, localPath)
        const first = await push()
        expect(first.success, JSON.stringify(first)).toBe(true)
        expect(remoteBranches(dir).sort()).toEqual(['main', 'master'])
        // `main` was started from master's history, not from an unrelated root.
        expect(fs.existsSync(path.join(localPath, 'README.md'))).toBe(true)
        const tracked = teammate(localPath, ['ls-files']).split('\n').filter(Boolean)
        expect(tracked.some((f) => f.endsWith('.json'))).toBe(true)

        // ── A teammate pushes to main; we change the project locally → non-fast-forward.
        advanceRemote(dir, 'main', 'teammate.txt', 'hello from the other machine\n')
        await window.evaluate(
          ({ pid, d }) => (window as unknown as Win).api!.project!.update(pid, { description: d }),
          { pid: projectId, d: `changed locally ${label}` },
        )
        const rejected = await push()
        expect(rejected.success).toBe(false)
        expect(rejected.error ?? '').toMatch(/Önce Pull/i)
        expect(rejected.error ?? '').not.toMatch(/\[rejected\]|fetch first/) // no raw git text

        // ── Pull reconciles by merging (pull.rebase=false), then Push lands.
        const merged = await pull()
        expect(merged.success, JSON.stringify(merged)).toBe(true)
        expect((merged.data as { state?: string }).state).toBe('clean')
        expect(fs.existsSync(path.join(localPath, 'teammate.txt'))).toBe(true)
        const after = await push()
        expect(after.success, JSON.stringify(after)).toBe(true)
        // Only the project file is ever staged — a stray file in local_path stays untracked.
        fs.writeFileSync(path.join(localPath, 'my-notes.json'), '{"mine":true}')
        await window.evaluate(
          ({ pid, d }) => (window as unknown as Win).api!.project!.update(pid, { description: d }),
          { pid: projectId, d: `changed again ${label}` },
        )
        const again = await push()
        expect(again.success, JSON.stringify(again)).toBe(true)
        expect(fs.existsSync(path.join(localPath, 'my-notes.json'))).toBe(true)
        expect(teammate(localPath, ['ls-files'])).not.toContain('my-notes.json')

        // ── Unreachable remote → explicit message, nothing initialised on disk.
        await configure('http://127.0.0.1:9/nothing-here.git', deadPath)
        const dead = await push()
        expect(dead.success).toBe(false)
        expect(dead.error ?? '').toContain('Uzak depoya erişilemedi')
        expect(fs.existsSync(path.join(deadPath, '.git'))).toBe(false)

        // ── local_path is somebody else's checkout → refused, origin untouched.
        teammate(foreignPath, ['init', '-q'])
        teammate(foreignPath, ['remote', 'add', 'origin', 'https://example.com/other/dotfiles.git'])
        await configure(repo, foreignPath)
        const foreign = await push()
        expect(foreign.success).toBe(false)
        expect(foreign.error ?? '').toContain('başka bir uzak depoya')
        expect(teammate(foreignPath, ['remote', 'get-url', 'origin']).trim()).toBe(
          'https://example.com/other/dotfiles.git',
        )
      } finally {
        await window.evaluate(async (pid) => {
          const w = window as unknown as Win
          await w.api?.settings?.set(`git.${pid}`, { repoUrl: '' })
          await w.api?.project?.update(pid, {
            local_path: null,
            save_mode: 'local',
            description: '',
          })
        }, projectId)
        for (const p of [localPath, foreignPath, deadPath])
          fs.rmSync(p, { recursive: true, force: true })
      }
    },
  )
})
