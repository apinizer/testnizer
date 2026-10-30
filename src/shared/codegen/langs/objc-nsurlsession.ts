/** Objective-C — NSURLSession (with a semaphore so a command-line tool waits). */
import { headersWithBasic } from '../helpers'
import {
  BOILERPLATE,
  indentCountOpt,
  indentTypeOpt,
  indentUnit,
  rawContent,
  TIMEOUT,
  timeoutMs,
  TRIM_BODY,
} from '../options'
import { objcString as q } from '../quote'
import type { CodegenVariant } from '../types'
import { indentBlock } from './jvm-common'

const BOUNDARY = 'TestnizerFormBoundary7MA4YWxkTrZu0gW'

export const objcNsurlsession: CodegenVariant = {
  id: 'objc-nsurlsession',
  language: 'objective-c',
  label: 'NSURLSession',
  monaco: 'objective-c',
  options: [indentCountOpt(2), indentTypeOpt(), TRIM_BODY, TIMEOUT, BOILERPLATE],
  generate(req, o) {
    const ind = indentUnit(o)
    const ms = timeoutMs(req, o)
    const l: string[] = ['dispatch_semaphore_t sema = dispatch_semaphore_create(0);', '']
    l.push(
      `NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:${q(req.url)}]`,
    )
    l.push(`${ind}cachePolicy:NSURLRequestUseProtocolCachePolicy`)
    l.push(`${ind}timeoutInterval:${ms > 0 ? (ms / 1000).toFixed(1) : '60.0'}];`)
    const { headers, runtime } = headersWithBasic(req)
    if (headers.length > 0) {
      const hs = headers.map((h) => `${ind}${q(h.key)}: ${q(h.value)}`)
      l.push(
        `NSDictionary *headers = @{\n${hs.join(',\n')}\n};`,
        '[request setAllHTTPHeaderFields:headers];',
      )
    }
    if (runtime) {
      l.push(
        `NSString *credentials = [[${q(runtime.userPass)} dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0];`,
      )
      l.push(
        '[request setValue:[@"Basic " stringByAppendingString:credentials] forHTTPHeaderField:@"Authorization"];',
      )
    }
    const b = req.body
    if (b?.mode === 'raw' || b?.mode === 'urlencoded') {
      const text = b.mode === 'urlencoded' ? b.encoded : (rawContent(req, o) ?? '')
      l.push(`[request setHTTPBody:[${q(text)} dataUsingEncoding:NSUTF8StringEncoding]];`)
    } else if (b?.mode === 'binary') {
      l.push(`[request setHTTPBody:[NSData dataWithContentsOfFile:${q(b.path)}]];`)
    } else if (b?.mode === 'form-data') {
      l.push(`NSString *boundary = @"${BOUNDARY}";`, 'NSMutableData *body = [NSMutableData data];')
      const str = (expr: string): string =>
        `[body appendData:[${expr} dataUsingEncoding:NSUTF8StringEncoding]];`
      for (const p of b.parts) {
        l.push(str('[NSString stringWithFormat:@"--%@\\r\\n", boundary]'))
        if (p.kind === 'text') {
          l.push(str(q(`Content-Disposition: form-data; name="${p.key}"\r\n\r\n${p.value}\r\n`)))
        } else {
          l.push(
            str(
              q(
                `Content-Disposition: form-data; name="${p.key}"; filename="${p.fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
              ),
            ),
          )
          l.push(
            `[body appendData:[NSData dataWithContentsOfFile:${q(p.path)}]];`,
            str('@"\\r\\n"'),
          )
        }
      }
      l.push(str('[NSString stringWithFormat:@"--%@--\\r\\n", boundary]'))
      l.push(
        '[request setValue:[@"multipart/form-data; boundary=" stringByAppendingString:boundary] forHTTPHeaderField:@"Content-Type"];',
      )
      l.push('[request setHTTPBody:body];')
    }
    l.push(`[request setHTTPMethod:${q(req.method)}];`, '')
    l.push('NSURLSession *session = [NSURLSession sharedSession];')
    l.push('NSURLSessionDataTask *dataTask = [session dataTaskWithRequest:request')
    l.push('completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {')
    l.push(`${ind}if (error) {`, `${ind}${ind}NSLog(@"%@", error);`, `${ind}} else {`)
    l.push(
      `${ind}${ind}NSLog(@"%@", [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]);`,
      `${ind}}`,
    )
    l.push(`${ind}dispatch_semaphore_signal(sema);`, '}];', '[dataTask resume];')
    l.push('dispatch_semaphore_wait(sema, DISPATCH_TIME_FOREVER);')
    const code = l.join('\n')
    if (o.includeBoilerplate !== true)
      return ['#import <Foundation/Foundation.h>', '', code].join('\n')
    return [
      '#import <Foundation/Foundation.h>',
      '',
      'int main(int argc, const char * argv[]) {',
      `${ind}@autoreleasepool {`,
      indentBlock(code, ind + ind),
      `${ind}}`,
      `${ind}return 0;`,
      '}',
    ].join('\n')
  },
}
