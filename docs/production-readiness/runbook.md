# Testnizer — Operasyonel Runbook

Tekrarlanan operasyonel görevlerin adım adım komut listesi. Yeni ekip üyesi açıp körü körüne çalıştırabilmeli.

---

## 1. Geliştirme Ortamı Kurulumu

```bash
# Repo klon (henüz GitHub'a taşınmadı; mevcut GitLab)
git clone https://gitlab.com/apinizer-cloud/apinizer-apitester.git testnizer
cd testnizer

# Bağımlılıklar (postinstall otomatik electron-rebuild + Testnizer.app rename çalışır)
npm install

# Dev sunucu (renderer http://localhost:5173, Electron Testnizer.app olarak başlar)
npm run dev

# Type check
npm run typecheck

# Üretim derlemesi (out/)
npm run build

# İkonları yeniden üret (build/icons + Testnizer.app/electron.icns)
npm run icons
```

**Sorun: macOS'ta "Testnizer.app" hasarlı uyarısı**
- Sebep: ad-hoc imza Gatekeeper'ı geçmez
- Çözüm: Finder → `node_modules/electron/dist/Testnizer.app` sağ-tık → Aç (sadece ilk kez)

---

## 2. Test Çalıştırma (Sprint 1 sonrası)

```bash
npm run test:unit          # Vitest unit
npm run test:e2e           # Playwright (electron) smoke
npm test                   # her ikisi
npm run lint               # ESLint
npm audit --production     # bağımlılık güvenliği
```

---

## 3. Beta Release Çıkarma (Sprint 5 sonrası)

```bash
# 1. Versiyon bump (commit + tag oluşturur)
npm version <patch|minor|major>

# 2. Tag'i remote'a push et — GitHub Actions otomatik:
#    - quality job: typecheck + lint + test:unit
#    - build-mac (arm64 + x64): native runner'da build → --publish always
#      → latest-mac.yml + Testnizer-X.Y.Z-arm64.dmg/.zip + ...-x64.dmg/.zip
#    - build-linux (arm64 + x64): native runner'da build → --publish always
#      → latest-linux.yml + Testnizer-X.Y.Z-x64.AppImage + ...deb
#    - build-windows (arm64 + x64): native runner'da build → --publish always
#      → latest.yml + Testnizer Setup-X.Y.Z.exe + ...zip
#    - release job: artifact'ları topla, GitHub'da DRAFT release oluştur
git push origin main --tags

# 3. GitHub'da Releases sayfası → draft release → release notes ekle → Publish
#    (Yayımlanan release'in tüm `latest-*.yml` dosyaları auto-update için zorunlu)

# 4. Doğrulama: aşağıdaki tüm asset'lerin varlığını kontrol et
#    - Testnizer-X.Y.Z-arm64.dmg, .zip
#    - Testnizer-X.Y.Z-x64.dmg, .zip
#    - Testnizer-X.Y.Z-arm64.AppImage, .deb
#    - Testnizer-X.Y.Z-x64.AppImage, .deb
#    - Testnizer Setup X.Y.Z.exe (x64 + arm64)
#    - Testnizer-X.Y.Z-x64.zip, ...arm64.zip
#    - latest.yml, latest-mac.yml, latest-linux.yml
```

**Lokal paketleme (CI hata verirse fallback):**

```bash
npm run build:mac:arm64   # her komut npm run build → electron-builder
npm run build:mac:x64
npm run build:win:x64
npm run build:linux:x64
node scripts/verify-natives.js --platform=darwin --arch=arm64
```

**Önemli:** Çapraz mimari paketleme aynı host'ta yapılırsa `better-sqlite3` native binding'i bozulur. **`.claude/commands/package.md`** sırasını mutlaka izle veya CI'a bırak.

**Sprint 5 dağıtım kararları:**
- macOS imza: ad-hoc (beta) — `mac.notarize: false`
- Windows imza: yok (beta) — kullanıcı SmartScreen uyarısını Yes ile geçer
- Production imzalama Sprint 7'de (sertifika tedariki sonrası)

---

## 4. Auto-Update Test (Sprint 5 sonrası)

```bash
# 1. Eski sürüm ile yükle (örn. v0.9.0 .dmg/.exe/.AppImage)
# 2. GitHub'a yeni sürüm yayınla (v0.9.1)
# 3. Eski sürüm uygulamayı aç → "Update available" bildirimi
# 4. "Restart and install" → 0.9.1 olarak açılır

# Dev'de fake update kanalı testi:
echo "version: 0.9.1
files: [...]
" > dev-app-update.yml
npm run dev
# Settings → Updates → "Check for updates"
```

---

## 5. macOS Code Signing + Notarization (Sprint 7 sonrası)

```bash
# Gerekli env'ler (GitHub Secrets):
export APPLE_ID="..."
export APPLE_APP_SPECIFIC_PASSWORD="..."
export APPLE_TEAM_ID="..."
export CSC_LINK="path/to/cert.p12"     # veya base64 → CSC_LINK file://
export CSC_KEY_PASSWORD="..."

# package.json mac.notarize: true olmalı
npm run build:mac:arm64
# scripts/notarize.js Apple'a yükler, ticket'ı app'e staple eder

# Doğrulama
codesign --verify --deep --strict dist/mac-arm64/Testnizer.app
spctl --assess --type execute dist/mac-arm64/Testnizer.app
# Beklenen: "accepted source=Notarized Developer ID"
```

---

## 6. Windows Code Signing (Sprint 7 sonrası)

```bash
# Yöntem A: Yerel sertifika
export WIN_CSC_LINK="path/to/cert.pfx"
export WIN_CSC_KEY_PASSWORD="..."
npm run build:win:x64

# Yöntem B: Azure Key Vault (HSM-backed)
# package.json win.signtoolOptions → azureSignTool config

# Doğrulama
signtool verify /pa /v dist/Testnizer-Setup.exe
```

---

## 7. WS-Security Test (Sprint 4 sonrası)

```bash
# Referans test sunucusu (Apache CXF örneği — Docker)
docker run -p 8080:8080 -p 9000:9000 apache/cxf-fediz-idp:latest

# 1. WS-Security tool'u aç (Tools dropdown → WS-Security)
# 2. Sample SOAP envelope yükle
# 3. Sign mode: cert + key seç → çıktı XML üret
# 4. "Send to active SOAP request" → SOAP tab'ına yapıştır
# 5. Send → response geldikten sonra "Verify in tool"

# W3C referans payload'ları:
ls tests/fixtures/wsse/
# - signed-body.xml
# - encrypted-body.xml
# - sign-then-encrypt.xml
# - username-token-digest.xml
```

---

## 8. userData Dizin Yönetimi

```bash
# macOS
ls "$HOME/Library/Application Support/Testnizer/"
# Eski Apinizer kurulumu varsa migration ilk launch'ta otomatik kopyalar

# Sıfırlama (development)
rm -rf "$HOME/Library/Application Support/Testnizer/"

# Windows
dir "%APPDATA%\Testnizer"

# Linux
ls ~/.config/Testnizer/
```

---

## 9. Bağımlılık Güncelleme

```bash
# Güvenlik açığı taraması
npm audit

# Non-breaking otomatik fix
npm audit fix

# Major bump (manuel kontrol gerekir)
npx npm-check-updates --interactive

# Sonrası mutlaka:
npm install
npm run typecheck
npm test
npm run build:mac:arm64    # native rebuild bozulduysa anla
```

---

## 9.5. WS-Security Interop Smoke (Apache CXF)

Sprint 4 ile gelen WSSE engine'in `xml-crypto` / `xml-encryption` çıktısının
gerçek bir Java sunucusuyla anlaşıp anlaşmadığını doğrulamak için aşağıdaki
playbook kullanılır. Otomatik suite'te değil — manuel "release blocker"
kontrol listesi olarak çalıştır.

```bash
# 1. CXF Fediz IDP container'ı (UsernameToken + Sign + Encrypt destekler)
docker run --rm -d --name cxf-wsse -p 8080:8080 apache/cxf-fediz-idp:latest

# 2. Testnizer'ı dev modunda aç
npm run dev

# 3. Manuel adımlar:
#    a) Tools → WS-Security → Mode: Sign
#    b) Sample envelope yükle, server.crt + server.key yapıştır (tests/fixtures/certs/)
#    c) Run → "Send to active SOAP" (yeni bir SOAP Method tab'ı açılı olmalı)
#    d) SOAP request panel: endpoint = http://localhost:8080/fediz-idp/services/...
#    e) Send → 200 / 500 dönüşü WSSE-uyumlu olmalı (CXF "InvalidSignature"
#       fault'u dönerse cert mismatch — bekleniyor; "schema" fault'u dönerse
#       xml-crypto canonicalization sorunu var, bug kaydet)

# 4. Cleanup
docker stop cxf-wsse
```

**Beklenen sonuçlar:**
- Sign-only request: CXF "Cannot find signing cert" fault'u (yerel test cert'ini tanımıyor — tamam)
- Schema valid: HTTP 500 + Fault body, **400/415** olmamalı (400 = malformed envelope = bug)
- Verify own signature: standalone tool'da Verify modu aynı cert ile valid dönmeli

## 10. Release Sonrası Kontrol Listesi

- [ ] GitHub Release sayfası publish edildi
- [ ] `latest.yml` / `latest-mac.yml` / `latest-linux.yml` asset'leri yüklü (auto-update için zorunlu)
- [ ] macOS dmg + zip her iki arch (arm64 + x64)
- [ ] Windows nsis + zip (x64 + arm64)
- [ ] Linux AppImage + deb (x64 + arm64)
- [ ] Eski sürüm üzerinden auto-update testi yapıldı
- [ ] STATUS.md güncellendi, ilgili maddeler ✅ işaretli
- [ ] Sentry release tag'i atıldı (opt-in açıkken)
- [ ] CHANGELOG.md güncellendi
