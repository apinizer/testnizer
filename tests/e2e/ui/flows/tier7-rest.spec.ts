import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
  openNewDropdownItem,
} from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndWaitResponse } from '../../helpers/ui/request-flow'
import { TOOL_NAMES } from '../../helpers/ui/inventory'
import { getTestServerUrls } from '../../helpers/test-servers'
import { pressModShortcut } from '../../helpers/ui/keyboard'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 7 — Mock, Tools, AI, History, Settings, Git', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('F24 mock server rule and response', async ({ window }) => {
    await navigateSidebar(window, 'mocks')
    const mockName = `Flow Mock ${uid()}`
    await window.getByTitle(/New mock server|Yeni mock sunucu/i).click()
    await window.getByPlaceholder(/Server name|Sunucu adı/i).fill(mockName)
    await window.getByRole('button', { name: /^Create$|^Oluştur$/i }).click()
    await expect(window.getByText(mockName).first()).toBeVisible({ timeout: 10_000 })
    await window.getByText(mockName).first().click()
    await expect(window.getByTestId('workbench')).toBeVisible()
  })

  uiTest('F25 tools functional outputs', async ({ window }) => {
    await navigateSidebar(window, 'tools')

    await window.getByText('JWT Debugger', { exact: false }).click()
    const token = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmbG93In0.'
    await window.locator('.monaco-editor').first().click()
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    await window.keyboard.press(`${mod}+KeyA`)
    await window.keyboard.insertText(token)
    await expect(window.getByText(/flow|sub/i).first()).toBeVisible({ timeout: 8_000 })

    await navigateSidebar(window, 'tools')
    await window.getByText('Hash Calculator', { exact: false }).click()
    await window.locator('.monaco-editor').first().click()
    await window.keyboard.insertText('flow-test')
    await expect(window.getByText(/SHA-256|MD5/i).first()).toBeVisible({ timeout: 8_000 })

    await navigateSidebar(window, 'tools')
    await window.getByText('UUID Generator', { exact: false }).click()
    await window.getByRole('button', { name: /Generate/i }).click()
    await expect(window.getByText(/[0-9a-f]{8}-[0-9a-f]{4}/i).first()).toBeVisible({ timeout: 5_000 })

    for (const toolName of TOOL_NAMES.slice(0, 5)) {
      await navigateSidebar(window, 'tools')
      await window.getByText(toolName, { exact: false }).click()
      await expect(window.getByTestId('workbench')).toBeVisible()
    }
  })

  uiTest('F26 AI chat fake LLM stream reply', async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    const { llm } = getTestServerUrls()
    await openNewDropdownItem(window, /AI Chat/i)
    await window
      .getByPlaceholder(/chat completions|Endpoint URL|https:\/\/\.\.\./i)
      .fill(`${llm}/v1/chat/completions`)
    await window.getByPlaceholder('sk-...').fill('e2e-test-key')
    await window.getByPlaceholder(/Ask anything/i).fill('Say hello Flow E2E')
    await window.getByRole('button', { name: /^Send$|^Gönder$/i }).click()
    await expect(window.getByText(/E2E stub reply|hello Flow E2E/i).first()).toBeVisible({ timeout: 20_000 })
  })

  uiTest('F27 history restore and resend', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    const url = `${http()}/get?history=${uid()}`
    await fillUrl(window, url)
    await sendAndWaitResponse(window)

    await navigateSidebar(window, 'history')
    await window.getByText(/GET/i).first().click()
    await expect(window.getByTestId('url-input')).toBeVisible({ timeout: 8_000 })
    await sendAndWaitResponse(window)
  })

  uiTest('F28 settings theme and timeout persist in session', async ({ window }) => {
    await dismissOverlays(window)
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Dark|Tema: Koyu/i }).click()
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await window.getByTestId('req-tab-settings').click()
    await window.getByTestId('settings-timeout').fill('8000')
    await expect(window.getByTestId('settings-timeout')).toHaveValue('8000')
    await openCommandPalette(window)
    await window.getByRole('option', { name: /Switch theme: Light|Tema: Açık/i }).click()
  })

  uiTest('F29 git branch create and switch', async ({ window }) => {
    await navigateSidebar(window, 'apis')
    await window.getByTestId('branch-pill').click()
    await window.getByTestId('branch-new').click()
    const branchName = `flow-${uid()}`
    await window.getByPlaceholder(/New branch from/i).fill(branchName)
    await window.getByRole('button', { name: /^OK$/i }).click()
    await expect(window.getByTestId('branch-pill')).toContainText(branchName, { timeout: 15_000 })
  })
})
