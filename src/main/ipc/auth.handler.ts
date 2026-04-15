import { ipcMain, shell } from 'electron'
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { getDb } from '../db/database'
import { OAUTH_CREDENTIALS } from '../config/oauth.config'

// ─── Password helpers (crypto.scrypt — no extra dependency) ──────

const SCRYPT_KEYLEN = 64

function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  return new Promise((resolve, reject) => {
    const salt = randomBytes(32).toString('hex')
    scrypt(password, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err)
      else resolve({ hash: derivedKey.toString('hex'), salt })
    })
  })
}

function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEYLEN, (err, derivedKey) => {
      if (err) reject(err)
      else {
        const hashBuffer = Buffer.from(hash, 'hex')
        resolve(timingSafeEqual(derivedKey, hashBuffer))
      }
    })
  })
}

// ─── Session helpers ─────────────────────────────────────────────

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function createSession(userId: string): { token: string; expiresAt: number } {
  const db = getDb()
  const token = randomUUID() + '-' + randomBytes(16).toString('hex')
  const now = Date.now()
  const expiresAt = now + SESSION_DURATION_MS

  db.prepare(`
    INSERT INTO sessions (id, user_id, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, token, expiresAt, now)

  return { token, expiresAt }
}

function cleanExpiredSessions(): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
}

// ─── User row type ───────────────────────────────────────────────

interface UserRow {
  id: string
  email: string
  username: string
  display_name: string | null
  password_hash: string | null
  salt: string | null
  avatar_url: string | null
  auth_provider: string
  provider_id: string | null
  created_at: number
  updated_at: number
}

interface SessionRow {
  id: string
  user_id: string
  token: string
  expires_at: number
  created_at: number
}

function sanitizeUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    authProvider: user.auth_provider,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  }
}

// ─── OAuth helpers ───────────────────────────────────────────────

const OAUTH_PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['email', 'profile'],
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['user:email'],
  },
  gitlab: {
    authUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    userInfoUrl: 'https://gitlab.com/api/v4/user',
    scopes: ['read_user'],
  },
} as const

type OAuthProvider = 'google' | 'github' | 'gitlab'

async function startOAuthFlow(provider: OAuthProvider): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const providerConfig = OAUTH_PROVIDERS[provider]
  const creds = OAUTH_CREDENTIALS[provider]

  if (!creds.clientId || creds.clientId.startsWith('YOUR_')) {
    return { success: false, error: `${provider} login is not available yet.` }
  }

  const redirectUri = 'http://localhost:19284/oauth/callback'
  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: providerConfig.scopes.join(' '),
    state,
  })

  const authUrl = `${providerConfig.authUrl}?${params.toString()}`

  // Start a temporary local HTTP server to catch the OAuth callback
  return new Promise((resolve) => {
    let resolved = false

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (resolved) { res.end(); return }

      const reqUrl = new URL(req.url || '/', `http://localhost:19284`)

      if (reqUrl.pathname !== '/oauth/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      const code = reqUrl.searchParams.get('code')
      const returnedState = reqUrl.searchParams.get('state')
      const error = reqUrl.searchParams.get('error')

      // Always respond with a nice HTML page first
      const sendPage = (title: string, message: string, isError: boolean) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f4f4f6">
  <div style="text-align:center;padding:40px;background:white;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.1);max-width:400px">
    <div style="font-size:48px;margin-bottom:16px">${isError ? '&#10060;' : '&#9989;'}</div>
    <h2 style="margin:0 0 8px;color:#111827">${title}</h2>
    <p style="color:#6b7280;margin:0">${message}</p>
  </div>
</body>
</html>`)
      }

      // Cleanup server
      const cleanup = () => {
        resolved = true
        try { server.close() } catch { /* ignore */ }
      }

      if (error) {
        sendPage('Authentication Failed', `Error: ${error}. You can close this tab.`, true)
        cleanup()
        resolve({ success: false, error: `OAuth error: ${error}` })
        return
      }

      if (returnedState !== state) {
        sendPage('Authentication Failed', 'Security check failed (state mismatch). You can close this tab.', true)
        cleanup()
        resolve({ success: false, error: 'OAuth state mismatch' })
        return
      }

      if (!code) {
        sendPage('Authentication Failed', 'No authorization code received. You can close this tab.', true)
        cleanup()
        resolve({ success: false, error: 'No authorization code received' })
        return
      }

      try {
        // Exchange code for token
        const tokenResponse = await fetch(providerConfig.tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        })
        const tokenData = await tokenResponse.json() as Record<string, string>
        const accessToken = tokenData.access_token

        if (!accessToken) {
          sendPage('Authentication Failed', 'Could not get access token. You can close this tab.', true)
          cleanup()
          resolve({ success: false, error: 'Failed to get access token' })
          return
        }

        // Get user info
        const userResponse = await fetch(providerConfig.userInfoUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const userData = await userResponse.json() as Record<string, string>

        // Normalize user data across providers
        let email: string
        let name: string
        let avatarUrl: string
        let providerId: string

        if (provider === 'google') {
          email = userData.email
          name = userData.name
          avatarUrl = userData.picture
          providerId = userData.id
        } else if (provider === 'github') {
          email = userData.email
          name = userData.login || userData.name
          avatarUrl = userData.avatar_url
          providerId = String(userData.id)
        } else {
          // gitlab
          email = userData.email
          name = userData.username || userData.name
          avatarUrl = userData.avatar_url
          providerId = String(userData.id)
        }

        if (!email) {
          sendPage('Authentication Failed', 'Could not get email from provider. You can close this tab.', true)
          cleanup()
          resolve({ success: false, error: 'Could not get email from OAuth provider' })
          return
        }

        // Find or create user
        const db = getDb()
        let user = db.prepare('SELECT * FROM users WHERE email = ? AND auth_provider = ?')
          .get(email, provider) as UserRow | undefined

        const now = Date.now()
        if (!user) {
          // Check if email exists with different provider
          const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined
          if (existingUser) {
            sendPage('Authentication Failed', `An account with this email already exists (${existingUser.auth_provider}). You can close this tab.`, true)
            cleanup()
            resolve({ success: false, error: `An account with this email already exists (${existingUser.auth_provider})` })
            return
          }

          const userId = randomUUID()
          const username = name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || `user_${randomBytes(4).toString('hex')}`

          // Ensure unique username
          let finalUsername = username
          let counter = 1
          while (db.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername)) {
            finalUsername = `${username}${counter}`
            counter++
          }

          db.prepare(`
            INSERT INTO users (id, email, username, display_name, avatar_url, auth_provider, provider_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(userId, email, finalUsername, name, avatarUrl, provider, providerId, now, now)

          user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
        } else {
          // Update avatar and display name on each login
          db.prepare('UPDATE users SET avatar_url = ?, display_name = ?, updated_at = ? WHERE id = ?')
            .run(avatarUrl, name, now, user.id)
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow
        }

        const session = createSession(user.id)
        sendPage('Authentication Successful', 'You are now signed in. You can close this tab and return to Apinizer.', false)
        cleanup()
        resolve({ success: true, data: { user: sanitizeUser(user), session } })
      } catch (e) {
        sendPage('Authentication Failed', `${(e as Error).message}. You can close this tab.`, true)
        cleanup()
        resolve({ success: false, error: (e as Error).message })
      }
    })

    // Listen on port 19284
    server.listen(19284, '127.0.0.1', () => {
      // Open the system browser
      shell.openExternal(authUrl)
    })

    server.on('error', (err) => {
      if (!resolved) {
        resolved = true
        resolve({ success: false, error: `Could not start OAuth callback server: ${err.message}` })
      }
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        try { server.close() } catch { /* ignore */ }
        resolve({ success: false, error: 'OAuth login timed out' })
      }
    }, 5 * 60 * 1000)
  })
}

// ─── Register handlers ───────────────────────────────────────────

export function registerAuthHandlers(): void {
  // ─── Register (local) ──────────────────────────────────────
  ipcMain.handle('auth:register', async (_event, payload: {
    email: string
    username: string
    password: string
    displayName?: string
  }) => {
    try {
      const db = getDb()
      const { email, username, password, displayName } = payload

      // Validation
      if (!email || !username || !password) {
        return { success: false, error: 'Email, username and password are required' }
      }
      if (password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters' }
      }
      if (username.length < 3) {
        return { success: false, error: 'Username must be at least 3 characters' }
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return { success: false, error: 'Username can only contain letters, numbers, _ and -' }
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { success: false, error: 'Invalid email format' }
      }

      // Check uniqueness
      const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
      if (existingEmail) {
        return { success: false, error: 'An account with this email already exists' }
      }
      const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
      if (existingUsername) {
        return { success: false, error: 'This username is already taken' }
      }

      const { hash, salt } = await hashPassword(password)
      const userId = randomUUID()
      const now = Date.now()

      db.prepare(`
        INSERT INTO users (id, email, username, display_name, password_hash, salt, auth_provider, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?)
      `).run(userId, email, username, displayName || username, hash, salt, now, now)

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
      const session = createSession(userId)

      return { success: true, data: { user: sanitizeUser(user), session } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Login (local) ─────────────────────────────────────────
  ipcMain.handle('auth:login', async (_event, payload: {
    emailOrUsername: string
    password: string
  }) => {
    try {
      const db = getDb()
      const { emailOrUsername, password } = payload

      if (!emailOrUsername || !password) {
        return { success: false, error: 'Email/username and password are required' }
      }

      // Find user by email or username
      const user = db.prepare(
        'SELECT * FROM users WHERE (email = ? OR username = ?) AND auth_provider = ?'
      ).get(emailOrUsername, emailOrUsername, 'local') as UserRow | undefined

      if (!user) {
        return { success: false, error: 'Invalid credentials' }
      }
      if (!user.password_hash || !user.salt) {
        return { success: false, error: 'This account uses social login' }
      }

      const valid = await verifyPassword(password, user.password_hash, user.salt)
      if (!valid) {
        return { success: false, error: 'Invalid credentials' }
      }

      cleanExpiredSessions()
      const session = createSession(user.id)

      return { success: true, data: { user: sanitizeUser(user), session } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Get session (check if logged in) ──────────────────────
  ipcMain.handle('auth:getSession', async (_event, token: string) => {
    try {
      const db = getDb()
      cleanExpiredSessions()

      const session = db.prepare(
        'SELECT * FROM sessions WHERE token = ? AND expires_at > ?'
      ).get(token, Date.now()) as SessionRow | undefined

      if (!session) {
        return { success: false, error: 'Session expired' }
      }

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id) as UserRow | undefined
      if (!user) {
        return { success: false, error: 'User not found' }
      }

      return { success: true, data: { user: sanitizeUser(user) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Logout ────────────────────────────────────────────────
  ipcMain.handle('auth:logout', async (_event, token: string) => {
    try {
      const db = getDb()
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Update profile ────────────────────────────────────────
  ipcMain.handle('auth:updateProfile', async (_event, payload: {
    userId: string
    displayName?: string
    email?: string
    username?: string
  }) => {
    try {
      const db = getDb()
      const { userId, displayName, email, username } = payload
      const now = Date.now()

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
      if (!user) {
        return { success: false, error: 'User not found' }
      }

      // Check email uniqueness if changed
      if (email && email !== user.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { success: false, error: 'Invalid email format' }
        }
        const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId)
        if (existing) {
          return { success: false, error: 'This email is already in use' }
        }
      }

      // Check username uniqueness if changed
      if (username && username !== user.username) {
        if (username.length < 3) {
          return { success: false, error: 'Username must be at least 3 characters' }
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
          return { success: false, error: 'Username can only contain letters, numbers, _ and -' }
        }
        const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId)
        if (existing) {
          return { success: false, error: 'This username is already taken' }
        }
      }

      db.prepare(`
        UPDATE users SET
          display_name = COALESCE(?, display_name),
          email = COALESCE(?, email),
          username = COALESCE(?, username),
          updated_at = ?
        WHERE id = ?
      `).run(displayName ?? null, email ?? null, username ?? null, now, userId)

      const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
      return { success: true, data: { user: sanitizeUser(updated) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Change password (local users only) ────────────────────
  ipcMain.handle('auth:changePassword', async (_event, payload: {
    userId: string
    currentPassword: string
    newPassword: string
  }) => {
    try {
      const db = getDb()
      const { userId, currentPassword, newPassword } = payload

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
      if (!user) {
        return { success: false, error: 'User not found' }
      }
      if (user.auth_provider !== 'local') {
        return { success: false, error: 'Password change is only available for local accounts' }
      }
      if (!user.password_hash || !user.salt) {
        return { success: false, error: 'Account has no password set' }
      }

      const valid = await verifyPassword(currentPassword, user.password_hash, user.salt)
      if (!valid) {
        return { success: false, error: 'Current password is incorrect' }
      }
      if (newPassword.length < 6) {
        return { success: false, error: 'New password must be at least 6 characters' }
      }

      const { hash, salt } = await hashPassword(newPassword)
      db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
        .run(hash, salt, Date.now(), userId)

      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Delete account ────────────────────────────────────────
  ipcMain.handle('auth:deleteAccount', async (_event, payload: {
    userId: string
    password?: string
  }) => {
    try {
      const db = getDb()
      const { userId, password } = payload

      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined
      if (!user) {
        return { success: false, error: 'User not found' }
      }

      // Verify password for local users
      if (user.auth_provider === 'local' && user.password_hash && user.salt) {
        if (!password) {
          return { success: false, error: 'Password is required to delete account' }
        }
        const valid = await verifyPassword(password, user.password_hash, user.salt)
        if (!valid) {
          return { success: false, error: 'Password is incorrect' }
        }
      }

      // Delete sessions first, then user
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
      db.prepare('DELETE FROM users WHERE id = ?').run(userId)

      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── OAuth flows ───────────────────────────────────────────
  ipcMain.handle('auth:oauthGoogle', async () => {
    return startOAuthFlow('google')
  })

  ipcMain.handle('auth:oauthGithub', async () => {
    return startOAuthFlow('github')
  })

  ipcMain.handle('auth:oauthGitlab', async () => {
    return startOAuthFlow('gitlab')
  })

  // ─── List users (for admin/debug) ──────────────────────────
  ipcMain.handle('auth:listUsers', async () => {
    try {
      const db = getDb()
      const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[]
      return { success: true, data: users.map(sanitizeUser) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
