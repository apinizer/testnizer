/**
 * Where a request dragged in a suite's Run Sequence lands.
 *
 * The sequence hands over the dragged row, the row it was dropped ON (the
 * anchor) and the row it should go before (`null` = after the last row). The
 * request belongs in the anchor's folder. The handler used to pass
 * `targetFolderId: null`, which moved every reordered request to the suite
 * root, where its folder's auth and pre/post scripts no longer applied.
 *
 * Dropped after the last row of a folder, the "next" row is the first row of
 * the following folder. In that case the request goes to the end of the
 * anchor's folder.
 */
export interface SuiteReorderGroup {
  folderId: string
  endpoints: ReadonlyArray<{ id: string }>
}

export function suiteReorderTarget(
  groups: readonly SuiteReorderGroup[],
  draggedId: string,
  insertBeforeId: string | null,
  anchorId?: string,
): { targetFolderId: string | null; insertBeforeId: string | null } {
  const folderOf = (id: string): string | null =>
    groups.find((g) => g.endpoints.some((ep) => ep.id === id))?.folderId ?? null
  const targetFolderId = folderOf(anchorId ?? insertBeforeId ?? draggedId)
  return {
    targetFolderId,
    insertBeforeId:
      insertBeforeId && folderOf(insertBeforeId) === targetFolderId ? insertBeforeId : null,
  }
}
