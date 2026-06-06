/**
 * MST-260, MST-261, MST-269, MST-270 — Certificate DB persistence
 */
import path from 'node:path'
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import {
  addCertificateIpc,
  deleteCertificateIpc,
  listCertificatesIpc,
  updateCertificateIpc,
} from '../../helpers/ui/db-flow'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const CERT_DIR = path.resolve(__dirname, '../../../fixtures/certs')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB certificates [MST-260, MST-261, MST-269, MST-270]', () => {
  uiTest('MST-260 CA cert path persists', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const crt = path.join(CERT_DIR, 'ca.crt')
    const id = await addCertificateIpc(window, {
      projectId,
      kind: 'ca',
      crtPath: crt,
    })
    const rows = (await listCertificatesIpc(window, projectId)) as Array<{ id: string; crt_path: string }>
    expect(rows.find((r) => r.id === id)?.crt_path).toBe(crt)
  })

  uiTest('MST-261 client PFX + host pattern persist', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const pfx = path.join(CERT_DIR, 'bad.p12')
    const id = await addCertificateIpc(window, {
      projectId,
      kind: 'client',
      host: '127.0.0.1',
      pfxPath: pfx,
      passphrase: 'test',
    })
    const rows = (await listCertificatesIpc(window, projectId)) as Array<{
      id: string
      host: string
      pfx_path: string
    }>
    const row = rows.find((r) => r.id === id)
    expect(row?.host).toBe('127.0.0.1')
    expect(row?.pfx_path).toBe(pfx)
  })

  uiTest('MST-269 disable flag toggles enabled column', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const id = await addCertificateIpc(window, {
      projectId,
      kind: 'ca',
      crtPath: path.join(CERT_DIR, 'selfsigned.crt'),
      enabled: true,
    })
    await updateCertificateIpc(window, id, { enabled: false })
    const rows = (await listCertificatesIpc(window, projectId)) as Array<{ id: string; enabled: number }>
    expect(rows.find((r) => r.id === id)?.enabled).toBe(0)
  })

  uiTest('MST-270 certificate delete removes row', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const id = await addCertificateIpc(window, {
      projectId,
      kind: 'ca',
      crtPath: path.join(CERT_DIR, 'ca.crt'),
    })
    await deleteCertificateIpc(window, id)
    const rows = (await listCertificatesIpc(window, projectId)) as Array<{ id: string }>
    expect(rows.some((r) => r.id === id)).toBe(false)
  })
})
