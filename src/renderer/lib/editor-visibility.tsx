import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * Is the subtree currently on screen? (issue #77)
 *
 * The Workbench mounts EVERY open tool tab and toggles `display` rather than
 * mounting only the active one, so a tool's typed input survives switching away
 * and back. That is deliberate — but each mounted tool carries roughly two
 * Monaco editors, and Monaco is expensive: open eight tools and sixteen editor
 * instances sit there holding models, workers and DOM for panes nobody is
 * looking at.
 *
 * The state worth preserving is the tool's own (`useState` holding the text);
 * Monaco is a controlled VIEW of it. So the tool stays mounted and Monaco does
 * not: a hidden pane renders the same skeleton the lazy chunk already uses, and
 * remounts from the tool's state the moment the tab comes back.
 *
 * Defaults to visible, so every existing `MonacoWrapper` outside a tool tab
 * (request editor, response body) behaves exactly as before with no provider.
 */
const EditorVisibilityContext = createContext(true)

export function EditorVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean
  children: ReactNode
}) {
  return (
    <EditorVisibilityContext.Provider value={visible}>{children}</EditorVisibilityContext.Provider>
  )
}

export function useEditorVisible(): boolean {
  return useContext(EditorVisibilityContext)
}
