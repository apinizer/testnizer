/**
 * MST-218 — Preload bridge api surface smoke
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'

const REQUIRED = [
  'request',
  'settings',
  'workspace',
  'project',
  'savedRequest',
  'environment',
  'importExport',
  'history',
  'certificate',
  'mock',
  'branch',
  'scheduler',
  'testSuite',
  'app',
] as const

uiTest.describe('Tur1 — Shell preload bridge [MST-218]', () => {
  uiTest('MST-218 window.api exposes required IPC namespaces', async ({ window }) => {
    const keys = await window.evaluate(() => Object.keys((window as Window & { api?: object }).api ?? {}).sort())
    for (const ns of REQUIRED) {
      expect(keys).toContain(ns)
    }
  })
})
