import { shell } from 'electron'
import { currentBuildIdentity } from './build-identity'

const NEW_ISSUE_URL = 'https://github.com/apinizer/testnizer/issues/new'

const PLATFORM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

export interface ReportIssueInfo {
  version: string
  build: string
  platform: string
  osVersion: string
  arch: string
}

/**
 * The form opens in the browser with only what names the build. Nothing from the
 * user's projects goes into the URL, and nothing is sent until they submit it.
 */
export function reportIssueUrl(info: ReportIssueInfo): string {
  const buildPart = info.build && info.build !== 'unknown' ? ` · Build ${info.build}` : ''
  const platform = PLATFORM_NAMES[info.platform] ?? info.platform
  const body = [
    '### What happened, or what do you need?',
    '',
    '',
    '### Steps to reproduce',
    '',
    '',
    '---',
    `Testnizer ${info.version}${buildPart} · ${platform} ${info.osVersion} ${info.arch}`,
  ].join('\n')
  return `${NEW_ISSUE_URL}?body=${encodeURIComponent(body)}`
}

export async function openReportIssue(): Promise<void> {
  await shell.openExternal(
    reportIssueUrl({
      ...currentBuildIdentity(),
      platform: process.platform,
      osVersion: process.getSystemVersion(),
      arch: process.arch,
    }),
  )
}
