// src/renderer/stores/eula.store.ts
//
// Tracks the EULA / Privacy consent gate state for the renderer.
//
// `loaded` flips to `true` only after the main process has answered the
// initial `eula:state` IPC. Until that happens we render a small loading
// stub (NOT the rest of the app), so the user never glimpses the workbench
// before having consented.

import { create } from 'zustand'

interface ConsentRecord {
  accepted: boolean
  acceptedAt: number
  acceptedVersion: string
  acceptedDocsHash: string
}

interface EulaState {
  loaded: boolean
  consentValid: boolean
  state: ConsentRecord
  currentDocsHash: string
  currentVersion: string
  loadError: string | null

  // Actions
  refresh: () => Promise<void>
  accept: () => Promise<{ success: boolean; error?: string }>
  decline: () => Promise<void>
}

function api() {
  return window.api?.eula ?? null
}

const EMPTY: ConsentRecord = {
  accepted: false,
  acceptedAt: 0,
  acceptedVersion: '',
  acceptedDocsHash: '',
}

export const useEulaStore = create<EulaState>((set) => ({
  loaded: false,
  consentValid: false,
  state: { ...EMPTY },
  currentDocsHash: '',
  currentVersion: '',
  loadError: null,

  refresh: async () => {
    const eula = api()
    if (!eula) {
      // Preload bridge missing — fail safe (block app, show gate).
      set({
        loaded: true,
        consentValid: false,
        state: { ...EMPTY },
        currentDocsHash: '',
        currentVersion: '',
        loadError: 'EULA bridge unavailable',
      })
      return
    }
    try {
      const res = await eula.state()
      if (res?.success && res.data) {
        set({
          loaded: true,
          state: res.data.state ?? { ...EMPTY },
          consentValid: !!res.data.consentValid,
          currentDocsHash: res.data.currentDocsHash ?? '',
          currentVersion: res.data.currentVersion ?? '',
          loadError: res.data.warning ?? null,
        })
      } else {
        set({
          loaded: true,
          consentValid: false,
          state: { ...EMPTY },
          loadError: res?.error ?? 'Failed to read consent state',
        })
      }
    } catch (e) {
      set({
        loaded: true,
        consentValid: false,
        state: { ...EMPTY },
        loadError: (e as Error).message,
      })
    }
  },

  accept: async () => {
    const eula = api()
    if (!eula) return { success: false, error: 'EULA bridge unavailable' }
    try {
      const res = await eula.accept()
      if (res?.success) {
        // Re-read state so `consentValid` reflects the new persisted hash.
        await useEulaStore.getState().refresh()
        return { success: true }
      }
      return { success: false, error: res?.error ?? 'Failed to record consent' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  decline: async () => {
    const eula = api()
    if (!eula) return
    try {
      await eula.decline()
    } catch {
      // The main process is shutting us down anyway.
    }
  },
}))
