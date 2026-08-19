// Verifies the current OS user's password against the operating system.
// Used as the offline recovery mechanism when the user forgets their app
// password. No data leaves the machine; each platform delegates to a
// built-in authentication helper.
//
//   macOS  → dscl . -authonly <user> <password>    (Directory Service)
//   Linux  → unix_chkpwd, then the full PAM stack   (issue #82)
//   Windows→ PrincipalContext.ValidateCredentials  (local + domain fallback)

import { spawn } from 'child_process'
import os from 'os'
import { existsSync, readFileSync } from 'fs'

export interface OsAuthResult {
  ok: boolean
  error?: string
}

export async function verifyOsPassword(password: string): Promise<OsAuthResult> {
  if (!password) return { ok: false, error: 'System password is required' }

  let username = ''
  try {
    username = os.userInfo().username
  } catch (e) {
    return { ok: false, error: `Could not determine OS user: ${(e as Error).message}` }
  }
  if (!username) return { ok: false, error: 'Could not determine OS user' }

  switch (process.platform) {
    case 'darwin':
      return verifyMacOs(username, password)
    case 'win32':
      return verifyWindows(username, password)
    case 'linux':
      return verifyLinux(username, password)
    default:
      return { ok: false, error: `Unsupported platform: ${process.platform}` }
  }
}

// ─── macOS ────────────────────────────────────────────────────────
function verifyMacOs(username: string, password: string): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    // `dscl . -authonly <user> <password>` exits 0 on success, 1 on failure.
    // Password is passed via argv — this process is short-lived and only
    // visible to the current user in `ps`, so exposure is minimal.
    const proc = spawn('dscl', ['.', '-authonly', username, password], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
    proc.on('close', (code) => {
      if (code === 0) resolve({ ok: true })
      else
        resolve({
          ok: false,
          error: 'Incorrect system password' + (stderr.trim() ? ` (${stderr.trim()})` : ''),
        })
    })
  })
}

// ─── Windows ──────────────────────────────────────────────────────
// PowerShell serialises its progress/error streams to stderr as CLIXML
// (`#< CLIXML …`). With ProgressPreference loud, even `Add-Type` emits a
// progress object, so the old code's failure message read
// "Incorrect system password (#< CLIXML <Objs …>)" — noise that also masked
// the real problem: `ValidateCredentials` returns false for many local
// accounts. We now validate primarily via the Win32 `LogonUser` API (the
// canonical local-SAM check), keep AccountManagement as a domain/Azure-AD
// fallback, silence the progress stream, and signal the verdict on stdout so a
// host-quirk exit code can't be misread. CLIXML is stripped from any leak.
export function cleanPowerShellStderr(raw: string): string {
  // Drop the CLIXML envelope PowerShell writes when stderr is redirected.
  const i = raw.indexOf('#< CLIXML')
  return (i >= 0 ? raw.slice(0, i) : raw).trim()
}

/**
 * The PowerShell verification program, exported for tests (the LogonUser /
 * AccountManagement calls themselves only run on Windows).
 *
 * Attempt chain — ordered local-first, then Active Directory (issue #82: a
 * domain account always failed because only `domain '.'` = local SAM and the
 * two ValidateCredentials contexts were tried; the Domain context throws when
 * the DC is unreachable, so a laptop off the corporate network/VPN reported
 * "incorrect password" for a password Windows itself accepts via its cache):
 *
 *   1. LogonUser  '.'          NETWORK(3)   — local account
 *   2. LogonUser  USERDOMAIN   NETWORK(3)   — AD account, DC reachable
 *   3. LogonUser  USERDOMAIN   INTERACTIVE(2) — AD policies that reject NETWORK
 *   4. LogonUser  USERDOMAIN   CACHED_INTERACTIVE(11) — DC unreachable; checks
 *      the same cached verifier the Windows lock screen uses
 *   5. LogonUser  UPN (user@USERDNSDOMAIN)  NETWORK(3)
 *   6. PrincipalContext Machine → Domain ValidateCredentials (legacy fallback)
 *
 * A failure on a domain-joined machine prints TZ_FAIL_DOMAIN so the caller can
 * say "DC may be unreachable" instead of only "incorrect password".
 */
export function buildWindowsAuthScript(): string {
  return `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$u = $env:TESTNIZER_OS_USER
$p = $env:TESTNIZER_OS_PW
$domainJoined = ($env:USERDOMAIN) -and ($env:USERDOMAIN -ne $env:COMPUTERNAME)
try {
  $sig = @'
[DllImport("advapi32.dll", SetLastError=true)]
public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out System.IntPtr token);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool CloseHandle(System.IntPtr handle);
'@
  $api = Add-Type -MemberDefinition $sig -Name 'TZLogon' -Namespace 'TZ' -PassThru
  $tok = [System.IntPtr]::Zero
  $ok = $false
  # LOGON32_LOGON_NETWORK = 3, LOGON32_PROVIDER_DEFAULT = 0; domain '.' = local SAM
  if ($api::LogonUser($u, '.', $p, 3, 0, [ref]$tok)) { $ok = $true }
  # Active Directory (issue #82): the account's real domain. INTERACTIVE(2)
  # covers policies that refuse NETWORK; CACHED_INTERACTIVE(11) validates
  # against the local credential cache when no domain controller is reachable.
  if (-not $ok -and $domainJoined) {
    if ($api::LogonUser($u, $env:USERDOMAIN, $p, 3, 0, [ref]$tok)) { $ok = $true }
    elseif ($api::LogonUser($u, $env:USERDOMAIN, $p, 2, 0, [ref]$tok)) { $ok = $true }
    elseif ($api::LogonUser($u, $env:USERDOMAIN, $p, 11, 0, [ref]$tok)) { $ok = $true }
  }
  if (-not $ok -and $env:USERDNSDOMAIN) {
    if ($api::LogonUser("$u@$env:USERDNSDOMAIN", $null, $p, 3, 0, [ref]$tok)) { $ok = $true }
  }
  if ($ok) { [void]$api::CloseHandle($tok); Write-Output 'TZ_OK'; exit 0 }
} catch { }
try {
  Add-Type -AssemblyName System.DirectoryServices.AccountManagement
  $m = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Machine')
  if ($m.ValidateCredentials($u, $p)) { Write-Output 'TZ_OK'; exit 0 }
} catch { }
try {
  $d = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Domain')
  if ($d.ValidateCredentials($u, $p)) { Write-Output 'TZ_OK'; exit 0 }
} catch { }
if ($domainJoined) { Write-Output 'TZ_FAIL_DOMAIN' } else { Write-Output 'TZ_FAIL' }
exit 1
`
}

function verifyWindows(username: string, password: string): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    // Credentials ride env vars so they never appear in the process command
    // line visible to other users. The verdict is printed as TZ_OK / TZ_FAIL /
    // TZ_FAIL_DOMAIN.
    const script = buildWindowsAuthScript()
    // PowerShell requires UTF-16LE base64 for -EncodedCommand.
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TESTNIZER_OS_USER: username, TESTNIZER_OS_PW: password },
      },
    )
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => resolve({ ok: false, error: err.message }))
    proc.on('close', (code) => {
      // Trust the explicit stdout token first; fall back to the exit code.
      if (stdout.includes('TZ_OK') || (code === 0 && !stdout.includes('TZ_FAIL'))) {
        resolve({ ok: true })
        return
      }
      const detail = cleanPowerShellStderr(stderr)
      // Domain-joined machine: "wrong password" is not the only explanation —
      // every cached/online AD attempt failed, which also happens when the
      // account can't be validated locally and no DC answers (issue #82).
      const domainHint = stdout.includes('TZ_FAIL_DOMAIN')
        ? ' — if your domain (Active Directory) password is correct, the domain controller may be unreachable; connect to the corporate network or VPN and try again'
        : ''
      resolve({
        ok: false,
        error:
          'Incorrect system password' + domainHint + (detail ? ` (${detail.slice(0, 200)})` : ''),
      })
    })
  })
}

// ─── Linux ────────────────────────────────────────────────────────
/*
 * Issue #82, Linux leg.
 *
 * `unix_chkpwd` is `pam_unix`'s helper and nothing more: it reads
 * `/etc/shadow`. On a machine joined to Active Directory through SSSD (the
 * `realm join` default on Ubuntu) the user's account is not in `/etc/shadow`
 * at all, so a perfectly correct domain password came back as "Incorrect
 * system password" — the same shape of defect the Windows leg had, where
 * verification only ever tried local accounts.
 *
 * The fix is to consult the FULL PAM stack, which is what actually decides
 * whether a password is valid on that machine: `pam_unix` for local accounts,
 * `pam_sss` for domain ones, including SSSD's offline credential cache when
 * the domain controller is unreachable.
 *
 * There is no PAM binding here (a native module for one call is not worth its
 * rebuild-per-ABI cost), so the stack is reached through `su`, which is the
 * canonical PAM consumer present on every distribution. `su` insists on a
 * terminal for the prompt, hence `script`, whose only job is to allocate one.
 *
 * `unix_chkpwd` still runs FIRST and unchanged: local accounts keep the exact
 * path they had, so this cannot regress the case that already worked, and the
 * slower fallback only runs once the fast one has said no.
 */

/** Local-account check: `/etc/passwd` holds exactly the accounts pam_unix knows. */
export function isLocalAccount(passwdFile: string, username: string): boolean {
  return passwdFile.split('\n').some((line) => line.split(':')[0] === username)
}

/** `su` asks for the password with this, under LC_ALL=C. */
export const SU_PROMPT = /password\s*:/i

/**
 * Turn `su`'s exit code into a verdict.
 *
 * Only exit 0 is a pass — AND only when `su` actually asked for a password.
 * That second half is not paranoia: `pam_wheel` with the `trust` option grants
 * `su` to members of the wheel group WITHOUT authenticating, and this function
 * decides whether someone may reset the app password. Accepting a bare exit 0
 * would accept literally any input on such a machine. If no prompt was seen,
 * the run proves nothing and must not be read as proof.
 *
 * Everything else is a failure, but the reason matters to the user: `su`
 * restricted by `pam_wheel`, and a domain controller that cannot be reached,
 * are not "you typed it wrong" — telling the user it was would send them to
 * reset a password that is fine.
 */
export function classifySuResult(code: number | null, output: string): OsAuthResult {
  if (code === 0) {
    if (SU_PROMPT.test(output)) return { ok: true }
    return {
      ok: false,
      error:
        'This machine grants su without asking for a password, so it cannot be used to ' +
        'verify yours. Reset the app password from another machine, or ask your administrator.',
    }
  }
  const text = output.toLowerCase()
  if (text.includes('permission denied') || text.includes('pam_wheel')) {
    return {
      ok: false,
      error:
        'This machine does not allow password verification for your account (su is restricted). ' +
        'Reset the app password from another machine, or ask your administrator.',
    }
  }
  if (
    text.includes('cannot contact') ||
    text.includes('offline') ||
    text.includes('server not found') ||
    text.includes('no logon servers')
  ) {
    return {
      ok: false,
      error:
        'Could not reach the domain controller to verify your password. ' +
        'Connect to the corporate network or VPN and try again.',
    }
  }
  return { ok: false, error: 'Incorrect system password' }
}

/** Message for the case where nothing on this machine can verify a password. */
export function noLinuxHelperError(local: boolean): string {
  return local
    ? 'System password helper (unix_chkpwd) was not found on this machine'
    : // A directory account with no way to reach PAM is worth naming precisely:
      // the user would otherwise read "wrong password" about a correct one.
      'Your account is managed by a directory service (e.g. Active Directory via SSSD), ' +
        'and this machine has no helper available to verify its password ' +
        '(neither unix_chkpwd nor su/script). Reset the app password from another machine.'
}

function readPasswdFile(): string {
  try {
    return readFileSync('/etc/passwd', 'utf8')
  } catch {
    return ''
  }
}

const UNIX_CHKPWD = ['/usr/sbin/unix_chkpwd', '/sbin/unix_chkpwd', '/usr/libexec/unix_chkpwd']
const SCRIPT_BIN = ['/usr/bin/script', '/bin/script']
const SU_BIN = ['/bin/su', '/usr/bin/su']

function verifyLinuxChkpwd(bin: string, username: string, password: string): Promise<boolean> {
  return new Promise((resolve) => {
    // unix_chkpwd reads the password (NUL-terminated) from stdin and exits 0
    // on match. Invoked unprivileged it only authenticates the caller's own
    // account, which is exactly what we want.
    const proc = spawn(bin, [username, 'nullok'], { stdio: ['pipe', 'pipe', 'pipe'] })
    proc.on('error', () => resolve(false))
    proc.on('close', (code) => resolve(code === 0))
    proc.stdin.write(password + '\0')
    proc.stdin.end()
  })
}

/**
 * Ask PAM, through `su`, whether this password authenticates the user.
 *
 * `script -q -e -c "su <user> -c true" /dev/null` gives `su` the terminal it
 * demands and passes its exit status back out (`-e`). The password goes to the
 * pty on stdin. Nothing is echoed and nothing is logged by us.
 */
function verifyLinuxPam(
  scriptBin: string,
  suBin: string,
  username: string,
  password: string,
): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    const proc = spawn(scriptBin, ['-q', '-e', '-c', `${suBin} ${username} -c true`, '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // A failed PAM authentication sleeps (pam_faildelay, ~2s by default);
      // the cap keeps a hung prompt from hanging the recovery dialog forever.
      timeout: 20_000,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    })
    let output = ''
    const collect = (d: Buffer): void => {
      output += d.toString()
    }
    /*
     * Wait for the prompt before answering it.
     *
     * A pty echoes what it receives until the reader turns echo off, and
     * `su` only does that once it starts reading. Writing the password before
     * then would echo it straight back into `output` — which is scanned, and
     * which nothing should ever have to be careful about holding. LC_ALL=C is
     * set precisely so the prompt is not localised and can be waited for.
     *
     * The fallback write covers a `su` that prompts differently: better a
     * verification that still works than one that hangs. `classifySuResult`
     * refuses to read exit 0 as a pass when no prompt was seen either way, so
     * the fallback cannot turn into a bypass.
     */
    let answered = false
    const answer = (): void => {
      if (answered) return
      answered = true
      proc.stdin.write(password + '\n')
      proc.stdin.end()
    }
    const fallback = setTimeout(answer, 3_000)
    proc.stdout.on('data', (d: Buffer) => {
      collect(d)
      if (SU_PROMPT.test(output)) answer()
    })
    proc.stderr.on('data', (d: Buffer) => {
      collect(d)
      if (SU_PROMPT.test(output)) answer()
    })
    proc.on('error', (err) => {
      clearTimeout(fallback)
      resolve({ ok: false, error: err.message })
    })
    proc.on('close', (code) => {
      clearTimeout(fallback)
      resolve(classifySuResult(code, output))
    })
  })
}

async function verifyLinux(username: string, password: string): Promise<OsAuthResult> {
  const local = isLocalAccount(readPasswdFile(), username)

  const chkpwd = UNIX_CHKPWD.find((p) => existsSync(p))
  if (chkpwd && (await verifyLinuxChkpwd(chkpwd, username, password))) return { ok: true }

  // Running as root, `su` does not authenticate at all — it just switches.
  // Treating its exit 0 as a verified password would accept ANY input.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const scriptBin = SCRIPT_BIN.find((p) => existsSync(p))
  const suBin = SU_BIN.find((p) => existsSync(p))
  if (isRoot || !scriptBin || !suBin) {
    if (chkpwd) {
      return {
        ok: false,
        error: local
          ? 'Incorrect system password'
          : // The account is not in /etc/passwd, so unix_chkpwd could never
            // have authenticated it however correct the password was.
            'Incorrect system password, or your directory account could not be verified on this machine.',
      }
    }
    return { ok: false, error: noLinuxHelperError(local) }
  }

  return verifyLinuxPam(scriptBin, suBin, username, password)
}
