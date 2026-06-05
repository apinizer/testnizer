/**
 * Build a clean environment for `electron.launch()`.
 *
 * Some shells / CI sandboxes export `ELECTRON_RUN_AS_NODE=1`, which makes the
 * Electron binary boot as plain Node.js. In that mode Chromium CLI flags that
 * Playwright passes (e.g. `--remote-debugging-port=0`) are rejected with
 * "bad option", so the launch fails before the app ever starts. Stripping the
 * variable guarantees the real Electron runtime starts regardless of the host
 * environment.
 *
 * By default E2E runs headless (`E2E_HEADLESS=1`) so windows do not pop up
 * over the developer's screen. Set `TESTNIZER_E2E_VISIBLE=1` to show windows
 * while debugging a failing spec.
 */
export function cleanLaunchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  const headless = process.env.TESTNIZER_E2E_VISIBLE !== '1'
  return {
    ...env,
    NODE_ENV: 'test',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ...(headless ? { E2E_HEADLESS: '1' } : {}),
    ...extra,
  }
}

/** Shared launch options for all Electron E2E fixtures. */
export function electronLaunchOptions(mainPath: string, userDataDir: string) {
  return {
    args: [mainPath, `--user-data-dir=${userDataDir}`],
    env: cleanLaunchEnv(),
  }
}
