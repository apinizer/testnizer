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
function verifyWindows(username: string, password: string): Promise<OsAuthResult> {
  return new Promise((resolve) => {
    // Validate via System.DirectoryServices.AccountManagement. Try the
    // local machine first, then fall back to domain for joined machines.
    // Credentials are passed through env vars so they don't appear in the
    // command line seen by other processes.
    const script = [
      `Add-Type -AssemblyName System.DirectoryServices.AccountManagement`,
      `$user = $env:APINIZER_OS_USER`,
      `$pw = $env:APINIZER_OS_PW`,
      `try { $m = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Machine'); if ($m.ValidateCredentials($user, $pw)) { exit 0 } } catch { }`,
      `try { $d = New-Object System.DirectoryServices.AccountManagement.PrincipalContext('Domain'); if ($d.ValidateCredentials($user, $pw)) { exit 0 } } catch { }`,
      `exit 1`,
    ].join('; ')
    // PowerShell requires UTF-16LE base64 for -EncodedCommand.
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, APINIZER_OS_USER: username, APINIZER_OS_PW: password },
      },
    )
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
          error:
            'Incorrect system password' +
            (stderr.trim() ? ` (${stderr.trim().slice(0, 200)})` : ''),
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
