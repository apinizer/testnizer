/**
 * Node's `process.platform` id → the product name a user knows ("darwin" →
 * "macOS"). Product names, so no translation. An unknown id is shown as is.
 */
const PLATFORM_NAMES: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

export function platformLabel(platform: string | undefined): string | undefined {
  if (!platform) return undefined
  return PLATFORM_NAMES[platform] ?? platform
}
