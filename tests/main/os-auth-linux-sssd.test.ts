/**
 * Issue #82, Linux leg — a domain (Active Directory / SSSD) account always
 * failed OS-password verification on Ubuntu.
 *
 * Verification went through `unix_chkpwd`, which is `pam_unix`'s helper and
 * nothing more: it reads `/etc/shadow`. On a machine joined with
 * `realm join` (SSSD, the Ubuntu default — the reporter is on 24.04) the
 * account is not in `/etc/shadow` at all, so a correct domain password came
 * back as "Incorrect system password". Same shape as the Windows leg, where
 * verification only ever tried local accounts.
 *
 * Verification now falls back to the FULL PAM stack — `pam_sss` included, so
 * domain accounts and SSSD's offline cache both count. Spawning `su` cannot
 * be exercised on this runner, so what is pinned here are the decisions that
 * surround it: who counts as a local account, and what each failure means.
 * The end-to-end check is on the reporter's machine, as with the Windows leg.
 */
import { describe, it, expect } from 'vitest'
import { isLocalAccount, classifySuResult, noLinuxHelperError } from '../../src/main/lib/os-auth'

const PASSWD = [
  'root:x:0:0:root:/root:/bin/bash',
  'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  'mhy:x:1000:1000:Local User:/home/mhy:/bin/bash',
  '',
].join('\n')

describe('telling a local account from a directory one', () => {
  it('recognises an account that is in /etc/passwd', () => {
    expect(isLocalAccount(PASSWD, 'mhy')).toBe(true)
  })

  it('does not recognise a domain account, which is the reported case', () => {
    // An SSSD account is resolvable through NSS but is not a line in the file,
    // which is exactly why unix_chkpwd could never authenticate it.
    expect(isLocalAccount(PASSWD, 'ncetinkaya')).toBe(false)
  })

  it('matches the login name only, not the comment or home directory', () => {
    // "Local User" and "/home/mhy" both contain text that a substring match
    // would trip over.
    expect(isLocalAccount(PASSWD, 'Local User')).toBe(false)
    expect(isLocalAccount(PASSWD, 'home')).toBe(false)
  })

  it('treats an unreadable /etc/passwd as "not local" rather than crashing', () => {
    expect(isLocalAccount('', 'mhy')).toBe(false)
  })
})

describe('what a PAM check result means', () => {
  it('accepts a clean exit that was actually authenticated', () => {
    expect(classifySuResult(0, 'Password: ')).toEqual({ ok: true })
  })

  it('refuses a clean exit when su never asked for a password', () => {
    // pam_wheel with the `trust` option grants su to wheel members WITHOUT
    // authenticating. This function decides who may reset the app password, so
    // a bare exit 0 there would accept literally any input.
    const r = classifySuResult(0, '')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/without asking for a password/i)
  })

  it('recognises the prompt wherever it lands in the output', () => {
    expect(classifySuResult(0, 'some pty noise\r\nPassword:').ok).toBe(true)
  })

  it('reports a wrong password plainly', () => {
    expect(classifySuResult(1, 'Password: \r\nsu: Authentication failure')).toEqual({
      ok: false,
      error: 'Incorrect system password',
    })
  })

  it('does not blame the password when su itself is restricted', () => {
    // pam_wheel refusing su is not "you typed it wrong"; telling the user it
    // was would send them to reset a password that is fine.
    const r = classifySuResult(1, 'su: Permission denied')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/does not allow password verification/i)
    expect(r.error).not.toMatch(/^Incorrect system password$/)
  })

  it('names an unreachable domain controller', () => {
    const r = classifySuResult(1, 'pam_sss(su:auth): Cannot contact any KDC / offline')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/domain controller/i)
    expect(r.error).toMatch(/VPN/i)
  })

  it('treats a killed process (timeout) as a failure, not a pass', () => {
    expect(classifySuResult(null, '').ok).toBe(false)
  })
})

describe('when the machine can verify nothing at all', () => {
  it('mentions only the missing helper for a local account', () => {
    expect(noLinuxHelperError(true)).toMatch(/unix_chkpwd/)
  })

  it('says the account is directory-managed when it is', () => {
    // Without this the user reads "wrong password" about a correct one.
    const msg = noLinuxHelperError(false)
    expect(msg).toMatch(/directory service/i)
    expect(msg).toMatch(/SSSD/)
  })
})
