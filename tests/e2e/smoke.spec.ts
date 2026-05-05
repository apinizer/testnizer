import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

let app: ElectronApplication
let window: Page
let userDataDir: string

test.beforeAll(async () => {
  // Production build (out/main/index.js) must exist — run `npm run build` first.
  const mainPath = path.resolve(__dirname, '../../out/main/index.js')
  if (!fs.existsSync(mainPath)) {
    throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
  }

  // Isolated userData per test run so Apinizer→Testnizer migration code doesn't
  // pull in the developer's real workspace data and so login state is fresh.
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-e2e-'))

  app = await electron.launch({
    args: [mainPath, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  })
  window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir && fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }
})

test('main window opens with Testnizer title', async () => {
  const title = await window.title()
  expect(title).toBe('Testnizer')
})

test('renderer mounts a #root element', async () => {
  await expect(window.locator('#root')).toBeAttached()
})

test('login or main UI is visible', async () => {
  // First-launch users see LoginScreen ("Welcome to Testnizer"); returning users
  // skip straight to the workbench. Either is acceptable for smoke purposes.
  const body = await window.locator('body').innerText({ timeout: 10_000 })
  const hasWelcome = /Welcome to Testnizer|Testnizer/i.test(body)
  expect(hasWelcome).toBe(true)
})
