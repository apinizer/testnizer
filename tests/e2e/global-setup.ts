import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { SERVERS_STATE_FILE } from './servers/index'

const SUPERVISOR_PID = path.join(__dirname, 'servers/.supervisor.pid')
const SUPERVISOR_LOG = path.join(__dirname, 'servers/.supervisor.log')
const RUN_SCRIPT = path.join(__dirname, 'servers/run-standalone.ts')

/** A cold CI machine (Windows above all) needs a while for `npx tsx` plus every server. */
const START_TIMEOUT_MS = process.env.CI ? 120_000 : 30_000

function logTail(): string {
  try {
    return fs.readFileSync(SUPERVISOR_LOG, 'utf8').slice(-4000)
  } catch {
    return '(no output)'
  }
}

/** Ends when the servers are up, when their process exits, or at the timeout. */
function waitForState(child: ChildProcess, timeoutMs = START_TIMEOUT_MS): Promise<void> {
  const start = Date.now()
  let exited: number | null | undefined
  child.once('exit', (code) => {
    exited = code
  })
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(SERVERS_STATE_FILE)) {
        resolve()
        return
      }
      if (exited !== undefined) {
        reject(new Error(`Test servers exited (code ${exited}):\n${logTail()}`))
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Test servers did not start in ${timeoutMs} ms:\n${logTail()}`))
        return
      }
      setTimeout(tick, 200)
    }
    tick()
  })
}

export default async function globalSetup(): Promise<void> {
  if (fs.existsSync(SUPERVISOR_PID)) {
    try {
      process.kill(Number(fs.readFileSync(SUPERVISOR_PID, 'utf8').trim()), 0)
      console.log('[e2e] Test servers already running')
      return
    } catch {
      fs.unlinkSync(SUPERVISOR_PID)
    }
  }

  // Windows: `npx` is `npx.cmd`, and since the Node security fix
  // (CVE-2024-27980, Node 20.12+) spawning a .cmd/.bat without a shell throws
  // `spawn EINVAL` (and the bare name throws ENOENT). Running through the shell
  // lets cmd.exe resolve `npx` → `npx.cmd` correctly. This is what blocked the
  // Windows build's smoke gate. mac/linux keep the plain no-shell spawn (their
  // smoke already passed). The RUN_SCRIPT path on CI has no spaces.
  const isWin = process.platform === 'win32'
  const log = fs.openSync(SUPERVISOR_LOG, 'w')
  const child = spawn('npx', ['tsx', RUN_SCRIPT], {
    detached: true,
    // Its output is the only way to learn why a gate failed before any test ran.
    stdio: ['ignore', log, log],
    shell: isWin,
    env: { ...process.env },
  })
  child.unref()
  fs.closeSync(log)

  await waitForState(child)
  const state = JSON.parse(fs.readFileSync(SERVERS_STATE_FILE, 'utf8')) as {
    ports: Record<string, number>
  }
  console.log('[e2e] Test servers started:', state.ports)
}
