// Renderer-side platform detection. Prefers `navigator.userAgentData`
// (modern, non-deprecated) and falls back to userAgent parsing. Used by
// keyboard-shortcuts and command-registry to pick Cmd vs Ctrl labels.

interface NavigatorUAData {
  platform: string
}

interface NavigatorWithUAData extends Navigator {
  userAgentData?: NavigatorUAData
}

export function isMac(): boolean {
  const nav = navigator as NavigatorWithUAData
  const platform = nav.userAgentData?.platform ?? ''
  if (platform) return /mac/i.test(platform)
  return /mac/i.test(navigator.userAgent)
}

export function modKeyLabel(): string {
  return isMac() ? 'Cmd' : 'Ctrl'
}
