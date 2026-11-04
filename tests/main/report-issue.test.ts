/**
 * "Report an issue or request a feature" opens the new-issue form with only what
 * names the build, so a tester's report says which commit they tried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('electron', () => ({ shell: { openExternal } }))

import { openReportIssue, reportIssueUrl } from '../../src/main/lib/report-issue'

const INFO = {
  version: '1.6.0',
  build: '32d97f7',
  platform: 'darwin',
  osVersion: '15.5',
  arch: 'arm64',
}

function bodyOf(url: string): string {
  return new URL(url).searchParams.get('body') ?? ''
}

describe('report an issue link', () => {
  beforeEach(() => openExternal.mockClear())

  it('opens the repository new-issue form', () => {
    const url = new URL(reportIssueUrl(INFO))
    expect(url.origin + url.pathname).toBe('https://github.com/apinizer/testnizer/issues/new')
    expect([...url.searchParams.keys()]).toEqual(['body'])
  })

  it('names the version, build and system', () => {
    expect(bodyOf(reportIssueUrl(INFO))).toContain(
      'Testnizer 1.6.0 · Build 32d97f7 · macOS 15.5 arm64',
    )
  })

  it('leaves the build out when it is not known', () => {
    const body = bodyOf(reportIssueUrl({ ...INFO, build: 'unknown' }))
    expect(body).toContain('Testnizer 1.6.0 · macOS')
    expect(body).not.toContain('Build')
  })

  it.each([
    ['win32', 'Windows'],
    ['linux', 'Linux'],
  ])('uses a readable name for %s', (platform, name) => {
    expect(bodyOf(reportIssueUrl({ ...INFO, platform }))).toContain(`· ${name} 15.5 arm64`)
  })

  it('opens the running build in the browser', async () => {
    // Electron adds this to process; plain Node does not have it. e2e 61 runs the real one.
    Object.assign(process, { getSystemVersion: () => '15.5' })
    await openReportIssue()
    expect(openExternal).toHaveBeenCalledTimes(1)
    const [url] = openExternal.mock.calls[0] as unknown as [string]
    expect(bodyOf(url)).toContain(`15.5 ${process.arch}`)
  })
})
