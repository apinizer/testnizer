// Which project the export-format picker is open for (issue #208). The picker
// (`ProjectExportModal`) is mounted once per AppShell branch; File → Export,
// Settings → Storage / Data and the Home card open it through this store, so
// the Home card works without opening the project first.

import { create } from 'zustand'

export interface ProjectExportTarget {
  projectId: string
  /** Shown in the picker and used for the suggested file name. */
  projectName?: string
}

interface ProjectExportPickerStore {
  target: ProjectExportTarget | null
  openPicker: (projectId: string, projectName?: string) => void
  closePicker: () => void
}

export const useProjectExportStore = create<ProjectExportPickerStore>((set) => ({
  target: null,
  openPicker: (projectId, projectName) => set({ target: { projectId, projectName } }),
  closePicker: () => set({ target: null }),
}))
