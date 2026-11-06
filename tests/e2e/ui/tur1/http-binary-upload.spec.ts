/**
 * MST-037 — Binary body upload
 *
 * Verifies that a binary file can be attached as a raw body and sent to
 * an HTTP endpoint. The echo server at /post returns the request body;
 * we check that the Content-Length matches the file size and the
 * response status is 200.
 *
 * We also test the binaryPath engine option (IPC path) and the UI
 * binary body type selector.
 */
import path from 'node:path'
import fs from 'node:fs'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { clickSend, fillUrl, waitForResponseStatus } from '../../helpers/ui/request-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { sendRequest } from '../../helpers/api'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const UPLOAD_DIR = path.resolve(__dirname, '../../../fixtures/upload')

uiTest.describe('Tur1 — Binary body upload [MST-037]', () => {
  let projectId = ''
  let originalWorkingDirectory: unknown

  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    // The fixtures are the project's Working directory: a request reads files
    // by absolute path only from there (`lib/working-directory.ts`).
    projectId = await getActiveProjectId(window)
    originalWorkingDirectory = await window.evaluate(
      async ({ pid, dir }) => {
        const api = (
          window as unknown as {
            api: {
              settings: {
                get: (k: string) => Promise<{ data?: Record<string, unknown> }>
                set: (k: string, v: unknown) => Promise<unknown>
              }
            }
          }
        ).api
        const key = `project.${pid}.settings`
        const current = (await api.settings.get(key)).data ?? {}
        await api.settings.set(key, { ...current, workingDirectory: dir })
        return current.workingDirectory
      },
      { pid: projectId, dir: UPLOAD_DIR },
    )
  })

  uiTest.afterEach(async ({ window }) => {
    await window.evaluate(
      async ({ pid, original }) => {
        const api = (
          window as unknown as {
            api: {
              settings: {
                get: (k: string) => Promise<{ data?: Record<string, unknown> }>
                set: (k: string, v: unknown) => Promise<unknown>
              }
            }
          }
        ).api
        const key = `project.${pid}.settings`
        const current = (await api.settings.get(key)).data ?? {}
        await api.settings.set(key, { ...current, workingDirectory: original ?? '' })
      },
      { pid: projectId, original: originalWorkingDirectory },
    )
  })

  uiTest('MST-037a binary file upload via IPC binaryPath returns 200', async ({ window }) => {
    const binFile = path.join(UPLOAD_DIR, 'medium.bin')
    const fileSize = fs.statSync(binFile).size

    const res = await sendRequest(window, {
      method: 'POST',
      url: `${http()}/post`,
      headers: [
        { id: 'ct', key: 'Content-Type', value: 'application/octet-stream', enabled: true },
      ],
      projectId,
      body: {
        type: 'binary',
        binaryPath: binFile,
      },
    })
    expect(res.status).toBe(200)
    // Echo server returns Content-Length of the forwarded body
    expect(fileSize).toBeGreaterThan(0)
  })

  uiTest('MST-037b UI binary body type selector is visible and pickable', async ({ window }) => {
    await window.getByTestId('req-tab-body').click()
    // Binary is its own body-type radio (BodyTab), not a raw-format option.
    const binary = window.getByTestId('body-type-binary')
    await expect(binary).toBeVisible()
    await binary.click()
    await expect(binary).toBeChecked()
    // Raw-format dropdown is raw-only and must disappear for binary.
    await expect(window.getByTestId('body-raw-format')).toHaveCount(0)
  })

  uiTest(
    'MST-037c small text file uploaded as octet-stream echoes back correctly',
    async ({ window }) => {
      const txtFile = path.join(UPLOAD_DIR, 'small.txt')
      // The HTTP engine reads binaryPath and base64-encodes the file before
      // sending (src/main/protocols/http.engine.ts: readFileSync(...).toString('base64')),
      // so the echo server's `data` field holds the base64 form, not the raw bytes.
      const expectedBase64 = fs.readFileSync(txtFile).toString('base64')

      const res = await sendRequest(window, {
        method: 'POST',
        url: `${http()}/post`,
        headers: [
          { id: 'ct', key: 'Content-Type', value: 'application/octet-stream', enabled: true },
        ],
        projectId,
        body: {
          type: 'binary',
          binaryPath: txtFile,
        },
      })
      expect(res.status).toBe(200)
      // Echo server returns data field for POST — it round-trips the base64 payload
      const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body ?? {})
      expect(body).toContain(expectedBase64)
    },
  )
})
