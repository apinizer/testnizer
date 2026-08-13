/**
 * Issue #82 — "Şifre Sıfırlama": a domain (Active Directory) account always
 * failed OS-password verification. The script only tried domain '.' (local
 * SAM) via LogonUser plus the two ValidateCredentials contexts; the Domain
 * context throws when no DC is reachable, so a laptop off the corporate
 * network/VPN reported "incorrect password" for a password Windows itself
 * accepts through its credential cache.
 *
 * The LogonUser calls only run on Windows — what CAN be pinned here is the
 * attempt chain inside the generated PowerShell program, so a refactor cannot
 * silently drop an AD fallback again. Real AD verification is on the issue
 * reporter's machine (stated in the issue comment).
 */
import { describe, it, expect } from 'vitest'
import { buildWindowsAuthScript } from '../../src/main/lib/os-auth'

describe('Windows OS-auth script — Active Directory chain (issue #82)', () => {
  const script = buildWindowsAuthScript()

  it('still tries the local SAM first (domain ".", NETWORK logon)', () => {
    expect(script).toContain("LogonUser($u, '.', $p, 3, 0")
  })

  it("tries the account's real domain: NETWORK, INTERACTIVE, then CACHED_INTERACTIVE", () => {
    expect(script).toContain('LogonUser($u, $env:USERDOMAIN, $p, 3, 0')
    expect(script).toContain('LogonUser($u, $env:USERDOMAIN, $p, 2, 0')
    // 11 = LOGON32_LOGON_CACHED_INTERACTIVE — validates against the local
    // credential cache when the DC is unreachable (the VPN-off case).
    expect(script).toContain('LogonUser($u, $env:USERDOMAIN, $p, 11, 0')
  })

  it('guards the domain attempts to actually domain-joined machines', () => {
    expect(script).toContain('($env:USERDOMAIN) -and ($env:USERDOMAIN -ne $env:COMPUTERNAME)')
  })

  it('falls back to the UPN form when USERDNSDOMAIN is set', () => {
    expect(script).toContain('LogonUser("$u@$env:USERDNSDOMAIN", $null, $p, 3, 0')
  })

  it('keeps both ValidateCredentials fallbacks (Machine, then Domain)', () => {
    expect(script).toContain("PrincipalContext('Machine')")
    expect(script).toContain("PrincipalContext('Domain')")
  })

  it('reports a domain-joined failure distinctly so the caller can hint at DC reachability', () => {
    expect(script).toContain('TZ_FAIL_DOMAIN')
    // The plain marker must survive too — non-domain machines keep the old verdict.
    expect(script).toMatch(/Write-Output 'TZ_FAIL'/)
  })
})
