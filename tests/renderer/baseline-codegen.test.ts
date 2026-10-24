/**
 * BASELINE / CHARACTERIZATION — code generation for the 11 pre-#280 ids
 * (`src/renderer/lib/code-generator.ts` → `src/shared/codegen/`).
 *
 * Pins what `generateCode()` emits for every legacy id across the request
 * matrix (`tests/fixtures/codegen-cases.ts` → `BASELINE_CASES`). Before issue
 * #280 these snapshots pinned known-wrong output on purpose; the rewrite fixed
 * every one of those bugs and the snapshot was regenerated deliberately:
 *
 *  - form-data body (text + file part): every language now sends it (OkHttp
 *    `MultipartBody`, Go `mime/multipart`, PHP `CURLFile`, Python `files=`,
 *    Ruby `set_form`, C# `MultipartFormDataContent`, Swift multipart `Data`,
 *    fetch `FormData`, axios `form-data` + streams); the user's
 *    `Content-Type: multipart/form-data` (no boundary) is dropped everywhere.
 *  - basic auth: the language's basic-auth API (`-u`, `auth=`, `SetBasicAuth`,
 *    `Credentials.basic`, `CURLOPT_USERPWD`, `basic_auth`, axios `auth:`) or a
 *    real base64 header (fetch, Swift, C#) — never the `Basic <base64(…)>` text.
 *  - api-key in query: appended to the URL in every language.
 *  - Python + JSON body: `json=` with a real Python literal (True/False/None);
 *    no unused `import json`; the response is printed as text.
 *  - Content-Type: the one the body implies (urlencoded / xml / json / text)
 *    is sent when the user set none; Java / Kotlin / C# media types follow it;
 *    C# puts it on the content (request.Headers.Add threw "Misused header").
 *  - fetch / Python no longer assume a JSON response (`response.text()`).
 *  - Go uses `io.ReadAll` (no deprecated `ioutil`) and gofmt tabs.
 *  - special-chars-and-quotes: unsafe URL characters are percent-encoded
 *    (`{{var}}` kept readable), table params go BEFORE the `#frag`; PHP uses
 *    single quotes (no `$HOME` interpolation), Kotlin escapes `$`, Ruby
 *    escapes `#{`.
 *
 * Snapshot file: tests/renderer/__snapshots__/baseline-codegen.test.ts.snap
 * Every other variant: tests/main/shared/codegen/variants-snapshot.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { generateCode, CODE_LANGUAGES } from '../../src/renderer/lib/code-generator'
import type { CodeLanguage } from '../../src/renderer/types'
import { BASELINE_CASES as cases } from '../fixtures/codegen-cases'

describe('baseline code generation — all languages x request matrix', () => {
  it('covers exactly the 11 languages', () => {
    expect(CODE_LANGUAGES.map((l) => l.id)).toEqual([
      'curl',
      'js-fetch',
      'js-axios',
      'python-requests',
      'java-okhttp',
      'go',
      'php',
      'ruby',
      'swift',
      'kotlin',
      'csharp',
    ])
  })

  for (const c of cases) {
    describe(c.name, () => {
      for (const lang of CODE_LANGUAGES.map((l) => l.id as CodeLanguage)) {
        it(lang, () => {
          expect(generateCode(lang, c.req, c.options)).toMatchSnapshot()
        })
      }
    })
  }

  it('unknown language falls back to a not-supported comment', () => {
    expect(generateCode('cobol' as CodeLanguage, cases[0].req)).toMatchSnapshot()
  })
})
