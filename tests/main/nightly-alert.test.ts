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
