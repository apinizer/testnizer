/**
 * Long-running test server supervisor. Spawned detached by Playwright globalSetup.
 * Usage: npx tsx tests/e2e/servers/run-standalone.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { bootGlobalServers, shutdownGlobalServers } from './index'

const PID_FILE = path.join(__dirname, '.supervisor.pid')

async function shutdown(): Promise<void> {
  await shutdownGlobalServers()
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE)
  process.exit(0)
}

async function main(): Promise<void> {
  await bootGlobalServers()
  fs.writeFileSync(PID_FILE, String(process.pid))
  console.log('[e2e-servers] supervisor running, pid=', process.pid)
}

main().catch((err) => {
  console.error('[e2e-servers] fatal:', err)
  process.exit(1)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
