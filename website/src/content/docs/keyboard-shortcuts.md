---
title: Keyboard shortcuts
description: Default keyboard shortcuts for sending requests, managing tabs, toggling panels, and importing.
order: 2
section: Reference
---

All default shortcuts are listed below. Where a shortcut differs by operating
system, the macOS key is shown first followed by the Windows / Linux
equivalent.

---

## Requests

| Action | macOS | Windows / Linux |
|---|---|---|
| Send request (runs the tool / resource / prompt in an MCP tab) | `Cmd+Enter` | `Ctrl+Enter` |
| Save request | `Cmd+S` | `Ctrl+S` |
| Save project | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Format request body | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Close current tab | `Cmd+W` | `Ctrl+W` |
| Force close current tab (no unsaved-changes prompt) | `Cmd+Alt+W` | `Ctrl+Alt+W` |

---

## Navigation

| Action | macOS | Windows / Linux |
|---|---|---|
| New request tab | `Cmd+N` | `Ctrl+N` |
| New tab | `Cmd+T` | `Ctrl+T` |
| Switch to next tab | `Cmd+Alt+→` | `Ctrl+Alt+→` |
| Switch to previous tab | `Cmd+Alt+←` | `Ctrl+Alt+←` |
| Focus URL bar | `Cmd+L` | `Ctrl+L` |
| Toggle left sidebar | `Cmd+B` | `Ctrl+B` |
| Open Project Hub | `Cmd+P` | `Ctrl+P` |

---

## Panels and windows

| Action | macOS | Windows / Linux |
|---|---|---|
| Toggle Console | `Cmd+Alt+C` | `Ctrl+Alt+C` |
| Close Console | `Esc` | `Esc` |
| New window | `Cmd+Shift+N` | `Ctrl+Shift+N` |

---

## General

| Action | macOS | Windows / Linux |
|---|---|---|
| Command palette | `Cmd+K` | `Ctrl+K` |
| Show the shortcut cheatsheet | `?` | `?` |
| Open Settings | `Cmd+,` | `Ctrl+,` |
| Import | `Cmd+O` | `Ctrl+O` |
| Import cURL (opens the Import dialog) | `Cmd+I` | `Ctrl+I` |
| Reload window | `Cmd+R` | `Ctrl+R` |
| Force reload window | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| Toggle DevTools | `Cmd+Option+I` | `Ctrl+Shift+I` |
| Quit Testnizer | `Cmd+Q` | `Alt+F4` |

---

## Notes

- These are the shortcuts the app responds to. They are listed read-only in
  **Project Settings → Shortcuts** and in the in-app cheatsheet (press `?`);
  they cannot be reassigned.
- Shortcuts that conflict with a system-wide shortcut on your OS may not work
  until the system shortcut is disabled.
- On macOS, Testnizer shows chords with Apple's symbols in menus, tooltips and
  the command palette — for example `Cmd+Alt+C` appears as ⌥⌘C and
  `Cmd+Alt+→` as ⌥⌘→.
- The command palette (`Cmd+K` / `Ctrl+K`) accepts fuzzy search over all
  actions, so you can trigger any feature without remembering its exact
  shortcut.
- Reload, Force reload and Toggle DevTools come from the standard Electron
  **View** menu.
