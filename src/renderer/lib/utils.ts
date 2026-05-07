import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Random short id used by Zustand stores for in-memory rows (key-value pairs,
 * console entries, in-flight request markers). Not a UUID — collisions are
 * acceptable inside a single tab session.
 */
export function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}
