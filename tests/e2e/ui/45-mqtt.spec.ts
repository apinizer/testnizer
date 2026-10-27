/**
 * Issue #284 — MQTT end to end against the local Aedes broker
 * (`tests/e2e/servers/mqtt-server.ts`, MQTT 3.1.1):
 *
 *   - connect, subscribe on connect, publish, the message comes back in the
 *     log (sent + received rows); a topic toggled while connected subscribes
 *     and unsubscribes at once; Disconnect;
 *   - the password never reaches localStorage, yet Ctrl+S saves it and a
 *     closed + reopened request still has it (from the saved row);
 *   - save → close → reopen keeps version, client id, topics and saved
 *     messages.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openNewDropdownItem } from '../helpers/ui/bootstrap'
import { getTestServerUrls } from '../helpers/test-servers'
import { fillMonaco } from '../helpers/ui/monaco'
import { pressModShortcut } from '../helpers/ui/keyboard'
import { treeOpenNode } from '../helpers/ui/tree'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function openMqtt(window: Page): Promise<void> {
  const { mqtt } = getTestServerUrls()
  await openNewDropdownItem(window, /MQTT/)
  await window.getByTestId('mqtt-url').fill(mqtt)
  // Aedes speaks MQTT 3.1.1 only.
  await window.getByTestId('mqtt-version').selectOption('4')
}

async function addTopic(window: Page, name: string): Promise<void> {
  await window.getByTestId('mqtt-tab-topics').click()
  await window.getByTestId('mqtt-topic-add').click()
  await window.getByTestId('mqtt-topic-name').last().fill(name)
}

async function connect(window: Page): Promise<void> {
  await window.getByTestId('mqtt-connect').click()
  await expect(window.getByTestId('mqtt-status')).toHaveAttribute('data-state', 'connected', {
    timeout: 15_000,
  })
}

async function saveAs(window: Page, name: string): Promise<void> {
  await pressModShortcut(window, 's')
  const modal = window.getByTestId('endpoint-save-modal')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await modal.locator('input').first().fill(name)
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
}

async function closeActiveTab(window: Page, name: string): Promise<void> {
  const tab = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
  await tab.hover()
  await tab.getByTestId('tab-close').click()
  await expect(window.getByTestId('endpoint-tab').filter({ hasText: name })).toHaveCount(0, {
    timeout: 8_000,
  })
}

const systemRow = (window: Page, text: RegExp) =>
  window.getByTestId('mqtt-system').filter({ hasText: text })

uiTest.describe('MQTT (#284)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('connect, subscribe, publish and receive; live subscribe toggle', async ({ window }) => {
    const topic = `e2e/${uid()}`
    await openMqtt(window)
    await addTopic(window, `${topic}/#`)
    await connect(window)
    await expect(systemRow(window, /Subscribed/)).toHaveCount(1, { timeout: 10_000 })

    await window.getByTestId('mqtt-tab-message').click()
    await window.getByTestId('mqtt-publish-topic').fill(`${topic}/a`)
    await fillMonaco(window, 'mqtt-composer', 'hello-mqtt')
    await window.getByTestId('mqtt-publish').click()
    await expect(
      window
        .locator('[data-testid="mqtt-message"][data-direction="sent"]')
        .filter({ hasText: 'hello-mqtt' }),
    ).toHaveCount(1, { timeout: 10_000 })
    await expect(
      window
        .locator('[data-testid="mqtt-message"][data-direction="received"]')
        .filter({ hasText: 'hello-mqtt' }),
    ).toHaveCount(1, { timeout: 10_000 })

    // A topic added while connected starts with Subscribe off (its name stays
    // editable); flipping the switch subscribes / unsubscribes at once.
    await addTopic(window, `${topic}-other`)
    const second = window.getByTestId('mqtt-topic-row').last()
    await expect(second.getByTestId('mqtt-topic-subscribe')).not.toBeChecked()
    await second.getByTestId('mqtt-topic-subscribe').check()
    await expect(systemRow(window, /Subscribed/).filter({ hasText: `${topic}-other` })).toHaveCount(
      1,
      { timeout: 10_000 },
    )
    await second.getByTestId('mqtt-topic-subscribe').uncheck()
    await expect(systemRow(window, /Unsubscribed/)).toHaveCount(1, { timeout: 10_000 })

    await window.getByTestId('mqtt-connect').click()
    await expect(window.getByTestId('mqtt-status')).toHaveAttribute('data-state', 'disconnected', {
      timeout: 10_000,
    })
  })

  uiTest(
    'the password stays out of localStorage but is saved with the request',
    async ({ window }) => {
      const name = `MQTT-Auth-${uid()}`
      const secret = `pw-${uid()}`
      await openMqtt(window)
      await window.getByTestId('mqtt-tab-auth').click()
      await window.getByTestId('mqtt-username').fill('device-1')
      await window.getByTestId('mqtt-password').fill(secret)
      await saveAs(window, name)

      // The tab-state snapshot is written on change; give it a beat, then look.
      await window.waitForTimeout(500)
      const stored = await window.evaluate(() => {
        const out: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k) out.push(localStorage.getItem(k) ?? '')
        }
        return out.join('\n')
      })
      expect(stored).toContain('device-1')
      expect(stored).not.toContain(secret)

      await closeActiveTab(window, name)
      await treeOpenNode(window, name)
      await window.getByTestId('mqtt-tab-auth').click()
      await expect(window.getByTestId('mqtt-username')).toHaveValue('device-1', { timeout: 10_000 })
      await expect(window.getByTestId('mqtt-password')).toHaveValue(secret)
    },
  )

  uiTest(
    'save → close → reopen keeps version, client id, topics and saved messages',
    async ({ window }) => {
      const name = `MQTT-Parity-${uid()}`
      const clientId = `cid-${uid()}`
      await openMqtt(window)
      await window.getByTestId('mqtt-client-id').fill(clientId)
      await addTopic(window, 'sensors/+/temp')
      await window.getByTestId('mqtt-tab-message').click()
      await window.getByTestId('mqtt-publish-topic').fill('sensors/1/temp')
      await fillMonaco(window, 'mqtt-composer', '21.5')
      await window.getByTestId('mqtt-save-message').click()
      await expect(window.getByTestId('mqtt-saved-item')).toHaveCount(1)

      await saveAs(window, name)
      await closeActiveTab(window, name)
      await treeOpenNode(window, name)

      await expect(window.getByTestId('mqtt-saved-item')).toHaveCount(1, { timeout: 10_000 })
      await expect(window.getByTestId('mqtt-version')).toHaveValue('4')
      await expect(window.getByTestId('mqtt-client-id')).toHaveValue(clientId)
      await window.getByTestId('mqtt-tab-topics').click()
      await expect(window.getByTestId('mqtt-topic-name')).toHaveValue('sensors/+/temp')
    },
  )
})
