/** JavaScript — XHR and jQuery (browser; both always follow redirects). */
import {
  indentCountOpt,
  indentTypeOpt,
  indentUnit,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { jsString } from '../quote'
import type { CodegenVariant } from '../types'
import { browserBody, browserHeaderEntries, jsObject } from './js-common'

const BROWSER_OPTIONS = [indentCountOpt(2), indentTypeOpt(), TRIM_BODY, TIMEOUT]

export const jsXhr: CodegenVariant = {
  id: 'js-xhr',
  language: 'javascript',
  label: 'XHR',
  monaco: 'javascript',
  options: BROWSER_OPTIONS,
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = []
    const body = browserBody(req, o, ind)
    if (body?.setup.length) lines.push(...body.setup, '')
    else if (body) lines.push(`const data = ${body.expr};`, '')
    lines.push('const xhr = new XMLHttpRequest();', '')
    lines.push("xhr.addEventListener('readystatechange', function () {")
    lines.push(`${ind}if (this.readyState === 4) {`)
    lines.push(`${ind}${ind}console.log(this.responseText);`)
    lines.push(`${ind}}`, '});', '')
    lines.push(`xhr.open(${jsString(req.method)}, ${jsString(req.url)});`)
    for (const [k, v] of browserHeaderEntries(req))
      lines.push(`xhr.setRequestHeader(${jsString(k)}, ${v});`)
    const ms = timeoutMs(req, o)
    if (ms > 0) lines.push(`xhr.timeout = ${ms};`)
    const sent = !body ? '' : body.setup.length ? body.expr : 'data'
    lines.push('', `xhr.send(${sent});`)
    return lines.join('\n')
  },
}

export const jsJquery: CodegenVariant = {
  id: 'js-jquery',
  language: 'javascript',
  label: 'jQuery',
  monaco: 'javascript',
  options: BROWSER_OPTIONS,
  generate(req, o) {
    const ind = indentUnit(o)
    const lines: string[] = []
    const body = browserBody(req, o, ind)
    if (body?.setup.length) lines.push(...body.setup, '')
    const settings: Array<[string, string]> = [
      ['url', jsString(req.url)],
      ['method', jsString(req.method)],
      ['timeout', String(timeoutMs(req, o))],
    ]
    const headers = browserHeaderEntries(req)
    if (headers.length > 0) settings.push(['headers', jsObject(headers, ind, 1)])
    if (body) {
      settings.push(['data', body.expr])
      // FormData / a File must reach XHR untouched, with no jQuery Content-Type.
      if (req.body?.mode === 'form-data' || req.body?.mode === 'binary') {
        settings.push(['processData', 'false'], ['contentType', 'false'])
      }
    }
    lines.push(`const settings = ${jsObject(settings, ind)};`, '')
    lines.push('$.ajax(settings).done(function (response) {')
    lines.push(`${ind}console.log(response);`, '});')
    return lines.join('\n')
  },
}
