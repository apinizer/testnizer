/**
 * Docs section order — the single owner.
 *
 * The sidebar (DocsSidebar.astro) and both docs index pages sort sections by
 * this list. They used to carry three hand-written copies, and the index pages
 * fell behind the sidebar. Each entry is an EN / TR pair, matching the
 * `section:` frontmatter of the docs and docsTr collections exactly; a section
 * not listed here sorts after these, alphabetically.
 */
export const DOCS_SECTION_ORDER: readonly string[] = [
  'Getting started', 'Başlarken',
  "What's new", 'Yenilikler',
  'Guides', 'Kılavuzlar',
  'Protocols', 'Protokoller',
  'Mock servers', 'Mock sunucular',
  'Tools', 'Araçlar',
  'Reference', 'Referans',
]

/** Sort comparator for `[section, entries]` pairs by DOCS_SECTION_ORDER. */
export function compareDocsSections(a: string, b: string): number {
  const ia = DOCS_SECTION_ORDER.indexOf(a)
  const ib = DOCS_SECTION_ORDER.indexOf(b)
  if (ia === -1 && ib === -1) return a.localeCompare(b)
  if (ia === -1) return 1
  if (ib === -1) return -1
  return ia - ib
}
