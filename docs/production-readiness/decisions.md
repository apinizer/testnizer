# Testnizer — Mimari ve Operasyonel Kararlar

Onaylanmış kararların tek kaynak doğrulama dosyası. Yeni karar eklendikçe en alta kronolojik olarak yazılır; eskilerini değiştirmek yerine **superseded by** referansıyla yeni karar yazılır.

---

## D-001 — Marka Adı: Testnizer

**Tarih:** 2026-05-05
**Durum:** Aktif
**Karar verici:** Ürün ekibi

**Karar:** Apinizer API Tester ürünü "Testnizer" olarak rebrand edildi.

**Gerekçe:** Apinizer şirket markasından bağımsız, tek-sözcüklü, akılda kalır ürün adı. Hedef kitle (kurumsal API test) için "test" kelimesi sezgisel.

**Etkiler:**
- `package.json` name/productName/description, app.name, BrowserWindow.title, UI başlıkları, i18n `about.appName`, dev `Testnizer.app`
- Domain: `testnizer.com` alındı

---

## D-002 — Yayın Kanalı: GitHub Releases

**Tarih:** 2026-05-05
**Durum:** Aktif

**Karar:** Sürümler GitHub Releases üzerinden yayınlanacak. electron-updater `github` provider'ı kullanılacak.

**Gerekçe:**
- electron-updater entegrasyonu kutudan çıktığı gibi çalışır (zero infra)
- Signing secrets GitHub Actions Secrets'ta yönetilir
- Tag-based release otomatik (`v*` push → CI artifact + release)
- Delta update built-in
- Maliyet $0 (public repo) veya GitHub plan dahil (private)

**Reddedilen alternatifler:**
- **Self-hosted CDN/S3**: `latest.yml` ve delta üretimi manuel; CDN maliyeti
- **GitLab Releases**: electron-updater'da `gitlab` provider az olgun; generic provider gerekir
- **Hibrit (testnizer.com landing + GitHub asset)**: ileride landing sayfası eklenebilir, altyapı yine GitHub. Hibrit gelecekte D-002.1 olarak eklenebilir.

**Etkiler:**
- `package.json` build.publish: `{ provider: 'github', owner: '...', repo: 'testnizer' }`
- `.github/workflows/build.yml` release job
- `src/main/updater.ts` bağlantısı

---

## D-003 — Bundle ID / appId: `com.testnizer.app`

**Tarih:** 2026-05-05
**Durum:** Aktif
**Supersedes:** Kurulum sırasında geçici `com.apinizer.testnizer` kullanıldı.

**Karar:** Apple/Microsoft bundle ID `com.testnizer.app` olacak.

**Gerekçe:**
- `testnizer.com` domain'inin satın alınması, reverse-DNS bundle ID konvansiyonuna sahiplik hakkı veriyor
- Apinizer şirket sertifikasının altında bağımsız ürün konumlandırma
- Sertifika ile imzalandıktan sonra appId değiştirmek macOS keychain ve Windows SmartScreen reputation'ı sıfırlar — şimdi karar verilmesi şart

**Etkiler:**
- `package.json` build.appId
- `src/main/index.ts` `setAppUserModelId('com.testnizer.app')`
- `scripts/patch-electron-name.sh` `CFBundleIdentifier`
- macOS Info.plist patch'i

**Aksiyon:** Sprint 1'de kod tabanında uygula (sertifika imzasından önce mutlaka).

---

## D-004 — Beta İmzalama: Ad-hoc

**Tarih:** 2026-05-05
**Durum:** Aktif

**Karar:** Beta release'leri ad-hoc imza ile (macOS) ve imzasız (Windows) yayınlanacak. Production 1.0 sertifika tedarikinden sonra.

**Gerekçe:**
- EV Code Signing cert tedariki 1-2 hafta sürüyor; beta'yı bloklamamak için
- Mevcut `scripts/ad-hoc-sign.js` macOS'ta çalışıyor; Gatekeeper sağ-tıkla→Aç ile bypass'lanabilir
- Windows'ta SmartScreen uyarısı kabul edilebilir (beta için)
- Beta kullanıcıları onayladıktan sonra production'a geç

**Etkiler:**
- README'ye macOS Gatekeeper bypass talimatı
- Beta release notes'ta SmartScreen uyarısı açıklaması
- Sprint 7'ye Apple Dev + EV cert tedariki çıkarıldı

---

## D-005 — Status Klasörü: `docs/production-readiness/`

**Tarih:** 2026-05-05
**Durum:** Aktif

**Karar:** Production readiness ve major roadmap takibi `docs/production-readiness/` altında.

**Gerekçe:**
- Repo'da version'lı (git history)
- Ekiple paylaşılır (PR'larda görünür)
- Standart `docs/` konumu

**İçerik:**
- `STATUS.md` — checkbox listeli ana takip
- `decisions.md` — bu dosya
- `runbook.md` — operasyonel komutlar (release, signing setup)

---

## D-006 — Tools Mimari: Workspace Tab Pattern

**Tarih:** 2026-05-05
**Durum:** Aktif

**Karar:** Yeni "Tools" feature'ları (JWT debugger, JSON/XML formatter, encode/decode, diff, JSONPath/XPath/XSLT/Jolt evaluator, WS-Security) workspace tab'ı olarak açılır — modal değil.

**Gerekçe:**
- Mevcut `tabs.store.ts` pattern'i tab başına `protocol: 'http' | 'runner' | ...` modeline sahip; doğal extension noktası
- Aynı anda birden çok tool açık tutulabilir
- Request tab'larıyla yan yana kullanım: "JWT'yi format edilmiş JSON ile karşılaştır" gibi kombinasyonlar
- Modal olsaydı kullanıcı her seferinde aç/kapa yapardı

**Reddedilen alternatif:** Modal — basit ama sınırlayıcı.

**Etkiler:**
- `Protocol` enum'a `'tools.*'` değerleri
- `tabs.store.ts` → `openToolTab(toolType)`
- `src/renderer/components/tools/*.tsx` her araç için ayrı component

---

## D-007 — WS-Security Engine Konumu: Main Process

**Tarih:** 2026-05-05
**Durum:** Aktif

**Karar:** WS-Security XML sign/verify/encrypt/decrypt işlemleri main process'te (`src/main/protocols/wsse.engine.ts`), renderer IPC üzerinden çağırır.

**Gerekçe:**
- Node.js native `crypto` (RSA/AES) renderer'da yok
- Private key/cert hassas materyali main'de tutulur, renderer'a geçmez
- `xml-crypto` ve `xml-encryption` Node-only paketler
- Hem standalone WS-Security tool hem de SOAP request panel aynı engine'i tüketir — tek motor, iki UI yüzeyi

**Etkiler:**
- `src/main/protocols/wsse.engine.ts` (yeni)
- `src/main/ipc/wsse.handler.ts` (yeni)
- `src/preload/index.ts` `window.api.wsse` köprüsü
- `src/main/protocols/soap.engine.ts` `wsse.engine`'i çağırır (mevcut UsernameToken+Timestamp kodu refactor edilir)

---

## D-008 — Sertifika/Key Saklama: Electron `safeStorage`

**Tarih:** 2026-05-05
**Durum:** Aktif (Sprint 6'da uygulanacak)

**Karar:** WS-Security private key + mTLS client cert + Auth password gibi hassas alanlar Electron `safeStorage` API'si ile şifrelenecek (mevcut SQLite plain saklama yerine).

**Gerekçe:**
- macOS Keychain / Windows DPAPI / Linux Secret Service backend'leri
- Disk imajı çalınsa bile veri okunamaz
- WS-Security tool'unun production-grade güvenliği için bloklayıcı

**Etkiler:**
- `src/main/db/certificate.repo.ts` veri yazımı
- Yeni `wsse_keys` tablosu (veya certificate.repo'ya kategori field'ı)
- Auth password hash'i değil — şifrelenmiş raw saklama (verify için decrypt gerekir)

---

## Açık Kararlar (henüz alınmadı)

| ID | Konu | Beklenen tarih |
|---|---|---|
| Q-001 | Sentry self-hosted vs hosted | Sprint 6 öncesi |
| Q-002 | Apple Dev + EV cert hesabı: mevcut Apinizer hesabı mı, ayrı Testnizer mi? | Sprint 5 sonrası beta feedback |
| Q-003 | README/landing dili: EN-only mi, EN+TR mi? | Sprint 6 |
