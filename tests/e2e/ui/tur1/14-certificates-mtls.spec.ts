/**
 * MST-047, MST-196 — mTLS client cert send
 */
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar, openHttpRequestTab } from '../../helpers/ui/bootstrap'
import { fillUrl, sendAndReadStatus } from '../../helpers/ui/request-flow'
import { addCertificateIpc } from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')
const http = () => localHttpBin()

uiTest.describe('Tur1 — Certificates mTLS [MST-047, MST-196]', () => {
  uiTest('MST-047 client cert registered does not break plain HTTP send', async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    const projectId = await getActiveProjectId(window)
    await addCertificateIpc(window, {
      projectId,
      kind: 'client',
      host: '127.0.0.1',
      crtPath: path.join(CERT_DIR, 'client.crt'),
      keyPath: path.join(CERT_DIR, 'client.key'),
    })
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?mtls=smoke`)
    expect(await sendAndReadStatus(window)).toBe(200)
  })
})
