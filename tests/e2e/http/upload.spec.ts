import path from 'node:path'
import { httpTest as test } from './_setup'
import { kvList } from '../helpers/api'
import { HTTPBIN, isReachable } from '../helpers/public-endpoints'

const SMALL = path.resolve(__dirname, '../../fixtures/upload/small.txt')

test.beforeAll(async () => {
  const ok = await isReachable(`${HTTPBIN}/get`)
  test.skip(!ok, 'httpbin.org is unreachable')
})

test.skip('multipart upload — single file with text fields', async ({ window }) => {
  // Engine's form-data file upload semantics (file path vs base64 vs Buffer)
  // need to be specified at the IPC boundary. Tracked for Sprint 4 alongside
  // the SOAP redesign which also needs binary attachments.
  void SMALL
  void window
})

test.skip('multipart upload — multiple text-only fields', async ({ window }) => {
  // form-data type currently triggers FormData boundary issues over IPC;
  // urlencoded covers the common case until Sprint 4.
  void window
  void kvList
})
