// src/renderer/lib/toast.ts
// Thin wrapper around sonner so the rest of the codebase imports a single,
// stable shape — message + optional opts. If we ever need to swap toast
// libraries we only touch this file.

import { toast as sonner, type ExternalToast } from 'sonner'

export type ToastOptions = ExternalToast

function success(message: string, opts?: ToastOptions): void {
  sonner.success(message, opts)
}

function error(message: string, opts?: ToastOptions): void {
  sonner.error(message, opts)
}

function info(message: string, opts?: ToastOptions): void {
  sonner.info(message, opts)
}

function warning(message: string, opts?: ToastOptions): void {
  sonner.warning(message, opts)
}

export const toast = { success, error, info, warning }
