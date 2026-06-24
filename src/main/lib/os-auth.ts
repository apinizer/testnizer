// Verifies the current OS user's password against the operating system.
// Used as the offline recovery mechanism when the user forgets their app
// password. No data leaves the machine; each platform delegates to a
// built-in authentication helper.
//
//   macOS  → dscl . -authonly <user> <password>    (Directory Service)
//   Linux  → unix_chkpwd <user> nullok             (PAM helper, setuid)
//   Windows→ PrincipalContext.ValidateCredentials  (local + domain fallback)

import { spawn } from 'child_process'
import os from 'os'
import { existsSync } from 'fs'

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

function verifyWindows(username: string, password: string): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    // Credentials ride env vars so they never appear in the process command
    // line visible to other users. The verdict is printed as TZ_OK / TZ_FAIL.
    const script = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
$u = $env:TESTNIZER_OS_USER
$p = $env:TESTNIZER_OS_PW
try {
  $sig = @'
[DllImport("advapi32.dll", SetLastError=true)]
public static extern bool LogonUser(string user, string domain, string password, int type, int provider, out System.IntPtr token);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool CloseHandle(System.IntPtr handle);
'@
  $api = Add-Type -MemberDefinition $sig -Name 'TZLogon' -Namespace 'TZ' -PassThru
  $tok = [System.IntPtr]::Zero
  # LOGON32_LOGON_NETWORK = 3, LOGON32_PROVIDER_DEFAULT = 0; domain '.' = local SAM
  if ($api::LogonUser($u, '.', $p, 3, 0, [ref]$tok)) { [void]$api::CloseHandle($tok); Write-Output 'TZ_OK'; exit 0 }
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
Write-Output 'TZ_FAIL'
exit 1
`
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
      resolve({
        ok: false,
        error: 'Incorrect system password' + (detail ? ` (${detail.slice(0, 200)})` : ''),
      })
    })
  })
}

// ─── Linux ────────────────────────────────────────────────────────
function verifyLinux(username: string, password: string): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    // unix_chkpwd is the setuid PAM helper that ships with libpam. It
    // reads the password (NUL-terminated) from stdin and exits 0 on match.
    // When invoked by an unprivileged user it only authenticates that
    // user's own account, which is exactly what we want.
    const candidates = ['/usr/sbin/unix_chkpwd', '/sbin/unix_chkpwd', '/usr/libexec/unix_chkpwd']
    const bin = candidates.find((p) => existsSync(p))
    if (!bin) {
      resolve({
        ok: false,
        error: 'System password helper (unix_chkpwd) was not found on this machine',
      })
      return
    }
    const proc = spawn(bin, [username, 'nullok'], {
      stdio: ['pipe', 'pipe', 'pipe'],
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
    // Write password followed by a NUL terminator, as expected by unix_chkpwd.
    proc.stdin.write(password + '\0')
    proc.stdin.end()
  })
}
