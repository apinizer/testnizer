/**
 * A WSDL given as file content can name other files and URLs (`wsdl:import`,
 * `xsd:import`, `xsd:include`), and the SOAP library follows them as it parses: a
 * local path is read, a URL is fetched. Content is untrusted input and main has the
 * disk and the network, so those elements are removed first, as with an OpenAPI
 * `$ref`. A WSDL the user gave by URL is not this case: its relative imports are
 * what they asked for.
 */
const REFERENCE_ELEMENT =
  /<((?:[\w.-]+:)?(?:import|include|redefine))\b[^>]*?\b(?:schemaLocation|location)\s*=\s*(?:"[^"]*"|'[^']*')[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/gi

export function withoutExternalWsdlRefs(content: string): { content: string; removed: number } {
  let removed = 0
  const out = content.replace(REFERENCE_ELEMENT, () => {
    removed += 1
    return ''
  })
  return { content: out, removed }
}

export function wsdlRefsWarning(removed: number): string {
  return `${removed} reference(s) to other files or URLs were not followed: types defined there are missing from the example requests.`
}
