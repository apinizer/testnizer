import { ipcMain, dialog } from 'electron'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import {
  keystoreEngine,
  resolveType,
  type KeystoreType,
  type KeystoreMeta,
  type KeystoreAliasDetail,
} from '../lib/keystore'
import { encryptSecret, decryptSecret, isEncryptionAvailable } from '../lib/secure-storage'
import {
  listKeystores,
  getKeystore,
  createKeystore,
  updateKeystore,
  deleteKeystore,
  type KeystoreMetaRow,
} from '../db/keystore.repo'

/**
 * Keystore Studio (Faz B1) IPC — read-only viewer + Model-B library.
 *
 * Invariant 1 (design §10): the keystore Buffer, the store password, and any
 * per-alias key password live ONLY in main inside the engine session. Every
 * response below carries a `sessionId` plus PUBLIC metadata (alias summaries,
 * certificate chain incl. the cert PEM). Raw keystore bytes, private keys, and
 * passwords are NEVER returned to the renderer.
 *
 * Invariant 2: Model-B secrets — the serialized keystore `blob` and (opt-in)
 * `store_password` — are `encryptSecret`-wrapped HERE, at the handler boundary
 * (`enc:v1:` safeStorage). The repo stays secret-agnostic.
 */

interface Ok<T> {
  success: true
  data: T
}
interface Err {
  success: false
  error: string
}
type R<T> = Ok<T> | Err

function wrap<T>(fn: () => T | Promise<T>): Promise<R<T>> {
  return Promise.resolve()
    .then(fn)
    .then((data) => ({ success: true as const, data }))
    .catch((e) => ({ success: false as const, error: e instanceof Error ? e.message : String(e) }))
}

/** 5 MiB ceiling — a keystore larger than this is almost certainly not one. */
const MAX_KEYSTORE_BYTES = 5 * 1024 * 1024

/** Guess the keystore type from a file name (renderer may still override). */
function detectTypeFromName(fileName: string): KeystoreType {
  const ext = extname(fileName).toLowerCase()
  if (ext === '.p12' || ext === '.pfx') return 'PKCS12'
  return 'JKS'
}

// ── Renderer-facing DTOs (public only) ───────────────────────────────────────

interface SessionResult {
  sessionId: string
  meta: KeystoreMeta
}

interface PickFileResult {
  path: string
  fileName: string
  type: KeystoreType
}

/** Read + size-check a keystore file, returning its bytes (stays in main). */
function readKeystoreFile(path: string): Buffer {
  const bytes = readFileSync(path)
  if (bytes.length === 0) {
    throw new Error('The selected file is empty.')
  }
  if (bytes.length > MAX_KEYSTORE_BYTES) {
    throw new Error('That file is larger than 5 MiB — it does not look like a keystore.')
  }
  return bytes
}

// ── Payload shapes ───────────────────────────────────────────────────────────

interface OpenPayload {
  path?: string
  /** base64-encoded bytes — accepted for programmatic callers/tests only. */
  bytes?: string
  password?: string
  type?: string
}

interface CreateNewPayload {
  type?: string
  password?: string
}

interface AliasDetailPayload {
  sessionId: string
  alias: string
}

interface LibrarySavePayload {
  sessionId: string
  name: string
  rememberPassword?: boolean
  /** Present ⇒ update an existing library row; absent ⇒ create a new one. */
  id?: string
}

interface LibraryOpenPayload {
  id: string
  /** Store password to use when the row did NOT remember one. */
  password?: string
}

export function registerKeystoreHandlers(): void {
  // ── Read-only viewer ───────────────────────────────────────────────────────

  // Native picker → returns the path + a type guess. Bytes are read in main
  // only at `keystore:open` time; the path (not secret) is safe to hand back.
  ipcMain.handle('keystore:pickFile', () =>
    wrap(async (): Promise<PickFileResult> => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Keystore', extensions: ['jks', 'p12', 'pfx', 'keystore'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (result.canceled || result.filePaths.length === 0) {
        throw new Error('Cancelled')
      }
      const path = result.filePaths[0]
      const fileName = basename(path)
      return { path, fileName, type: detectTypeFromName(fileName) }
    }),
  )

  // Open an existing keystore into a new main-process session.
  ipcMain.handle('keystore:open', (_e, payload: OpenPayload) =>
    wrap((): SessionResult => {
      let bytes: Buffer
      if (payload.path) {
        bytes = readKeystoreFile(payload.path)
      } else if (payload.bytes) {
        bytes = Buffer.from(payload.bytes, 'base64')
        if (bytes.length === 0) throw new Error('Keystore content cannot be empty')
      } else {
        throw new Error('A keystore path or bytes must be provided.')
      }
      const type = resolveType(payload.type)
      return keystoreEngine.open(bytes, payload.password ?? '', type)
    }),
  )

  // Create an empty keystore in a new session.
  ipcMain.handle('keystore:createNew', (_e, payload: CreateNewPayload) =>
    wrap((): SessionResult => {
      return keystoreEngine.createEmpty(payload.type ?? 'JKS', payload.password ?? '')
    }),
  )

  // Re-inspect a live session — alias summaries only.
  ipcMain.handle('keystore:list', (_e, sessionId: string) =>
    wrap((): KeystoreMeta => keystoreEngine.inspect(sessionId)),
  )

  // Full certificate chain for one alias (public material — cert PEM, no key).
  ipcMain.handle('keystore:aliasDetail', (_e, payload: AliasDetailPayload) =>
    wrap((): KeystoreAliasDetail => keystoreEngine.aliasDetail(payload.sessionId, payload.alias)),
  )

  // Dispose a session — frees the bytes/passwords held in main.
  ipcMain.handle('keystore:closeSession', (_e, sessionId: string) =>
    wrap((): { closed: true } => {
      keystoreEngine.close(sessionId)
      return { closed: true }
    }),
  )

  // ── Model-B library (persisted keystores) ────────────────────────────────────

  // Serialize the current session and persist it (blob + optional password,
  // both encrypted here). `id` present ⇒ update; absent ⇒ create.
  ipcMain.handle('keystore:librarySave', (_e, payload: LibrarySavePayload) =>
    wrap((): KeystoreMetaRow => {
      const name = payload.name?.trim()
      if (!name) throw new Error('A name is required to save to the library.')
      const snap = keystoreEngine.exportForLibrary(payload.sessionId)
      const encBlob = encryptSecret(snap.bytes.toString('base64'))
      if (!encBlob) throw new Error('Failed to encrypt the keystore for storage.')
      // Never write a remembered password as cleartext: when the OS keychain is
      // unavailable, encryptSecret falls back to plaintext, so we force remember
      // OFF (store_password = NULL) and require re-entry on open. The keystore
      // blob itself is keystore-encrypted, so it is safe to persist as-is.
      const encPassword =
        payload.rememberPassword && isEncryptionAvailable()
          ? encryptSecret(snap.storePassword)
          : null

      const row = payload.id
        ? updateKeystore(payload.id, {
            name,
            type: snap.type,
            blob: encBlob,
            store_password: encPassword,
            alias_count: snap.aliasCount,
            size_bytes: snap.bytes.length,
          })
        : createKeystore({
            name,
            type: snap.type,
            blob: encBlob,
            store_password: encPassword,
            alias_count: snap.aliasCount,
            size_bytes: snap.bytes.length,
          })
      if (!row) throw new Error('Keystore library entry not found.')
      // Return META ONLY — never the blob/password columns. `remembered` is the
      // boolean derived from whether a store_password was persisted.
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        alias_count: row.alias_count,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        updated_at: row.updated_at,
        remembered: row.store_password != null,
      }
    }),
  )

  // List library metadata — never blob/password (the repo query already omits).
  ipcMain.handle('keystore:libraryList', () => wrap((): KeystoreMetaRow[] => listKeystores()))

  // Decrypt a stored keystore and open it into a NEW session. Uses the
  // remembered password if present, else the caller-supplied one.
  ipcMain.handle('keystore:libraryOpen', (_e, payload: LibraryOpenPayload) =>
    wrap((): SessionResult => {
      const row = getKeystore(payload.id)
      if (!row) throw new Error('Keystore library entry not found.')
      const b64 = decryptSecret(row.blob)
      if (!b64) {
        throw new Error('The stored keystore is unavailable (OS encryption is locked or missing).')
      }
      const bytes = Buffer.from(b64, 'base64')

      let password: string
      if (row.store_password) {
        const remembered = decryptSecret(row.store_password)
        if (remembered === null) {
          throw new Error(
            'The stored password is unavailable (OS encryption is locked or missing).',
          )
        }
        password = remembered
      } else {
        password = payload.password ?? ''
      }
      return keystoreEngine.open(bytes, password, row.type)
    }),
  )

  // Delete a library entry.
  ipcMain.handle('keystore:libraryDelete', (_e, payload: { id: string }) =>
    wrap((): { deleted: true } => {
      deleteKeystore(payload.id)
      return { deleted: true }
    }),
  )
}
