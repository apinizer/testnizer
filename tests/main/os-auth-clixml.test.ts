/**
 * Windows OS-password verification used to surface PowerShell's CLIXML stream
 * verbatim — the failure read "Incorrect system password (#< CLIXML <Objs …>)".
 * `cleanPowerShellStderr` strips that envelope so any leaked stderr stays
 * human-readable. (The LogonUser/AccountManagement validation itself is
 * Windows-only and can't run here.)
 */
import { describe, it, expect } from 'vitest'
import { cleanPowerShellStderr } from '../../src/main/lib/os-auth'

describe('cleanPowerShellStderr (issue: Windows reset CLIXML leak)', () => {
  it('drops the CLIXML envelope PowerShell writes to stderr', () => {
    const raw =
      '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T>' +
      '<T>System.Object</T></TN></Obj></Objs>'
    expect(cleanPowerShellStderr(raw)).toBe('')
  })

  it('keeps a real error that precedes the CLIXML envelope', () => {
    const raw = 'Add-Type : Access denied\n#< CLIXML\n<Objs><Obj S="progress" /></Objs>'
    expect(cleanPowerShellStderr(raw)).toBe('Add-Type : Access denied')
  })

  it('passes plain stderr through untouched (trimmed)', () => {
    expect(cleanPowerShellStderr('  some plain error  ')).toBe('some plain error')
    expect(cleanPowerShellStderr('')).toBe('')
  })
})
