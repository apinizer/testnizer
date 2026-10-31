# E2E "needs hook" listesi — gelecekteki src/ PR'ı

Güncelleme: 2026-10-31 (tur1 soft-pass temizliği). Kural: bir spec, aranan öğe bulunamadı diye **geçmez**. Öğe başka bir selector/IPC ile erişilebiliyorsa test gerçek assertion'a çevrildi; src'de hiç yoksa test açıkça `test.skip(true, '<neden> — needs ...')` ile atlanır (raporda "skipped" görünür) ve aşağıya yazılır. Bu maddeler **test değişikliği değil**, `src/` tarafında küçük eklemeler (data-testid / UI yüzeyi) gerektirir.

## Özellik eksikleri (testler bilerek skip — özellik src'de yok)

| İstek | Skip eden test | Not |
|---|---|---|
| ProjectHome içinde proje arama kutusu (`data-testid="project-search"`) | `workspace-advanced` MST-013 | ProjectHome'da arama input'u yok |
| Tanılama / log dışa aktarma UI'ı | `settings-advanced` MST-199 | Settings'te diagnostics yüzeyi yok |
| Kullanıcının oluşturabildiği Module | `tree-advanced` MST-027 | "module" yalnız proje kök düğümü; oluşturulamaz |
| Endpoint Case / Add Case kavramı | `tree-advanced` MST-024 | EndpointCase modeli yok |
| Profil görünen adının düzenlenebilmesi | `ux-misc` MST-201 | ProfileModal'da editable display name yok |
| MST-004 OS biyometrik auth mock'u (`auth.osAuthMock`) | `auth-advanced` MST-004 | OS-mock altyapısı gerekiyor |

## data-testid eklemeleri (UI yolunu açar; bugün IPC-only assert veya etiket/role locator)

Hepsi src'de HÂLÂ yok (doğrulandı, 2026-10-31):

| Testid | Bileşen | Bugünkü geçici çözüm |
|---|---|---|
| `runner-export-html` | RunnerResults "Export HTML" butonu | `18-runner-report` MST-177 IPC (`runner:export`) + sayılar HTML'e karşı doğrulanıyor |
| `runner-iteration-data-textarea` | IterationDataPicker | `runner-iterations` MST-175 yalnız iterasyon sayısını sürer; veri dosyası UI yolu test edilmiyor |
| `ai-key-toggle`, `ai-error-message` | AI Chat editörü | role/placeholder ve metin eşleşmesi (`ai-chat-deep`) |
| `mock-response-condition` | Mock response condition textarea'sı | JSON değerine göre heuristik (`fillLastResponseCondition`) |
| `quick-test-shell` | QuickTestShell kök elemanı | — |
| `login-quick-test` | Password login formundaki guest butonu | yalnız ilk açılış welcome'ında `login-continue-anonymous` var |
| `new-project-mode-local`, `new-project-mode-git` | New Project sihirbazı adım 3 (save mode kartları, OptionCard div) | `workspace-advanced` MST-014 kart metniyle çalışır |
| `branch-delete-{name}` | BranchDropdown çöp kutusu | `git-advanced` IPC delete |
| `merge-conflict-modal`, `conflict-resolve-ours`, `conflict-resolve-theirs` | MergeConflictModal | `git-advanced` MST-188 yalnız IPC `git:resolveConflict` |
| `resizable-divider` | Sol panel kenar tutamağı (`EdgeResizeHandle`, `role=separator`, title "Drag to resize") | `ux-misc` MST-208 role ile sürüklüyor — testid isteği kozmetik |
| `mock-proxy-enabled` | Mock proxy checkbox'ı | `mock-proxy` MST-169 label ile erişiyor — kozmetik |

Çözülenler (listeden çıkarıldı): updater bildirim yüzeyi (`updater-notification`, `updater-install-now`, `updater-install-on-quit`, `updater-skip-version` artık var; `shell-updater*` UI assert eder), `ai-chat-editor`/`ai-api-key`/`ai-settings-*`, `mock-response-delay`/`mock-log-*`, `footer-enterprise`/`about-modal`, `tab-strip`/`left-panel`, `wsse-*` (`auth-wsse-section`, `codegen-wsse-note` mevcut), `kv-bulk-toggle`, `auth-type-ntlm`, `body-type-binary`, `path-variables`.

## App bug'ları (testler skip/daraltılmış — bkz. `ui-coverage.md` app-gap tablosu)

1. **SSE `Last-Event-ID`** — `sse.engine.ts connectEventSource` header'ı custom fetch ile enjekte ediyor; eventsource@3 bunu reddedip DOMException atıyor (header'ı kendisi yönetir). `sse-advanced` MST-124 skip.
2. **Bozuk DB kurtarma yok** — garbage-byte DB'de `initDatabase()` `app.whenReady()` içinde throw ediyor, `createWindow()` hiç çağrılmıyor. `src/main/index.ts` init'ine corrupt-DB recovery (yedekle + yeniden oluştur + kullanıcıya bildir) gerekli. `db-corruption` MST-279 corrupt-bytes case skip.
3. **WS URL restore** — kayıtlı WS isteğinin URL'i DB'ye doğru yazılıyor ama tab yeniden açılınca tab-scoped websocket store default'u restore'un üstüne yazıyor. `ws-advanced` MST-120 DB assert'ine indirildi.
4. **Socket.IO erken event kaybı** — server bağlantı anında push'ladığı event'ler (örn. `welcome`), renderer'ın event handler'ı IPC roundtrip sonrası bağlandığı için kaybolabiliyor: `socketio.engine.ts` `onAny` içindeki `conn.onEvent?.(...)` handler yokken sessizce düşürüyor. Fix: handler bağlanana dek event'leri buffer'la. `socketio-advanced` MST-142 emit/echo doğrulamasına çevrildi.

## Test altyapısı eksikleri

- `tests/e2e/servers/grpc-server.ts` yalnızca unary RPC destekliyor; streaming MST-134/135/136 `grpc-advanced` içindeki satır-içi streaming sunucusuyla gerçek UI üzerinden koşuyor.
- graphql-ws test sunucusu yok — MST-131 yalnız Run -> Subscribe düğme geçişini doğrular.
- 6 import formatının engine desteği yok: Apidog, JMeter JMX, ApiDoc, WADL, Google Discovery, Hoppscotch (MST-076/077/078/080/081/084) — format engine'i gelirse spec şablonu `import-formats-2.spec.ts`'ten kopyalanabilir.
