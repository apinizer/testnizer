/**
 * Git remote configuration — the ONE place that turns a project's stored Git
 * settings into credentials simple-git can use.
 *
 * Until v1.5.4 `git.handler.ts` and `save.handler.ts` each carried their own
 * copy of this logic. The copies drifted: `settings:set` started encrypting
 * the token with safeStorage (`enc:v1:` envelope) and only one copy learned to
 * decrypt it, so the toolbar Push embedded ciphertext as the HTTPS password
 * and GitHub answered "Invalid username or token" (issue #127). Both handlers
 * now import from here; do not re-inline any of this.
 */
import { app } from 'electron'
import { join } from 'path'
import { getDb } from '../db/database'
import { decryptSecret } from './secure-storage'

export interface ProjectGitConfig {
  repoUrl: string
  username: string
  branch: string
  /** Decrypted PAT — empty when never saved or when the OS keychain could not decrypt it. */
  token: string
  /** `projects.local_path` — empty when the project has no local checkout dir yet. */
  localPath: string
}

export const GIT_TOKEN_MISSING_ERROR =
  'Git token bulunamadı veya şifresi çözülemedi. Proje Ayarları → Storage bölümünden Personal Access Token’ı yeniden girin.'

export const GIT_SSH_URL_ERROR =
  'Git remote HTTPS URL olmalı (https://…). SSH adresleri (git@host:…) Personal Access Token ile kullanılamaz.'

export const GIT_AUTH_FAILED_ERROR =
  'Git kimlik doğrulaması başarısız (401/403). Kullanıcı adı ve Personal Access Token’ı kontrol edin.'

/** Where a project's checkout lives when the user picked no folder (Git-only save mode). */
export function defaultGitLocalPath(projectId: string): string {
  return join(app.getPath('userData'), 'git', projectId)
}

type KvStore = { get(key: string): unknown; set(key: string, value: unknown): void }

/** electron-store `settings` — where the Storage pane writes `git.<projectId>`. */
export async function getSettingsStore(): Promise<KvStore> {
  const { default: Store } = await import('electron-store')
  return new Store({ name: 'settings' }) as unknown as KvStore
}

/**
 * Legacy `git-credentials` store (pre-safeStorage builds). electron-store's
 * `encryptionKey` is obfuscation, not security — kept read-only so tokens
 * saved by old versions keep working until the user re-enters them.
 */
export async function getLegacyCredentialStore(): Promise<KvStore> {
  const { default: Store } = await import('electron-store')
  return new Store({
    name: 'git-credentials',
    encryptionKey: 'testnizer-secure-key-v1',
  }) as unknown as KvStore
}

export function legacyCredentialKey(repoUrl: string): string {
  return `git.${Buffer.from(repoUrl).toString('base64').slice(0, 32)}`
}

interface StoredGitConfig {
  repoUrl?: string
  username?: string
  branch?: string
  token?: string
}

/**
 * Resolve the project's Git settings with a usable (decrypted) token.
 * Returns null when no remote is configured at all. `token` may still be ''
 * — callers that need it must check and surface {@link GIT_TOKEN_MISSING_ERROR}.
 */
export async function getProjectGitConfig(projectId: string): Promise<ProjectGitConfig | null> {
  try {
    const settingsStore = await getSettingsStore()
    const all = settingsStore.get('git') as Record<string, StoredGitConfig> | undefined
    const config = all?.[projectId]
    if (!config?.repoUrl) return null

    // Values written since the safeStorage migration carry the `enc:v1:`
    // envelope; legacy plaintext passes through decryptSecret unchanged.
    let token = decryptSecret(config.token || '') || ''
    if (!token) {
      try {
        const legacy = await getLegacyCredentialStore()
        const creds = legacy.get(legacyCredentialKey(config.repoUrl)) as
          | { token?: string }
          | undefined
        token = decryptSecret(creds?.token || '') || ''
      } catch {
        /* legacy store unreadable — fall through with '' */
      }
    }

    let localPath = ''
    try {
      const db = getDb()
      const project = db.prepare('SELECT local_path FROM projects WHERE id = ?').get(projectId) as
        | { local_path?: string | null }
        | undefined
      localPath = project?.local_path || ''
      if (!localPath && project) {
        // "Git only" projects are created without a folder picker, so
        // local_path was NULL and every git:* handler answered "no config"
        // right after creation. Default to a per-project dir under userData
        // and persist it so the checkout stays put across sessions.
        localPath = defaultGitLocalPath(projectId)
        db.prepare('UPDATE projects SET local_path = ? WHERE id = ?').run(localPath, projectId)
      }
    } catch {
      /* DB not available (e.g. pre-init) — callers that need localPath check it */
    }

    return {
      repoUrl: config.repoUrl,
      username: config.username || '',
      branch: config.branch || 'main',
      token,
      localPath,
    }
  } catch {
    return null
  }
}

/**
 * Embed HTTPS Basic credentials in the remote URL for simple-git.
 *
 * - SSH remotes cannot carry a PAT → explicit error instead of `new URL` throwing "Invalid URL".
 * - Userinfo already present in the stored URL is replaced, never doubled.
 * - GitHub/GitLab/Azure accept any non-empty username with a PAT, but several
 *   servers reject an EMPTY username outright — default to `token`.
 */
const SSH_REMOTE = /^(ssh|git):\/\//i
const SCP_REMOTE = /^[^/@\s]+@[^/:\s]+:/

function isSshRemote(url: string): boolean {
  return SSH_REMOTE.test(url) || SCP_REMOTE.test(url)
}

/** `file://` mirrors and plain paths carry no credentials — pass them through untouched. */
function isLocalRemote(url: string): boolean {
  return /^file:/i.test(url) || url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url)
}

export function buildAuthUrl(repoUrl: string, username: string, token: string): string {
  const trimmed = repoUrl.trim()
  if (isLocalRemote(trimmed)) return trimmed
  if (isSshRemote(trimmed) || !/^https?:\/\//i.test(trimmed)) {
    throw new Error(GIT_SSH_URL_ERROR)
  }
  const urlObj = new URL(trimmed)
  urlObj.username = encodeURIComponent(username.trim() || 'token')
  urlObj.password = encodeURIComponent(token)
  return urlObj.toString()
}

/**
 * Scrub a token (raw and percent-encoded) out of an error message before it
 * reaches a toast / log — simple-git echoes the remote URL on failure.
 */
export function redactToken(message: string, token: string | undefined): string {
  if (!token) return message
  let out = message.split(token).join('***')
  const enc = encodeURIComponent(token)
  if (enc !== token) out = out.split(enc).join('***')
  return out
}

/**
 * Everything simple-git needs to talk to the remote WITHOUT the token ever
 * touching a URL (and therefore `.git/config`, `git remote -v`, error
 * output or the user's backups). The credential rides in a per-process
 * `-c http.extraHeader=Authorization: Basic …`; the remote URL stays clean.
 * The system credential helper is disabled so a wrong/empty token fails
 * fast instead of popping Git Credential Manager / osxkeychain dialogs from
 * inside Electron, and `GIT_TERMINAL_PROMPT=0` stops git from waiting on a
 * TTY that does not exist.
 */
export interface GitAuth {
  cleanUrl: string
  config: string[]
  env: Record<string, string>
}

export function gitAuth(repoUrl: string, username: string, token: string): GitAuth {
  const trimmed = repoUrl.trim()
  if (isSshRemote(trimmed)) throw new Error(GIT_SSH_URL_ERROR)
  const config: string[] = ['credential.helper=']
  let cleanUrl = trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    const u = new URL(trimmed)
    u.username = ''
    u.password = ''
    cleanUrl = u.toString()
    if (token) {
      const basic = Buffer.from(`${username.trim() || 'token'}:${token}`, 'utf8').toString('base64')
      config.push(`http.extraHeader=Authorization: Basic ${basic}`)
    }
  } else if (!isLocalRemote(trimmed)) {
    throw new Error(GIT_SSH_URL_ERROR)
  }
  return { cleanUrl, config, env: { GIT_TERMINAL_PROMPT: '0' } }
}

/** True for the failure texts git/curl emit on 401/403 or a missing credential. */
export function isGitAuthError(message: string): boolean {
  return /Authentication failed|HTTP 401|HTTP 403|returned error: 40[13]|could not read Username|Invalid username or (token|password)|Authorization failed|terminal prompts disabled/i.test(
    message,
  )
}

let identityConfigCache: string[] | null = null

/**
 * `git commit` needs an author. A fresh machine with no global identity fails
 * with "Please tell me who you are" before the network is even reached —
 * indistinguishable, to the user, from a token problem. Return the `-c`
 * entries that supply a fallback identity ONLY when the user has none.
 */
export async function identityConfig(): Promise<string[]> {
  if (identityConfigCache) return identityConfigCache
  let hasName = false
  try {
    const { simpleGit } = await import('simple-git')
    const r = await simpleGit().getConfig('user.name')
    hasName = Boolean(r.value && r.value.trim())
  } catch {
    hasName = false
  }
  identityConfigCache = hasName ? [] : ['user.name=Testnizer', 'user.email=testnizer@localhost']
  return identityConfigCache
}

/** Test seam. */
export function _resetIdentityConfigCache(): void {
  identityConfigCache = null
}
