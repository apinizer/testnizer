// src/renderer/lib/toast.ts
// Thin wrapper around sonner so the rest of the codebase imports a single,
// stable shape — message + optional opts. If we ever need to swap toast
// libraries we only touch this file.

import type { ReactElement } from 'react'
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

/** A toast whose body is our own element (testids, an Undo button…). Returns its id. */
function custom(
  render: (id: string | number) => ReactElement,
  opts?: ToastOptions,
): string | number {
  return sonner.custom(render, opts)
}

function dismiss(id?: string | number): void {
  sonner.dismiss(id)
}

export const toast = { success, error, info, warning, custom, dismiss }
