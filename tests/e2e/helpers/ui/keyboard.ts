import type { Page } from '@playwright/test'

/** Cmd on macOS, Ctrl elsewhere — matches Playwright Electron host. */
export function modKey(): 'Meta' | 'Control' {
  return process.platform === 'darwin' ? 'Meta' : 'Control'
}

function toPlaywrightKey(key: string): string {
  if (key === ',') return 'Comma'
  if (key === 'Enter') return 'Enter'
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`
  return key
}

export async function pressModShortcut(
  page: Page,
  key: string,
  opts?: { shift?: boolean; alt?: boolean },
): Promise<void> {
  const parts: string[] = []
  if (opts?.alt) parts.push('Alt')
  parts.push(modKey())
  if (opts?.shift) parts.push('Shift')
  parts.push(toPlaywrightKey(key))
  await page.keyboard.press(parts.join('+'))
}
