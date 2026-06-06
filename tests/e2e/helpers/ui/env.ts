import { expect, type Page } from '@playwright/test'

export interface EnvVariableInput {
  key: string
  initialValue?: string
  currentValue?: string
  secret?: boolean
}

/** Open environment manager from footer. */
export async function openEnvModal(page: Page): Promise<void> {
  await page.getByTestId('footer-env').click()
  await expect(page.getByTestId('environment-modal')).toBeVisible({ timeout: 8_000 })
}

export async function closeEnvModal(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('environment-modal')).toBeHidden({ timeout: 5_000 })
}

/** Create a new environment and select it in the left pane. */
export async function createEnvironment(page: Page, name: string): Promise<void> {
  await page.getByTestId('env-new').click()
  const input = page.getByPlaceholder('Environment name')
  await input.fill(name)
  await input.press('Enter')
  const modal = page.getByTestId('environment-modal')
  await expect(modal.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 8_000 })
}

/** Select environment in modal left pane. */
export async function selectEnvironmentInModal(page: Page, name: string): Promise<void> {
  await page.getByTestId('environment-modal').getByRole('button', { name, exact: true }).click()
}

/** Switch environment modal to the Globals pane. */
export async function openGlobalsPane(page: Page): Promise<void> {
  await page.getByTestId('env-globals-nav').click()
  await expect(page.getByTestId('environment-modal').getByText('Globals').first()).toBeVisible({
    timeout: 5_000,
  })
}

/** Fill the last variable row in the active env/globals pane. */
export async function addVariable(page: Page, v: EnvVariableInput): Promise<void> {
  await page.getByTestId('env-var-add').click()
  const row = page.getByTestId('env-var-row').last()
  await row.getByTestId('env-var-key').fill(v.key)
  if (v.initialValue !== undefined) {
    await row.getByTestId('env-var-initial').fill(v.initialValue)
  }
  if (v.currentValue !== undefined) {
    await row.getByTestId('env-var-current').fill(v.currentValue)
  }
  if (v.secret) {
    await row.locator('select').selectOption('secret')
  }
}

/** Assert a variable row is marked secret in the environment modal. */
export async function expectSecretVariable(page: Page, key: string): Promise<void> {
  const row = page.getByTestId('env-var-row').filter({
    has: page.getByTestId('env-var-key').filter({ hasValue: key }),
  })
  await expect(row.locator('select')).toHaveValue('secret')
}

/** Switch active environment by name (footer shows selected env). */
export async function switchEnvironment(page: Page, name: string): Promise<void> {
  await openEnvModal(page)
  await selectEnvironmentInModal(page, name)
  await setActiveEnvironment(page)
  await closeEnvModal(page)
  await expect(page.getByTestId('footer-env')).toContainText(name, { timeout: 5_000 })
}

/** Click Set Active for the currently selected environment pane. */
export async function setActiveEnvironment(page: Page): Promise<void> {
  const btn = page.getByTestId('env-set-active')
  if (await btn.isVisible().catch(() => false)) {
    await btn.click()
    // Scope to the modal — the workbench can hold its own "Active" label.
    await expect(
      page.getByTestId('environment-modal').getByText('Active').first(),
    ).toBeVisible({ timeout: 5_000 })
  }
}

/** Full helper: open modal, create env, add vars, activate, close. */
export async function setupEnvironment(
  page: Page,
  name: string,
  variables: EnvVariableInput[],
): Promise<void> {
  await openEnvModal(page)
  await createEnvironment(page, name)
  for (const v of variables) {
    await addVariable(page, v)
  }
  await setActiveEnvironment(page)
  await closeEnvModal(page)
  await expect(page.getByTestId('footer-env')).toContainText(name, { timeout: 5_000 })
}
