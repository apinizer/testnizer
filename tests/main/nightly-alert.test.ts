/**
 * The nightly's alarm can only fire on a real 03:00 failure, so nobody would see
 * it break. This runs the step's own script from build.yml against a stand-in
 * `gh`, and pins which jobs it covers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import yaml from 'js-yaml'

interface Job {
  name?: string
  if?: string
  needs?: string | string[]
  permissions?: Record<string, string>
  env?: Record<string, string>
  steps?: Array<{ run?: string; shell?: string }>
}

const workflow = yaml.load(readFileSync('.github/workflows/build.yml', 'utf-8')) as {
  jobs: Record<string, Job>
}
const alert = workflow.jobs['nightly-alert']
const script = alert.steps?.[0].run ?? ''

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nightly-alert-'))
  // Logs each call; answers the issue search with the jq result it is told to.
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/bash
echo "$*" >> "$GH_LOG"
if [ "$1 $2" = "issue list" ]; then echo "$OPEN_ISSUE"; fi
`,
  )
  chmodSync(join(dir, 'gh'), 0o755)
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

function runAlert(openIssue: string): string[] {
  const log = join(dir, `log-${openIssue || 'none'}`)
  writeFileSync(log, '')
  execFileSync('bash', ['-e', '-c', script], {
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      GH_LOG: log,
      OPEN_ISSUE: openIssue,
      RUN_URL: 'https://example.test/run/1',
    },
  })
  return readFileSync(log, 'utf-8').trim().split('\n')
}

describe('nightly failure alert', () => {
  it.skipIf(process.platform === 'win32')('opens the issue when none is open', () => {
    const calls = runAlert('')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('issue create --title Nightly E2E is failing')
    expect(calls[1]).toContain('https://example.test/run/1')
  })

  it.skipIf(process.platform === 'win32')(
    'comments on the open one instead of adding another',
    () => {
      const calls = runAlert('321')
      expect(calls).toHaveLength(2)
      expect(calls[1]).toBe('issue comment 321 --body Failed again: https://example.test/run/1')
    },
  )

  it('only ever runs for a failed scheduled run', () => {
    expect(alert.if).toContain('failure()')
    expect(alert.if).toContain("github.event_name == 'schedule'")
  })

  it('may write issues and nothing else', () => {
    expect(alert.permissions).toEqual({ issues: 'write' })
  })

  /** A job that runs on the schedule but is not in `needs` could fail in silence. */
  it('watches every job that can fail on the schedule', () => {
    const skippedOnSchedule = (job: Job): boolean =>
      !!job.if && job.if.includes('startsWith(github.ref') && !job.if.includes('!startsWith')
    const ranOnSchedule = Object.entries(workflow.jobs)
      .filter(([id, job]) => id !== 'nightly-alert' && id !== 'cleanup' && !skippedOnSchedule(job))
      .map(([id]) => id)
    expect(ranOnSchedule.sort()).toEqual([...(alert.needs as string[])].sort())
  })
})

describe('cleanup keeps the nightly history', () => {
  const cleanupSteps = workflow.jobs['cleanup'].steps ?? []
  const step = cleanupSteps.find((s) => s.run?.includes('delete_old_runs'))
  const stepScript = (step?.run ?? '').replaceAll('${{ github.repository }}', 'o/r')

  function deletedRuns(listing: { scheduled: number; other: number }): string[] {
    const cleanupDir = mkdtempSync(join(tmpdir(), 'cleanup-runs-'))
    const log = join(cleanupDir, 'log')
    writeFileSync(log, '')
    const row = (prefix: string, i: number): string =>
      `${prefix}${i} 2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`
    const lines = (prefix: string, count: number): string =>
      Array.from({ length: count }, (_, i) => row(prefix, i)).join('\n')
    writeFileSync(join(cleanupDir, 'scheduled'), lines('s', listing.scheduled))
    writeFileSync(join(cleanupDir, 'other'), lines('o', listing.other))
    // Answers the listing with the rows its jq filter selects; logs each delete.
    writeFileSync(
      join(cleanupDir, 'gh'),
      `#!/bin/bash
case "$*" in
  *DELETE*) echo "\${@: -1}" >> "${log}" ;;
  *'.event == "schedule"'*) cat "${cleanupDir}/scheduled"; echo ;;
  *) cat "${cleanupDir}/other"; echo ;;
esac
`,
    )
    chmodSync(join(cleanupDir, 'gh'), 0o755)
    execFileSync('bash', ['-e', '-c', stepScript], {
      env: { ...process.env, PATH: `${cleanupDir}${delimiter}${process.env.PATH}` },
      stdio: 'pipe',
    })
    const deleted = readFileSync(log, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((path) => path.split('/').pop() ?? '')
    rmSync(cleanupDir, { recursive: true, force: true })
    return deleted
  }

  it('removes the oldest runs past each limit, and only those', () => {
    const deleted = deletedRuns({ scheduled: 62, other: 33 })
    expect(deleted.sort()).toEqual(['o0', 'o1', 'o2', 's0', 's1'].sort())
  })

  it('never lets pushes push the scheduled runs out', () => {
    const deleted = deletedRuns({ scheduled: 5, other: 500 })
    expect(deleted.filter((id) => id.startsWith('s'))).toEqual([])
    expect(deleted).toHaveLength(470)
  })
})
