import { describe, expect, it } from 'vitest'
import { scriptHasCode } from '../../../src/shared/script/has-code'

const PROJECT_DIALOG_DEFAULT =
  '// Runs before every request in this project\n// pm.environment.set("timestamp", Date.now())\n'

describe('scriptHasCode', () => {
  it.each([
    undefined,
    null,
    1,
    '',
    '  \n\t',
    '// x',
    '/* x */',
    '/* a\nb */ // c\n',
    PROJECT_DIALOG_DEFAULT,
  ])('no code: %j', (script) => {
    expect(scriptHasCode(script)).toBe(false)
  })

  it.each([
    'pm.test()',
    '// a\npm.test()',
    '/* a */ pm.test()',
    // A line comment holding `/*` must not swallow the code after it.
    '// /*\npm.test()\n// */',
    // The opener sits in a string: the rest of it survives, so this counts as code.
    "const a = '/*'; pm.test(); const b = '*/'",
    "const u = 'http://x'",
    // U+2028 ends a line comment in JavaScript.
    '// a\u2028pm.test()',
  ])('has code: %j', (script) => {
    expect(scriptHasCode(script)).toBe(true)
  })
})
