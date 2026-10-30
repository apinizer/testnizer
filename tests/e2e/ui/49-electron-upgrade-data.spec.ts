/**
 * Issue #291 — moving from Electron 33 to Electron 44 must not lose any data.
 *
 * A user's data lives in four places, and each is checked:
 *   1. SQLite (`testnizer.db`) — compared table by table, row by row and column
 *      by column. The only differences allowed are the documented migrations
 *      in `CHANGE_RULES`, each with the reason it exists.
 *   2. Secrets sealed with safeStorage (secret variables, mock auth, the Mock
 *      MCP bearer token, the OTP seed, the AI key and the proxy password in
 *      electron-store) — read back through the app's own IPC and checked
 *      against their original plaintext.
 *   3. electron-store files (`settings.json`, `config.json`) — values kept.
 *   4. Renderer localStorage (open tabs and an unsaved draft) — every key
 *      kept, and the tabs restored on screen.
 *
 * What runs where:
 *   - ALWAYS (CI, all platforms): "a 1.5.4 profile…". The profile is rebuilt
 *     from a checked-in SQL dump written by v1.5.4 (Electron 33) through this
 *     file's own generator (see the opt-in test). It is SECRET-FREE: values
 *     stored as plaintext are fixture strings, and machine-bound ciphertext
 *     (OTP seed, certificate passphrase, AI key, proxy password) was dropped
 *     when the dump was written. This covers the DB, #239 sealing on first
 *     start, the #297 backup, settings, and a real Send.
 *   - OPT-IN (local / RC): set `TESTNIZER_OLD_BUILD_DIR` to a checkout of an
 *     older build (its own `node_modules/electron` and built `out/`). The test
 *     then writes a full profile WITH that build, so on its runtime
 *     (Electron 33 for 1.5.x / pre-#291 1.6.0), opens it with this build, and
 *     opens the result again with the old build (the downgrade). Add
 *     `TESTNIZER_WRITE_FIXTURE=1` to regenerate the checked-in dump.
 *   - MANUAL (RC checklist): the real macOS keychain and the Linux keyring.
 *     Both automated tests pin safeStorage to Chromium's built-in test keys
 *     (`--use-mock-keychain` on macOS, `--password-store=basic` on Linux) so a
 *     run never prompts and never touches the developer's keychain. The
 *     ciphertext format and the decrypt path are the same with the real
 *     keychain; whether a signed 1.6.0 can read the existing "Testnizer Safe
 *     Storage" item is checked by hand on an RC build.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getTestServerUrls } from '../helpers/test-servers'
import { acceptEula } from '../helpers/ui/bootstrap'
import { treeOpenNode, treeClearSearch } from '../helpers/ui/tree'
import { fillUrl } from '../helpers/ui/request-flow'
import {
  CURRENT_BUILD,
  closeGracefully,
  ipc,
  launchBuild,
  oldBuildFromEnv,
  readLocalStorage,
  type BuildUnderTest,
} from '../helpers/upgrade-data/launch'
import { populateUserData, type PopulateManifest } from '../helpers/upgrade-data/populate'
import {
  DatabaseSync,
  diffSnapshots,
  dumpSql,
  maskedFrom,
  readDbSetting,
  restoreSql,
  rowCounts,
  sealedFrom,
  snapshotDb,
  type ChangeRule,
  type DbSnapshot,
  type DiffReport,
} from '../helpers/upgrade-data/snapshot'

/** `SECRET_AT_REST_MIGRATION_KEY` in src/main/db/secret-at-rest-migration.ts. */
const SECRET_AT_REST_MARKER = 'migration.secretAtRest.v1'

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/upgrade-data')
const FIXTURE = {
  sql: path.join(FIXTURE_DIR, 'v1.5.4-testnizer.sql'),
  settings: path.join(FIXTURE_DIR, 'v1.5.4-settings.json'),
  config: path.join(FIXTURE_DIR, 'v1.5.4-config.json'),
  manifest: path.join(FIXTURE_DIR, 'v1.5.4-manifest.json'),
}

// ─── Allowed differences ──────────────────────────────────────────────────

const isSecretRow = (row: Record<string, unknown>): boolean => Number(row.secret) === 1

/** Mock auth JSON: only the secret FIELDS may change, and only into sealed values. */
function authJsonSealed(oldValue: unknown, newValue: unknown): boolean {
  try {
    const a = JSON.parse(String(oldValue)) as Record<string, unknown>
    const b = JSON.parse(String(newValue)) as Record<string, unknown>
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) {
      if (a[k] === b[k]) continue
      if (!sealedFrom(a[k], b[k])) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * Every difference a newer build is ALLOWED to make to an older profile. Each
 * entry is a migration that already ships; nothing here is new in #291.
 */
const CHANGE_RULES: ChangeRule[] = [
  ...(['environment_variables', 'global_variables'] as const).flatMap((table) =>
    (['value', 'initial_value'] as const).map(
      (column): ChangeRule => ({
        table,
        column,
        reason: 'issue #239: secret variable values are sealed at rest on first start',
        accept: (a, b, row) => isSecretRow(row) && sealedFrom(a, b),
      }),
    ),
  ),
  {
    table: 'mock_servers',
    column: 'auth_config',
    reason: 'issue #239: secret fields inside mock auth JSON are sealed at rest',
    accept: authJsonSealed,
  },
  {
    table: 'mock_endpoints',
    column: 'auth_override',
    reason: 'issue #239: secret fields inside mock auth JSON are sealed at rest',
    accept: authJsonSealed,
  },
  {
    table: 'mock_mcp_servers',
    column: 'bearer_token',
    reason: 'issue #239: the Mock MCP bearer token is sealed at rest',
    accept: sealedFrom,
  },
  ...(['history', 'runner_history'] as const).map(
    (table): ChangeRule => ({
      table,
      column: '*',
      reason:
        'issues #195/#238: a secret value echoed into a stored History / Runner row is masked on start',
      accept: maskedFrom,
    }),
  ),
]

/**
 * localStorage snapshots a NEWER app version reshapes when it loads them. Each
 * entry maps an old value to where the app's own migration must have put it,
 * so the comparison still proves the user's input arrived — under its new
 * name. Only for an older app version; the same version on another Electron
 * is compared as is.
 */
const LEGACY_LOCAL_STORAGE: Record<string, (old: unknown, note: (msg: string) => void) => unknown> =
  {
    // Issue #283 (1.6.0): Socket.IO tab state `subscriptions` → `listeners`,
    // `emitPayload` → `emitArgs[0].content`, with the old "show every event"
    // behaviour kept (`listenAll: true`). `newSubscription` was the text typed
    // into the add-subscription box and not yet added; the new editor has no
    // such box, so it is dropped — reported, never silently.
    'testnizer-socketio': (old, note) => {
      const walk = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(walk)
        if (!v || typeof v !== 'object') return v
        const o = v as Record<string, unknown>
        if (!('subscriptions' in o) && !('emitPayload' in o)) {
          return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]))
        }
        const { subscriptions, emitPayload, newSubscription, ...rest } = o
        if (typeof newSubscription === 'string' && newSubscription.trim() !== '') {
          note(`unsubmitted add-subscription text dropped: ${JSON.stringify(newSubscription)}`)
        }
        const names = Array.isArray(subscriptions)
          ? subscriptions.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          : []
        note(
          `subscriptions ${JSON.stringify(names)} → listeners; emitPayload ${JSON.stringify(emitPayload)} → emitArgs`,
        )
        return {
          ...rest,
          listeners: names.map((name) => ({ name, listen: true })),
          listenAll: true,
          ...(typeof emitPayload === 'string' ? { emitArgs: [{ content: emitPayload }] } : {}),
        }
      }
      return walk(old)
    },
  }

function expectNoLoss(report: DiffReport, where: string): void {
  // The evidence line for the release report: what was compared, and every
  // difference a documented migration accounted for.

  console.log(
    `[upgrade-data] ${where}: ${report.tablesCompared} tables, ${report.rowsCompared} rows compared; ` +
      `accepted=${JSON.stringify(report.acceptedChanges.map((c) => `${c.table}.${c.column}×${c.count}`))} ` +
      `addedTables=${JSON.stringify(report.addedTables)} addedRows=${JSON.stringify(report.addedRows)}`,
  )
  const summary = {
    where,
    missingTables: report.missingTables,
    missingRows: report.missingRows,
    changedValues: report.changedValues,
  }
  expect(summary, `data lost or changed in ${where}`).toEqual({
    where,
    missingTables: [],
    missingRows: [],
    changedValues: [],
  })
  expect(report.rowsCompared, `${where}: nothing was compared`).toBeGreaterThan(20)
}

/**
 * The at-rest state of the secret columns (issue #239). With a working OS
 * keychain every non-empty secret is sealed (`enc:v1:`). Without one —
 * headless Linux, `basic_text` — the app keeps the plaintext fallback by
 * design and seals on a later start that has a keychain; then no value may
 * carry the prefix (a half-sealed DB would be a bug), and `expectNoLoss`
 * has already proven each value is byte-for-byte the old one.
 */
function expectSecretsAtRest(snap: DbSnapshot, where: string, sealed: boolean): void {
  const check = (v: unknown, what: string): void => {
    if (typeof v !== 'string' || v === '') return
    expect(
      v.startsWith('enc:v1:'),
      `${where}: ${what} ${sealed ? 'left in plaintext' : 'sealed without a keychain'}`,
    ).toBe(sealed)
  }
  for (const table of ['environment_variables', 'global_variables']) {
    for (const row of snap.get(table)?.rows.values() ?? []) {
      if (!isSecretRow(row)) continue
      for (const col of ['value', 'initial_value']) check(row[col], `${table}.${col}`)
    }
  }
  for (const row of snap.get('mock_mcp_servers')?.rows.values() ?? []) {
    check(row.bearer_token, 'mock_mcp_servers.bearer_token')
  }
}

/**
 * electron-store values survive. One documented move: since the
 * `shared_settings` column, the team-shared half of `project.<id>.settings`
 * (auth, scripts, timeout, TLS, redirects) lives in the database and is read
 * back merged — `verifySecretsAndSettings` checks it through `settings:get`.
 * So the `project` subtree is compared only for the machine-local keys.
 */
const SHARED_PROJECT_KEYS = new Set([
  'auth',
  'preScript',
  'testScript',
  'requestTimeout',
  'sslVerification',
  'followRedirects',
  'tls',
])
function expectSettingsKept(before: Record<string, unknown>, after: Record<string, unknown>): void {
  const local = (s: Record<string, unknown>): Record<string, unknown> => {
    const copy = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    const projects = (copy.project ?? {}) as Record<string, { settings?: Record<string, unknown> }>
    for (const p of Object.values(projects)) {
      for (const k of Object.keys(p.settings ?? {}))
        if (SHARED_PROJECT_KEYS.has(k)) delete p.settings![k]
    }
    return copy
  }
  expect(local(after)).toMatchObject(local(before))
}

/** No table lost rows. (New rows — migration markers, a Runner result — are fine.) */
function expectCountsKept(before: DbSnapshot, after: DbSnapshot, where: string): void {
  const a = rowCounts(after)
  for (const [table, n] of Object.entries(rowCounts(before))) {
    expect(a[table] ?? 0, `${where}: ${table} lost rows`).toBeGreaterThanOrEqual(n)
  }
}

// ─── Reading a profile back through the app ───────────────────────────────

/**
 * EULA + guest start, waiting on test ids rather than English text: the
 * fixture switches the UI to Turkish, which the shared text-based helper
 * (`loginAsGuest`) does not recognise after the first start.
 */
async function passGates(page: Page): Promise<void> {
  await acceptEula(page)
  const guest = page.getByTestId('login-continue-anonymous')
  if (await guest.isVisible().catch(() => false)) await guest.click()
  await expect(
    page
      .getByTestId('project-card')
      .or(page.getByTestId('home-new-project'))
      .or(page.getByTestId('nav-apis'))
      .first(),
  ).toBeVisible({ timeout: 30_000 })
}

interface SecureStorageStatus {
  encrypted: boolean
  backend?: string
}

/**
 * What the app reports about the OS keychain (`secureStorage:status`). The
 * test runs pinned to Chromium's test key stores (launch.ts `keychainArgs`):
 * on macOS the mock keychain and on Windows DPAPI always encrypt, so there an
 * unencrypted answer fails the test. On Linux `--password-store=basic`
 * selects `basic_text`, which the app treats as no keychain — the plaintext
 * fallback path, asserted as such by the callers.
 */
async function secureStorageStatus(page: Page): Promise<SecureStorageStatus> {
  const status = await ipc<SecureStorageStatus>(page, 'secureStorage.status')
  expect(status.success, status.error).toBe(true)
  const s = status.data!
  console.log(`[upgrade-data] secureStorage:status ${JSON.stringify(s)} on ${process.platform}`)
  if (process.platform !== 'linux') {
    expect(s.encrypted, `the OS keychain must encrypt on ${process.platform}`).toBe(true)
  }
  return s
}

/**
 * Issue #239 note in the environment manager: shown exactly when secrets are
 * stored unencrypted. Opens the first project if the app is on Project Home.
 */
async function expectSecureStorageNote(page: Page, encrypted: boolean): Promise<void> {
  if (
    !(await page
      .getByTestId('nav-apis')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('project-card').first().click()
    await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
  }
  await page.getByTestId('footer-env').click()
  const modal = page.getByTestId('environment-modal')
  await expect(modal).toBeVisible({ timeout: 8_000 })
  const note = modal.getByTestId('secret-storage-unencrypted')
  if (encrypted) {
    // The note asks main once per mount; give that answer time to arrive.
    await page.waitForTimeout(1_000)
    await expect(note).toHaveCount(0)
  } else {
    await expect(note).toBeVisible({ timeout: 10_000 })
  }
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 5_000 })
}

/** Every secret reads back as its original; settings are what was written. */
async function verifySecretsAndSettings(page: Page, m: PopulateManifest): Promise<void> {
  const envVars = await ipc<Array<{ id: string; value: string; initial_value: string }>>(
    page,
    'envVariable.list',
    m.environmentId,
  )
  expect(envVars.success, envVars.error).toBe(true)
  for (const [id, want] of Object.entries(m.envSecrets)) {
    const got = envVars.data!.find((v) => v.id === id)
    expect(got, `secret env variable ${id} missing`).toBeTruthy()
    expect({ value: got!.value, initial_value: got!.initial_value }).toEqual(want)
  }

  const globals = await ipc<Array<{ id: string; value: string; initial_value: string }>>(
    page,
    'globalVariable.listByProject',
    m.projectIds[0],
  )
  expect(globals.success, globals.error).toBe(true)
  for (const [id, want] of Object.entries(m.globalSecrets)) {
    const got = globals.data!.find((v) => v.id === id)
    expect(got, `secret project variable ${id} missing`).toBeTruthy()
    expect({ value: got!.value, initial_value: got!.initial_value }).toEqual(want)
  }

  if (m.mockServerId) {
    const s = await ipc<{ authConfig: unknown }>(page, 'mock.server.get', m.mockServerId)
    expect(s.success, s.error).toBe(true)
    expect(s.data!.authConfig).toEqual(m.mockAuth)
  }
  if (m.mockMcpServerId) {
    const s = await ipc<{ bearerToken: string }>(page, 'mockMcp.server.get', m.mockMcpServerId)
    expect(s.success, s.error).toBe(true)
    expect(s.data!.bearerToken).toBe(m.mockMcpBearer)
  }
  if (m.otpId) {
    const r = await ipc<string>(page, 'otp.reveal', m.otpId)
    expect(r.success, r.error).toBe(true)
    expect(r.data).toBe(m.otpSecret)
  }
  if (m.aiKeyScope) {
    const r = await ipc<{ key: string | null; encryptionAvailable: boolean }>(
      page,
      'aiChat.getKey',
      m.aiKeyScope,
    )
    expect(r.success, r.error).toBe(true)
    expect(r.data?.key).toBe(m.aiKey)
  }
  for (const [key, want] of Object.entries(m.settings)) {
    const r = await ipc<unknown>(page, 'settings.get', key)
    expect(r.success, r.error).toBe(true)
    if (key.endsWith('.settings') && want && typeof want === 'object') {
      // Project settings come back merged with defaults: every written field must survive.
      expect(r.data).toMatchObject(want as Record<string, unknown>)
    } else {
      expect(r.data, `setting ${key}`).toEqual(want)
    }
  }
}

/** Point {{baseUrl}} at this run's server and Send the saved request through the Runner. */
async function sendSavedRequest(page: Page, m: PopulateManifest, httpBase: string): Promise<void> {
  const upd = await ipc(page, 'envVariable.update', m.baseUrlVarId, {
    value: httpBase,
    initial_value: httpBase,
  })
  expect(upd.success, upd.error).toBe(true)
  const run = await ipc<{ results: Array<{ status?: number; error?: string; url?: string }> }>(
    page,
    'runner.execute',
    { projectId: m.projectIds[0], environmentId: m.environmentId, endpointIds: [m.sendEndpointId] },
  )
  expect(run.success, run.error).toBe(true)
  const r = run.data!.results[0]
  expect(r.error ?? null).toBeNull()
  expect(r.status).toBe(200)
}

function readJson(file: string): Record<string, unknown> {
  return fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>)
    : {}
}

function backupFiles(userData: string): string[] {
  const dir = path.join(userData, 'backups')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /^testnizer\.db\..+\.\d+$/.test(f))
    .map((f) => path.join(dir, f))
}

function tmpProfile(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tnz-upgrade-${tag}-`))
}

/**
 * Open a profile with `build`, check secrets + settings, close it, and prove
 * the DB lost nothing against `before`. Returns the DB as the build left it.
 */
async function openAndVerify(
  build: BuildUnderTest,
  userData: string,
  m: PopulateManifest,
  before: DbSnapshot,
  where: string,
  opts: { verifySecrets?: boolean; waitForSealing?: boolean; checkNote?: boolean } = {},
): Promise<{ after: DbSnapshot; localStorage: Record<string, string>; encrypted: boolean }> {
  const { app, page } = await launchBuild(build, userData)
  let localStorage: Record<string, string>
  let encrypted = false
  try {
    // Read localStorage BEFORE the app gets a chance to rewrite it.
    localStorage = await readLocalStorage(page)
    await passGates(page)
    if (opts.verifySecrets !== false) await verifySecretsAndSettings(page, m)
    if (opts.waitForSealing) {
      encrypted = (await secureStorageStatus(page)).encrypted
      const dbPath = path.join(userData, 'testnizer.db')
      if (encrypted) {
        // The #239 sweep runs ~1 s after the window is ready, not at open; a
        // user who quits sooner keeps plaintext until the next start. Wait
        // for its marker so the DB checked below is the sealed one.
        await expect
          .poll(() => readDbSetting(dbPath, SECRET_AT_REST_MARKER), { timeout: 30_000 })
          .not.toBeNull()
      } else {
        // No keychain: the sweep returns without sealing and without the
        // marker, so a later start with a keychain still seals (the #239
        // design, secret-at-rest-migration.ts). Give it the delay it would
        // take, then prove it left the marker unset.
        await page.waitForTimeout(3_000)
        expect(readDbSetting(dbPath, SECRET_AT_REST_MARKER), 'marker without a keychain').toBeNull()
      }
      if (opts.checkNote) await expectSecureStorageNote(page, encrypted)
    }
  } finally {
    await closeGracefully(app)
  }
  const after = snapshotDb(path.join(userData, 'testnizer.db'))
  expectNoLoss(diffSnapshots(before, after, CHANGE_RULES), where)
  return { after, localStorage, encrypted }
}

test.describe('Electron upgrade keeps user data (issue #291)', () => {
  test.describe.configure({ mode: 'serial' })

  test('a 1.5.4 profile opens on this build with every row, secret and setting intact', async () => {
    test.skip(!DatabaseSync, 'node:sqlite needs Node >= 22.5 (this Node is older)')
    test.skip(
      !fs.existsSync(FIXTURE.sql),
      'fixture missing: run the opt-in test with TESTNIZER_WRITE_FIXTURE=1',
    )
    test.setTimeout(180_000)
    const httpBase = getTestServerUrls().http
    const userData = tmpProfile('v154')
    const dbPath = path.join(userData, 'testnizer.db')
    try {
      restoreSql(fs.readFileSync(FIXTURE.sql, 'utf8'), dbPath)
      fs.copyFileSync(FIXTURE.settings, path.join(userData, 'settings.json'))
      if (fs.existsSync(FIXTURE.config))
        fs.copyFileSync(FIXTURE.config, path.join(userData, 'config.json'))
      const manifest = JSON.parse(fs.readFileSync(FIXTURE.manifest, 'utf8')) as PopulateManifest
      const before = snapshotDb(dbPath)
      const settingsBefore = readJson(path.join(userData, 'settings.json'))

      // First start of this build on the 1.5.4 profile.
      const { after, encrypted } = await openAndVerify(
        CURRENT_BUILD,
        userData,
        manifest,
        before,
        'live DB',
        { waitForSealing: true, checkNote: true },
      )
      expectSecretsAtRest(after, 'live DB', encrypted)
      expectCountsKept(before, after, 'live DB')

      // Issue #297: exactly one pre-migration copy, holding every row. Its
      // secrets are sealed when the keychain works; without one the copy
      // keeps the same plaintext fallback as the live DB.
      const backups = backupFiles(userData)
      expect(backups).toHaveLength(1)
      const backup = snapshotDb(backups[0])
      expectNoLoss(diffSnapshots(before, backup, CHANGE_RULES), 'pre-migration backup')
      expectSecretsAtRest(backup, 'pre-migration backup', encrypted)

      // electron-store: every 1.5.4 key is still there with the same value.
      expectSettingsKept(settingsBefore, readJson(path.join(userData, 'settings.json')))

      // Second start: no new backup (same build), and the saved request Sends.
      const { app, page } = await launchBuild(CURRENT_BUILD, userData)
      try {
        await passGates(page)
        await sendSavedRequest(page, manifest, httpBase)
      } finally {
        await closeGracefully(app)
      }
      expect(backupFiles(userData)).toHaveLength(1)
    } finally {
      fs.rmSync(userData, { recursive: true, force: true })
    }
  })

  test('a profile written by an older build survives the upgrade and the way back', async () => {
    const old = oldBuildFromEnv()
    test.skip(!old, 'opt-in: set TESTNIZER_OLD_BUILD_DIR to an older build (see the file header)')
    test.skip(!DatabaseSync, 'node:sqlite needs Node >= 22.5 (this Node is older)')
    test.setTimeout(600_000)
    const oldBuild = old as BuildUnderTest
    const httpBase = getTestServerUrls().http
    const label = oldBuild.label
    const written = tmpProfile(`${label}-written`)
    const upgraded = tmpProfile(`${label}-upgraded`)
    const downgraded = tmpProfile(`${label}-downgraded`)
    const certPath = path.join(written, 'fixture-cert.pem')
    fs.writeFileSync(
      certPath,
      '-----BEGIN CERTIFICATE-----\nZml4dHVyZQ==\n-----END CERTIFICATE-----\n',
    )

    try {
      // ── 1. The OLD build writes the profile ────────────────────────────────
      let manifest: PopulateManifest
      let lsOld: Record<string, string>
      {
        const { app, page } = await launchBuild(oldBuild, written)
        try {
          await passGates(page)
          manifest = await populateUserData(page, { label, httpBase, certPath })
          // Open two tabs and leave an unsaved draft, through the UI.
          await page.reload()
          await page.waitForFunction(() => !!(window as unknown as { api?: unknown }).api)
          await passGates(page)
          const card = page.getByTestId('project-card').filter({ hasText: `upgrade-a-${label}` })
          await card.first().click()
          await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
          // A single click opens a PREVIEW tab that the next click replaces —
          // unless it is dirty, which pins it. So: draft first, then open more.
          await treeOpenNode(page, 'Get echo')
          await treeClearSearch(page)
          await fillUrl(page, `{{baseUrl}}/get?draft=${label}`)
          await expect(page.getByTestId('tab-dirty').first()).toBeVisible({ timeout: 10_000 })
          await treeOpenNode(page, 'GraphQL users')
          await treeClearSearch(page)
          await expect(page.getByTestId('endpoint-tab')).toHaveCount(2, { timeout: 10_000 })
          // Pin it (double click), then open the Socket.IO request: its tab
          // snapshot is the one a newer app version reshapes on load.
          await page.getByTestId('endpoint-tab').filter({ hasText: 'GraphQL users' }).dblclick()
          await treeOpenNode(page, 'Socket.IO chat')
          await treeClearSearch(page)
          await expect(page.getByTestId('endpoint-tab')).toHaveCount(3, { timeout: 10_000 })
          await page.waitForTimeout(1_500) // persisted snapshots are debounced
          lsOld = await readLocalStorage(page)
        } finally {
          await closeGracefully(app)
        }
      }
      const writtenDb = path.join(written, 'testnizer.db')
      const before = snapshotDb(writtenDb)

      if (process.env.TESTNIZER_WRITE_FIXTURE === '1') writeFixture(written, manifest)

      // ── 2. THIS build opens a copy ─────────────────────────────────────────
      fs.cpSync(written, upgraded, { recursive: true })
      const settingsBefore = readJson(path.join(written, 'settings.json'))
      const {
        after,
        localStorage: lsNew,
        encrypted,
      } = await openAndVerify(CURRENT_BUILD, upgraded, manifest, before, `${label} → current`, {
        waitForSealing: true,
      })
      expectSecretsAtRest(after, 'upgrade', encrypted)
      expectCountsKept(before, after, 'upgrade')
      const backups = backupFiles(upgraded)
      expect(backups.length).toBeGreaterThanOrEqual(1)
      expectNoLoss(
        diffSnapshots(before, snapshotDb(backups[backups.length - 1]), CHANGE_RULES),
        'backup',
      )
      expectSettingsKept(settingsBefore, readJson(path.join(upgraded, 'settings.json')))

      // localStorage written by the old Chromium is read by the new one, key for key.
      // Session flags, not data: every launch clears them by design (issue
      // #240 — a start never reuses the previous session), old build or new.
      const SESSION_KEYS = new Set(['testnizer_session_token', 'testnizer_guest_mode'])
      for (const k of SESSION_KEYS) {
        delete lsOld[k]
        delete lsNew[k]
      }
      const missingKeys = Object.keys(lsOld).filter((k) => !(k in lsNew))
      expect(missingKeys, 'localStorage keys dropped').toEqual([])
      // Compared as parsed JSON: the stores re-save their snapshot on start,
      // which can reorder object keys without changing a value.
      const parsed = (v: string | undefined): unknown => {
        try {
          return JSON.parse(v ?? '')
        } catch {
          return v
        }
      }
      // Every old value is still there; a newer store may ADD fields with
      // defaults when it loads an older snapshot (the MCP tab state does).
      // Across app VERSIONS a store may also rename fields on load — that is
      // the app's own snapshot migration, so the old value is first mapped to
      // where that migration puts it (LEGACY_LOCAL_STORAGE), and must then be
      // there. Nothing is skipped.
      const sameApp = oldBuild.version === CURRENT_BUILD.version
      for (const [k, v] of Object.entries(lsOld)) {
        let oldV = parsed(v)
        const migrate = sameApp ? undefined : LEGACY_LOCAL_STORAGE[k]
        if (migrate) oldV = migrate(oldV, (note) => console.log(`[upgrade-data] ${k}: ${note}`))
        if (oldV && typeof oldV === 'object') {
          expect(parsed(lsNew[k]), `localStorage ${k}`).toMatchObject(
            oldV as Record<string, unknown>,
          )
        } else {
          expect(parsed(lsNew[k]), `localStorage ${k}`).toEqual(oldV)
        }
      }
      expect(lsOld['testnizer-request'] ?? '').toContain(`draft=${label}`)

      // The tabs come back on screen, the draft with them, and the request Sends.
      {
        const { app, page } = await launchBuild(CURRENT_BUILD, upgraded)
        try {
          await passGates(page)
          // Same as on the old build: a restart lands on Project Home unless a
          // project was left open; opening the project restores its tabs.
          if (
            !(await page
              .getByTestId('nav-apis')
              .isVisible()
              .catch(() => false))
          ) {
            await page
              .getByTestId('project-card')
              .filter({ hasText: `upgrade-a-${label}` })
              .first()
              .click()
            await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
          }
          const tabs = page.getByTestId('endpoint-tab')
          await expect(tabs.filter({ hasText: 'Get echo' })).toHaveCount(1, { timeout: 15_000 })
          await expect(tabs.filter({ hasText: 'GraphQL users' })).toHaveCount(1)
          await expect(tabs.filter({ hasText: 'Socket.IO chat' })).toHaveCount(1)
          await tabs.filter({ hasText: 'Get echo' }).click()
          await expect(page.getByTestId('url-input')).toHaveValue(`{{baseUrl}}/get?draft=${label}`)
          await sendSavedRequest(page, manifest, httpBase)
        } finally {
          await closeGracefully(app)
        }
      }
      const afterUse = snapshotDb(path.join(upgraded, 'testnizer.db'))

      // ── 3. Downgrade: the OLD build opens what THIS build left ─────────────
      fs.cpSync(upgraded, downgraded, { recursive: true })
      // A build from before issue #239 cannot open sealed values at all (that
      // is #239, not this upgrade): for it, check only that no row is lost.
      const oldBuildSeals = [...(before.get('environment_variables')?.rows.values() ?? [])].some(
        (r) => typeof r.value === 'string' && r.value.startsWith('enc:v1:'),
      )
      const { after: afterDowngrade } = await openAndVerify(
        oldBuild,
        downgraded,
        manifest,
        afterUse,
        `current → ${label} (downgrade)`,
        { verifySecrets: oldBuildSeals },
      )
      expectCountsKept(afterUse, afterDowngrade, 'downgrade')
    } finally {
      for (const d of [written, upgraded, downgraded])
        fs.rmSync(d, { recursive: true, force: true })
    }
  })
})

/**
 * Turn a profile written by an old build into the checked-in, secret-free
 * fixture. Machine-bound ciphertext cannot be reused on another machine or OS,
 * so it is dropped here and left out of the manifest.
 */
function writeFixture(userData: string, manifest: PopulateManifest): void {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })
  const dump = dumpSql(path.join(userData, 'testnizer.db'), {
    dropRows: {
      otp_entries: '1',
      sessions: '1',
      certificates: "passphrase IS NOT NULL AND passphrase <> ''",
    },
  })
  if (/enc:v1:|enc:[A-Za-z0-9+/=]{16,}/.test(dump)) {
    throw new Error('fixture dump still holds ciphertext — refusing to write it')
  }
  fs.writeFileSync(FIXTURE.sql, dump)
  const settings = readJson(path.join(userData, 'settings.json'))
  for (const k of Object.keys(settings)) {
    if (k.startsWith('aiChat') || k.toLowerCase().includes('key')) delete settings[k]
  }
  // electron-store nests dotted keys (`project.<id>.settings` → project/<id>/settings),
  // so the machine-local proxy block is removed wherever it sits.
  const dropProxy = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    delete (v as Record<string, unknown>).proxy
    for (const child of Object.values(v as Record<string, unknown>)) dropProxy(child)
  }
  dropProxy(settings)
  const sealedKeys = Object.keys(settings).filter((k) => /enc:/.test(JSON.stringify(settings[k])))
  if (sealedKeys.length > 0) {
    throw new Error(
      `fixture settings still hold ciphertext (${sealedKeys.join(', ')}) — refusing to write them`,
    )
  }
  fs.writeFileSync(FIXTURE.settings, JSON.stringify(settings, null, 2) + '\n')
  // EULA consent; absent when the build keeps it elsewhere (v1.5.4 does).
  if (fs.existsSync(path.join(userData, 'config.json'))) {
    fs.copyFileSync(path.join(userData, 'config.json'), FIXTURE.config)
  }
  const stripped: PopulateManifest = {
    ...manifest,
    certificateId: undefined,
    otpId: undefined,
    otpSecret: undefined,
    aiKeyScope: undefined,
    aiKey: undefined,
    settings: Object.fromEntries(
      Object.entries(manifest.settings).map(([k, v]) => {
        if (!k.endsWith('.settings') || !v || typeof v !== 'object') return [k, v]
        const { proxy: _proxy, ...rest } = v as Record<string, unknown>
        return [k, rest]
      }),
    ),
  }
  fs.writeFileSync(FIXTURE.manifest, JSON.stringify(stripped, null, 2) + '\n')
}
