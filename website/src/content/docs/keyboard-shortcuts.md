---
title: Keyboard shortcuts
description: Default keyboard shortcuts for sending requests, managing tabs, navigating the sidebar, and opening tools.
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
| Send request | `Cmd+Enter` | `Ctrl+Enter` |
| Save request | `Cmd+S` | `Ctrl+S` |
| Duplicate current tab | `Cmd+D` | `Ctrl+D` |
| Close current tab | `Cmd+W` | `Ctrl+W` |
| Cancel in-flight request | `Cmd+.` | `Ctrl+.` |

---

## Navigation

| Action | macOS | Windows / Linux |
|---|---|---|
| New tab | `Cmd+T` | `Ctrl+T` |
| Switch to next tab | `Cmd+]` | `Ctrl+]` |
| Switch to previous tab | `Cmd+[` | `Ctrl+[` |
| Switch to tab by number (1–9) | `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` |
| Focus URL bar | `Cmd+L` | `Ctrl+L` |
| Focus left sidebar | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Toggle left sidebar | `Cmd+B` | `Ctrl+B` |

---

## Tools

| Action | macOS | Windows / Linux |
|---|---|---|
| Open JWT Debugger | `Cmd+Shift+J` | `Ctrl+Shift+J` |
| Open JSON Formatter | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Open Diff viewer | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Open Console | `Cmd+Shift+C` | `Ctrl+Shift+C` |
| Open Environment manager | `Cmd+Shift+N` | `Ctrl+Shift+N` |

---

## Sidebar — new request

| Action | macOS | Windows / Linux |
|---|---|---|
| New HTTP request | `Cmd+Alt+N` | `Ctrl+Alt+N` |
| New SOAP request | `Cmd+Alt+S` | `Ctrl+Alt+S` |
| New WebSocket connection | `Cmd+Alt+W` | `Ctrl+Alt+W` |
| New GraphQL request | `Cmd+Alt+G` | `Ctrl+Alt+G` |
| New gRPC request | `Cmd+Alt+R` | `Ctrl+Alt+R` |
| New SSE listener | `Cmd+Alt+E` | `Ctrl+Alt+E` |

---

## General

| Action | macOS | Windows / Linux |
|---|---|---|
| Command palette | `Cmd+K` | `Ctrl+K` |
| Open Settings | `Cmd+,` | `Ctrl+,` |
| Reload window (dev only) | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| Open DevTools (dev only) | `Cmd+Option+I` | `Ctrl+Shift+I` |
| Help / documentation | `F1` | `F1` |
| Quit Testnizer | `Cmd+Q` | `Alt+F4` |

---

## Notes

- All shortcuts listed above are the defaults shipped with Testnizer. You can
  reassign any shortcut from **Settings → Keyboard shortcuts**.
- Shortcuts that conflict with a system-wide shortcut on your OS may not work
  until the system shortcut is disabled or the Testnizer binding is changed.
- The command palette (`Cmd+K` / `Ctrl+K`) accepts fuzzy search over all
  actions, so you can trigger any feature without remembering its exact
  shortcut.
- Tab-number shortcuts (`Cmd+1` through `Cmd+9`) follow the visual order of
  open tabs from left to right. `Cmd+9` always activates the last tab
  regardless of how many tabs are open.
