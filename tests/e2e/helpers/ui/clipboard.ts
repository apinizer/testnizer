import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, type ElectronApplication, type Page } from '@playwright/test'

/**
 * Copy-to-clipboard tests are the one genuinely cross-worker resource: every
 * Electron app shares the single OS-wide clipboard, so two workers clicking a
 * "copy" button concurrently clobber each other's value and the polling read
 * sees the wrong marker.
 *
 * Rather than tag these tests @serial and split them into a separate run, we
 * serialise just the clipboard critical section with a filesystem mutex. Under
 * --workers=1 this is a no-op (instant lock); under --workers=4 only one worker
 * touches the clipboard at a time, so the seed → click → read sequence is
 * atomic per test. Lock is always released (try/finally) and is self-healing
 * via a staleness timeout so a crashed worker can't wedge the suite.
 */
const LOCK_PATH = path.join(os.tmpdir(), 'testnizer-clipboard.lock')
const STALE_MS = 30_000

async function acquire(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(LOCK_PATH)
      return
    } catch {
      // Reclaim a stale lock left by a crashed/killed worker.
      try {
        const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs
        if (age > STALE_MS) {
          fs.rmSync(LOCK_PATH, { recursive: true, force: true })
          continue
        }
      } catch {
        // lock vanished between stat calls — retry immediately
        continue
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('clipboard lock timed out')
}

function release(): void {
  try {
    fs.rmSync(LOCK_PATH, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
}

/**
 * Click a copy button and assert the OS clipboard ends up containing `marker`,
 * serialised against other workers. Seeds a sentinel first so we prove the copy
 * actually ran (not that the value was already present).
 */
export async function expectCopyToClipboard(
  page: Page,
  app: ElectronApplication,
  copyTestId: string,
  marker: string,
): Promise<void> {
  await acquire()
  try {
    await app.evaluate(({ clipboard }) => clipboard.writeText('clipboard-empty-sentinel'))
    await page.getByTestId(copyTestId).click()
    await expect
      .poll(async () => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
      .toContain(marker)
  } finally {
    release()
  }
}
