import { create } from 'zustand'
import type { ApiResponse } from '../types'

interface ResponseStore {
  response: ApiResponse | null
  isLoading: boolean

  setResponse: (response: ApiResponse) => void
  clearResponse: () => void
  setLoading: (loading: boolean) => void
}

export const useResponseStore = create<ResponseStore>((set) => ({
  response: null,
  isLoading: false,

  setResponse: (response) => set({ response, isLoading: false }),
  clearResponse: () => set({ response: null }),
  setLoading: (loading) => set({ isLoading: loading }),
}))
