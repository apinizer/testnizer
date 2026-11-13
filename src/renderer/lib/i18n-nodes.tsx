import { Fragment, type ReactNode } from 'react'

/**
 * A translated sentence with inline markup: `{name}` placeholders in the
 * template are replaced by the given nodes (`<strong>`, `<code>`, a link…),
 * the text around them stays as written in the locale. Word order differs
 * between EN and TR, so a sentence is never assembled from fragments.
 *
 *   fillNodes(t('projectSettings.legacyTlsNotice'), { curl: <code>curl</code>, … })
 *
 * An unknown placeholder is kept as literal text.
 */
export function fillNodes(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{[a-zA-Z0-9_]+\})/).map((part, i) => {
    const m = /^\{([a-zA-Z0-9_]+)\}$/.exec(part)
    const node = m && m[1] in nodes ? nodes[m[1]] : part
    return <Fragment key={i}>{node}</Fragment>
  })
}
