/**
 * Text that arrived in an imported file, on its way into a mock response.
 *
 * A mock renders its responses as templates with the project's decrypted
 * variables, and an imported example is somebody else's text: a saved 302 with
 * `Location: https://x.example/?v={{apiKey}}` would hand the secret to `x` as
 * soon as a client follows it. The context also carries `envVars`, so a list of
 * bad names cannot work (`{{envVars.apiKey}}`, `{{json this}}`, `{{#each}}`).
 *
 * So the rule is a short list of what stays live, and every other `{{` is written
 * with the template language's own escape (`\{{`, sent as `{{`). The text stays
 * readable in the mock editor, where removing the backslash is the user's own
 * decision to use the variable. Text without `{{` is not touched.
 *
 * Live: dynamic values and the parts of the request its sender put there on
 * purpose. `request.headers.*` is not live: a client adds project credentials
 * there by itself (the Auth tab), so an imported redirect could echo them away.
 *
 * `renderTemplate` keeps both halves of this: escaped text does not reach the
 * variable pass, and a project variable cannot answer for `request.*`.
 */
const LIVE_TAG =
  /\{\{\s*(?:\$[^{}]*|request\.(?:method|path|bodyText)|request\.(?:params|query|body)(?:\.[\w-]+)+)\s*\}\}/y

export function importedMockText(text: string): string {
  let out = ''
  let copied = 0
  for (const match of text.matchAll(/\{\{/g)) {
    const at = match.index
    // Backslashes change what the escape means (`\\{{` runs the tag): they go.
    let start = at
    while (start > copied && text[start - 1] === '\\') start--
    out += text.slice(copied, start)
    LIVE_TAG.lastIndex = at
    out += start === at && LIVE_TAG.test(text) ? '{{' : '\\{{'
    copied = at + 2
  }
  return out + text.slice(copied)
}
