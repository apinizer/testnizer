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
})
