# E2E "needs hook" listesi — gelecekteki src/ PR'ı

Güncelleme: 2026-06-07. Tur1 MST yazımı sırasında derlendi. Bu maddeler **test değişikliği değil**, `src/` tarafında küçük eklemeler (data-testid / IPC / UI yüzeyi) gerektirir. Hepsi tek PR'da toplanıp tek rebuild ile çıkarılabilir; ilgili testler şu an IPC-yolu veya heuristik locator ile geçiyor (ya da soft-skip).

## data-testid eklemeleri (UI yolunu açar)

| Testid | Bileşen | Bugünkü geçici çözüm |
|---|---|---|
| `runner-export-html` | RunnerResults "Export HTML" butonu | IPC-only assert |
| `runner-iteration-data-textarea` | IterationDataPicker | Data dosyası IPC ile enjekte ediliyor |
| `ai-key-toggle`, `ai-error-message` | AI Chat editörü | `title`/metin eşleşmesi |
| `mock-response-condition` | Mock response condition textarea'sı | JSON değerine göre heuristik eşleşme (`fillLastResponseCondition`) |
| `quick-test-shell` | QuickTestShell kök elemanı | — |
| `login-quick-test` | Password login formundaki guest butonu | Yalnızca ilk açılış welcome'ında `login-continue-anonymous` var |
| `project-search`, `new-project-mode-local`, `new-project-mode-git` | Project Home + New Project sihirbazı | MST-013/014 soft-skip |
| Branch satırı delete kontrolü | BranchDropdown | IPC fallback |
| `merge-conflict-modal` + çözüm butonları | Git merge akışı | IPC fallback |
| `updater-*` (bildirim yüzeyi) | Updater UI — şu an UpdateModal yalnızca manuel açılıyor, `updater:event` bildirimi UI'a yansımıyor | `shell-updater` MST-230/231 IPC-only |
| `resizable-divider` | Workbench bölücüsü | — |
| `mock-proxy-enabled` | Mock proxy ayarı | — |
| `wsse-*` | WSSE konfigürasyon alanları | Heuristik locator |

## App bug'ları (testler skip/daraltılmış — bkz. `ui-coverage.md` app-gap tablosu)

1. **SSE `Last-Event-ID`** — `sse.engine.ts connectEventSource` header'ı custom fetch ile enjekte ediyor; eventsource@3 bunu reddedip DOMException atıyor (header'ı kendisi yönetir). `sse-advanced` MST-124 skip.
2. **Bozuk DB kurtarma yok** — garbage-byte DB'de `initDatabase()` `app.whenReady()` içinde throw ediyor, `createWindow()` hiç çağrılmıyor. `src/main/index.ts` init'ine corrupt-DB recovery (yedekle + yeniden oluştur + kullanıcıya bildir) gerekli. `db-corruption` MST-279 corrupt-bytes case skip.
3. **WS URL restore** — kayıtlı WS isteğinin URL'i DB'ye doğru yazılıyor ama tab yeniden açılınca tab-scoped websocket store default'u restore'un üstüne yazıyor. `ws-advanced` MST-120 DB assert'ine indirildi.
4. **Socket.IO erken event kaybı** — server bağlantı anında push'ladığı event'ler (örn. `welcome`), renderer'ın event handler'ı IPC roundtrip sonrası bağlandığı için kaybolabiliyor: `socketio.engine.ts` `onAny` içindeki `conn.onEvent?.(...)` handler yokken sessizce düşürüyor. Fix: handler bağlanana dek event'leri buffer'la. `socketio-advanced` MST-142 emit/echo doğrulamasına çevrildi.

## Test altyapısı eksikleri

- `tests/e2e/servers/grpc-server.ts` yalnızca unary RPC destekliyor — streaming MST'leri için server-side/client-side/bidi streaming eklenebilir.
- 6 import formatının engine desteği yok: Apidog, JMeter JMX, ApiDoc, WADL, Google Discovery, Hoppscotch (MST-076/077/078/080/081/084) — format engine'i gelirse spec şablonu `import-formats-2.spec.ts`'ten kopyalanabilir.
- MST-004 (OS biyometrik auth) OS-mock altyapısı gerektiriyor — `auth-advanced` içinde skip.
