/**
 * Dynamic variables — ONE table for Send, Run and Mock (issue #281), generated
 * by postman-collection's own table for every Postman name.
 *
 * Before: three hand-kept generator copies (renderer dynamic-values.ts, main
 * variable-resolver.ts, mock/template.ts) knew 5 Postman names, `$guid` (the
 * most used one) was missing, and an unknown `{{$name}}` lost its braces and
 * shipped as the bare text `$name`. Postman leaves an unknown dynamic variable
 * exactly as written.
 */
import { describe, expect, it } from 'vitest'
import { resolveVariables as resolveSend } from '../../../src/renderer/lib/variable-resolver'
import { resolveVariables as resolveRun } from '../../../src/main/lib/variable-resolver'
import { renderTemplate } from '../../../src/main/mock/template'
import {
  DYNAMIC_VARIABLES,
  isKnownDynamicVariable,
  resolveDynamicVariable,
  resolveTemplate,
} from '../../../src/shared/dynamic-variables'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Output shape per Postman name (postman-collection dynamic-variables.js). */
const SHAPES: Record<string, RegExp> = {
  $guid: UUID,
  $randomUUID: UUID,
  $timestamp: /^\d{10}$/,
  $isoTimestamp: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  $randomInt: /^\d{1,4}$/,
  $randomBoolean: /^(true|false)$/,
  $randomAlphaNumeric: /^[a-z0-9]$/,
  $randomHexColor: /^#[0-9a-f]{6}$/,
  $randomColor: /^[a-z ]+$/i,
  $randomIP: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  $randomIPV6: /^([0-9a-f]{4}:){7}[0-9a-f]{4}$/,
  $randomMACAddress: /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/,
  $randomPassword: /^\w{15}$/,
  $randomLocale: /^[a-z]{2,3}$/,
  $randomSemver: /^\d\.\d\.\d$/,
  $randomProtocol: /^https?$/,
  $randomPhoneNumber: /^\d{3}-\d{3}-\d{4}$/,
  $randomPhoneNumberExt: /^\d{1,2}-\d{3}-\d{3}-\d{4}$/,
  $randomDirectoryPath: /^\/\S*/,
  $randomMonth: /^[A-Z][a-z]+$/,
  $randomWeekday: /^[A-Z][a-z]+day$/,
  $randomBankAccount: /^\d{8}$/,
  $randomCreditCardMask: /^\d{4}$/,
  $randomPrice: /^\d{1,4}\.\d{2}$/,
  $randomLatitude: /^-?\d{1,2}\.\d{4}$/,
  $randomLongitude: /^-?\d{1,3}\.\d{4}$/,
  $randomEmail: /^\S+@\S+\.\S+$/,
}

describe('dynamic variables resolve the same on Send, Run and Mock', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    it(`{{${name}}}`, () => {
      const t = `{{${name}}}`
      expect(resolveSend(t, {})).toMatch(shape)
      expect(resolveRun(t, {})).toMatch(shape)
      expect(renderTemplate(t, { envVars: {} } as Parameters<typeof renderTemplate>[1])).toMatch(
        shape,
      )
    })
  }

  it('Postman dates print like Postman (Date#toString), within the documented window', () => {
    for (const name of ['$randomDatePast', '$randomDateFuture', '$randomDateRecent']) {
      const out = resolveRun(`{{${name}}}`, {})
      expect(out).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT/)
      const t = new Date(out).getTime()
      const now = Date.now()
      if (name === '$randomDateFuture') expect(t).toBeGreaterThanOrEqual(now - 1000)
      else expect(t).toBeLessThanOrEqual(now + 1000)
    }
  })

  it('an unknown {{$name}} is left exactly as written on every surface', () => {
    for (const t of ['{{$notAPostmanName}}', '{{ $nope }}', '{{$unknownFn(1,2)}}']) {
      expect(resolveSend(t, {})).toBe(t)
      expect(resolveRun(t, {})).toBe(t)
    }
    // Mock: Handlebars would turn a surviving `{{$x}}` into '' — it must stay literal.
    expect(
      renderTemplate('id={{$notAPostmanName}}', {
        envVars: {},
      } as Parameters<typeof renderTemplate>[1]),
    ).toBe('id={{$notAPostmanName}}')
  })

  it('keeps the Testnizer extensions the mock presets use', () => {
    expect(Number(resolveRun('{{$randomInt(5,5)}}', {}))).toBe(5)
    expect(resolveRun('{{$randomString(12)}}', {})).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(resolveSend('{{$randomName}}', {})).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
  })
})

describe("shared table — Postman's own generators (issue #281)", () => {
  it('lists all 118 Postman names (plus the Testnizer extensions) for autocomplete', () => {
    const postman = DYNAMIC_VARIABLES.filter((d) => d.postman)
    expect(postman).toHaveLength(118)
    const names = DYNAMIC_VARIABLES.map((d) => d.name)
    for (const n of Object.keys(SHAPES)) expect(names).toContain(n)
    for (const n of ['$randomName', '$randomString', '$randomInt(min,max)', '$datetime(format)'])
      expect(names).toContain(n)
    expect(postman.every((d) => d.description.length > 0)).toBe(true)
  })

  it('every Postman name resolves on Send, Run and Mock (faker-backed ones included)', () => {
    for (const { name } of DYNAMIC_VARIABLES.filter((d) => d.postman)) {
      const t = `{{${name}}}`
      for (const out of [
        resolveSend(t, {}),
        resolveRun(t, {}),
        renderTemplate(t, { envVars: {} } as Parameters<typeof renderTemplate>[1]),
      ]) {
        expect(out, name).not.toBe(t)
        expect(out.length, name).toBeGreaterThan(0)
      }
    }
    expect(resolveDynamicVariable('$randomFirstName')).toMatch(/^[A-Za-z' -]+$/)
    expect(resolveDynamicVariable('$randomCity')).toBeTruthy()
    expect(isKnownDynamicVariable('$guid')).toBe(true)
    expect(isKnownDynamicVariable('$randomInt(1,2)')).toBe(true)
    expect(isKnownDynamicVariable('$randomCity')).toBe(true)
    expect(isKnownDynamicVariable('$notAPostmanName')).toBe(false)
  })

  it('resolveTemplate chains variables and stops at the depth cap', () => {
    const vars: Record<string, string> = { a: '{{b}}', b: 'B', loop: '{{loop}}' }
    expect(resolveTemplate('{{a}}-{{missing}}', (k) => vars[k])).toBe('B-{{missing}}')
    expect(resolveTemplate('{{loop}}', (k) => vars[k])).toBe('{{loop}}')
  })
})
