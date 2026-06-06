import { expect, type Locator } from '@playwright/test'

/** Auth pill active state — white label on accent background. */
export async function expectAuthTypeActive(btn: Locator): Promise<void> {
  await expect(btn).toHaveCSS('color', 'rgb(255, 255, 255)')
}

/** Scripts section pill active state — accent-light background (not transparent). */
export async function expectScriptsSectionActive(btn: Locator): Promise<void> {
  await expect(btn).not.toHaveCSS('background-color', /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/)
}
