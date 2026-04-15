import { ipcMain } from 'electron'
import { randomUUID, scrypt, randomBytes, timingSafeEqual } from 'crypto'
import { getDb } from '../db/database'

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

// ─── Register handlers ───────────────────────────────────────────

export function registerAuthHandlers(): void {
  // ─── Check if password is set ─────────────────────────────
  ipcMain.handle('auth:hasPassword', async () => {
    try {
      const db = getDb()
      const user = db.prepare(
        'SELECT id FROM users WHERE auth_provider = ? AND password_hash IS NOT NULL'
      ).get('local') as { id: string } | undefined
      return { success: true, data: { hasPassword: !!user } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Set password (first time or update from anonymous) ───
  ipcMain.handle('auth:setPassword', async (_event, payload: {
    password: string
  }) => {
    try {
      const db = getDb()
      const { password } = payload

      if (!password || password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' }
      }
      if (!/[a-zA-Z]/.test(password)) {
        return { success: false, error: 'Password must contain at least one letter' }
      }
      if (!/[0-9]/.test(password)) {
        return { success: false, error: 'Password must contain at least one number' }
      }

      // Check if a local user already exists
      let user = db.prepare(
        'SELECT * FROM users WHERE auth_provider = ?'
      ).get('local') as UserRow | undefined

      const { hash, salt } = await hashPassword(password)
      const now = Date.now()

      if (user) {
        // Update existing user's password
        db.prepare(
          'UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?'
        ).run(hash, salt, now, user.id)
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow
      } else {
        // Create new local user
        const userId = randomUUID()
        db.prepare(`
          INSERT INTO users (id, email, username, display_name, password_hash, salt, auth_provider, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?)
        `).run(userId, 'local@apinizer.app', 'local', 'Local User', hash, salt, now, now)
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
      }

      cleanExpiredSessions()
      const session = createSession(user.id)

      return { success: true, data: { user: sanitizeUser(user), session } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Login (password only) ──────────────────────────────────
  ipcMain.handle('auth:login', async (_event, payload: {
    password: string
  }) => {
    try {
      const db = getDb()
      const { password } = payload

      if (!password) {
        return { success: false, error: 'Password is required' }
      }

      // Find the local user with password
      const user = db.prepare(
        'SELECT * FROM users WHERE auth_provider = ? AND password_hash IS NOT NULL'
      ).get('local') as UserRow | undefined

      if (!user || !user.password_hash || !user.salt) {
        return { success: false, error: 'No password has been set' }
      }

      const valid = await verifyPassword(password, user.password_hash, user.salt)
      if (!valid) {
        return { success: false, error: 'Invalid password' }
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
      ).get(token, Date.now()) as { id: string; user_id: string; token: string; expires_at: number; created_at: number } | undefined

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
      if (newPassword.length < 8) {
        return { success: false, error: 'New password must be at least 8 characters' }
      }
      if (!/[a-zA-Z]/.test(newPassword)) {
        return { success: false, error: 'New password must contain at least one letter' }
      }
      if (!/[0-9]/.test(newPassword)) {
        return { success: false, error: 'New password must contain at least one number' }
      }

      const { hash, salt } = await hashPassword(newPassword)
      db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
        .run(hash, salt, Date.now(), userId)

      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
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
