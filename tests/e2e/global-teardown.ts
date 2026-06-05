import fs from 'node:fs'
import path from 'node:path'
import { SERVERS_STATE_FILE } from './servers/index'

const SUPERVISOR_PID = path.join(__dirname, 'servers/.supervisor.pid')

export default async function globalTeardown(): Promise<void> {
  if (fs.existsSync(SUPERVISOR_PID)) {
    const pid = Number(fs.readFileSync(SUPERVISOR_PID, 'utf8').trim())
    try {
      process.kill(pid, 'SIGTERM')
      console.log('[e2e] Stopped test server supervisor pid=', pid)
    } catch {
      // already dead
    }
    fs.unlinkSync(SUPERVISOR_PID)
  }
  if (fs.existsSync(SERVERS_STATE_FILE)) {
    fs.unlinkSync(SERVERS_STATE_FILE)
  }
}
