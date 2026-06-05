# Testnizer — Cursor Agent Rehberi

Bu dosya `.claude/` yapısının Cursor karşılığını özetler. Proje genel kurallar `CLAUDE.md`'de.

## Subagent'lar (`.cursor/agents/`)

Cursor chat'te `@agent-adı` ile veya görev bağlamında otomatik delegasyon ile kullan:

| Agent | Dosya | Ne zaman |
|-------|-------|----------|
| Database | `@database` | SQLite, migration, repo, `src/main/db/` |
| Electron Shell | `@electron-shell` | Window, preload, IPC köprüsü, packaging |
| Protocol Engine | `@protocol-engine` | HTTP/SOAP/WS/gRPC engine + IPC handler |
| UI Frontend | `@ui-frontend` | React renderer, store, layout, modaller |
| Import/Export | `@import-export` | OpenAPI, Postman, WSDL, cURL import/export |

## Skill'ler / Komutlar (`.cursor/skills/`)

Chat'te `/skill-adı` ile çağır:

| Skill | Açıklama |
|-------|----------|
| `/launch-testnizer` | Dev modda uygulama başlat (manuel UI doğrulama) |
| `/release-issue-flow` | Issue triage → fix → PR → release döngüsü |
| `/add-protocol` | Yeni protokol modülü uçtan uca |
| `/implement-phase` | Faz 1–5 geliştirme roadmap'i |
| `/implement-soap` | SOAP/WSDL uçtan uca |
| `/bootstrap` | Sıfırdan proje kurulumu |
| `/package` | Native-safe dağıtım paketi üretimi |

## Geliştirme sırası (yeni feature)

1. `src/renderer/types/index.ts`
2. `src/main/db/` (gerekirse)
3. `src/main/protocols/`
4. `src/main/ipc/`
5. `src/preload/index.ts`
6. `src/renderer/stores/`
7. `src/renderer/components/`

Ctrl+S kaydetme: `save-active-request.ts` → `snapshotProtocol()` güncelle.

## Hızlı komutlar

```bash
npm run dev          # geliştirme
npm run test:unit    # vitest
npm run typecheck    # tsc
npm run build        # production bundle
```
