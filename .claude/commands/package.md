# /package

Apinizer API Tester için dağıtım paketlerini (dmg / exe / deb / AppImage / zip) üretir. Bu komut, native modüllerin (özellikle `better-sqlite3`) yanlış hedef mimariyle paketlenmesini **önleyen** kesin prosedürü tanımlar.

> **Neden bu dosya var?** Tek `electron-builder --mac --win --linux` çağrısı tek host üzerinde native modülleri güvenilir şekilde derleyemez: `node_modules/better-sqlite3/build/Release/better_sqlite3.node` tek yol, ardışık target'lar birbirini ezer ve sonunda macOS DMG'nin içinden Windows DLL çıkabilir. Aşağıdaki kurallara **harfiyen** uy.

---

## Temel Kurallar (ASLA ihlal etme)

1. **Tek `electron-builder` çağrısında birden fazla platform verme.** `--mac --win --linux` yasak. Her platform için ayrı çağrı.
2. **Her platform değişiminden ÖNCE `node_modules/better-sqlite3/build`'i sil.** Aksi halde electron-builder önceki hedefin rebuild cache'ini görüp yeniden derlemez ve DMG/EXE/AppImage yanlış platformun binary'sini taşır. Bu tek satırlık temizlik paketleme bug'ının %100 çözümüdür.
3. **Her paketleme sonrası `scripts/verify-natives.js` çalıştır.** Non-zero exit ise o paketi DAĞITMA — kök sebebi bul. Bu kuralı ihlal etmek, tam olarak "macOS DMG içinden Windows DLL çıkması" hatasına sebep olur.
4. **Packaging sonunda `better-sqlite3`'ü host arch'ına geri al.** Aksi halde `npm run dev` "slice is not valid mach-o file" ile patlar.
5. **macOS DMG üretimi için `python` PATH'te olmalı ve `plistlib` + `xml.parsers.expat` yükleyebilmelidir.** Homebrew Python 3.14 bu tarihte (2026-04) `libexpat` sembolü bulamadığı için dmgbuild'i kıruyor; Apple'ın `/usr/bin/python3` xcode stub'ı da Command Line Tools prompt'u nedeniyle kullanılamaz. Çözüm: `brew install python@3.12` + `/tmp/py-shim/python` symlink'i. Detay altta "Python shim" bölümünde.
6. **Lokal host yalnızca macOS için "native" build yapabilir.** Windows/Linux lokal macOS'tan çıkar ama yalnızca `better-sqlite3` prebuilt'ları mevcut olduğu için; native-compile gerektiren başka bir native modül eklendiğinde lokal build kırılır. Gerçek release artifact'ları **her zaman CI'dan** (.github/workflows/build.yml) gelir.

## Python shim (macOS'ta lokalde DMG üretirken)

```bash
brew install python@3.12                                          # bir kez yeterli
mkdir -p /tmp/py-shim
ln -sf /opt/homebrew/opt/python@3.12/bin/python3.12 /tmp/py-shim/python
export PATH="/tmp/py-shim:$PATH"                                  # paketleme session'ı boyunca
/tmp/py-shim/python -c "import plistlib, xml.parsers.expat"       # doğrulama — hatasız olmalı
```

`PATH` ayarı yalnızca paketleme shell'i için gerekli; global rc dosyasına eklenmez — tamamlanınca kaybolur.

---

## Lokal Prosedür (macOS host)

Apple Silicon üzerinde çalıştığın varsayılır. Aşağıdaki blok başından sonuna kadar, adım atlamadan:

```bash
# 0. Python shim + PATH (yukarıdaki "Python shim" bölümü bir kez koşulmuş olmalı)
export PATH="/tmp/py-shim:$PATH"

# 1. Temiz başla
rm -rf dist/
rm -rf node_modules/better-sqlite3/build

# 2. Renderer + main bundle (bir kere yeterli — tüm paketler aynı out/'u kullanır)
npm run build

# 3. macOS (package.json mac.target zaten [x64, arm64] içerdiğinden --arm64
#    flag'i tüm mac arch'larını build eder — tek çağrı hem dmg hem zip verir)
npx electron-builder --mac --arm64 --publish never
node scripts/verify-natives.js --platform=darwin --arch=arm64
node scripts/verify-natives.js --platform=darwin --arch=x64

# 4. Windows — ÖNCE cache'i sıfırla, sonra build
rm -rf node_modules/better-sqlite3/build dist/win-unpacked dist/win-arm64-unpacked
npx electron-builder --win --x64 --publish never
node scripts/verify-natives.js --platform=win32 --arch=x64
node scripts/verify-natives.js --platform=win32 --arch=arm64

# 5. Linux — yine ÖNCE cache'i sıfırla
rm -rf node_modules/better-sqlite3/build
npx electron-builder --linux --x64 --publish never
node scripts/verify-natives.js --platform=linux --arch=x64
node scripts/verify-natives.js --platform=linux --arch=arm64

# 6. ZORUNLU — node_modules'daki native binary şu an linux ELF.
#    Dev mode'u bozmamak için darwin-arm64'e geri al.
rm -rf node_modules/better-sqlite3/build
npx electron-rebuild -f -w better-sqlite3
file node_modules/better-sqlite3/build/Release/better_sqlite3.node
# Beklenen: "Mach-O 64-bit bundle arm64"

# 7. Son doğrulama — tüm artifact'lar dist/ready-packages/ altında
ls -la dist/ready-packages/
```

**Not:** 4. ve 5. adımdaki `rm -rf node_modules/better-sqlite3/build` **kritik**. Bunu atlarsan electron-builder önceki platformun prebuild binary'sini bulduğunda yeniden indirmeden atlar ve yanlış native'i paketler. Bu adım atlanarak yapılan tek bir build `verify-natives.js` sayesinde yakalanabilir ama yayına çıkma riski doğurur — hiç atlama.

### Kestirme (npm script'leri)

```bash
npm run build:mac:arm64
npm run verify:natives -- --platform=darwin --arch=arm64
npm run build:mac:x64
npm run verify:natives -- --platform=darwin --arch=x64
# ... her platform için
```

### Yalnızca macOS dağıtımı üretmek istiyorsan

Yalnızca adım 0 → 2 → 5'i çalıştır. Adım 5 ATLANAMAZ.

---

## CI Prosedürü (tavsiye edilen)

`.github/workflows/build.yml` her platform + arch için **ayrı native runner** kullanır:

| Platform | Arch | Runner |
|---|---|---|
| mac | arm64 | macos-14 |
| mac | x64 | macos-13 |
| linux | x64 | ubuntu-latest |
| linux | arm64 | ubuntu-24.04-arm |
| win | x64 | windows-latest |
| win | arm64 | windows-11-arm |

Çalıştırma:
- `git push origin vX.Y.Z` → tag trigger → 6 paralel build → taslak GitHub Release
- Manuel: GitHub → Actions → "Build" → Run workflow

CI her job'da verify-natives.js'i çalıştırır; bir binary yanlışsa job kırmızıya döner, artifact yayınlanmaz.

---

## Bug Belirtileri (bu durumla karşılaşırsan)

| Belirti | Kök Sebep | Çözüm |
|---|---|---|
| macOS DMG açılmıyor, console'da "slice is not valid mach-o file" | DMG'nin içindeki `better_sqlite3.node` bir Windows PE32+ veya Linux ELF | Adım 2'yi (mac build'leri) tüm diğer platformlardan **ÖNCE** çalıştır |
| `npm run dev` başlatılırken aynı hata | Packaging sonrası native binary mac arch'ında değil | Adım 5'i çalıştır |
| `verify-natives.js` "got=win32" diyor mac build için | Birisi yine `--mac --win` aynı anda çalıştırmış | Yukarıdaki prosedürü takip et |
| `verify-natives.js` "no unpacked dir found" | O target için electron-builder unpacked dir'i oluşturmadı (packaging başarısız olmuş) | electron-builder log'larını oku, paketi tekrar çıkar |

---

## Asla Yapma

- ❌ `electron-builder --mac --win --linux` tek satır
- ❌ `build:all` npm script'i (silindi, geri eklenmemeli)
- ❌ Packaging sonrası verify adımını atlamak
- ❌ Packaging sonrası `npm run dev` denemek (önce adım 5)
- ❌ `node_modules`'u git'e commit'lemek (zaten .gitignore'da)
- ❌ `electron-builder install-app-deps`'in rebuild yaptığını varsaymak — cache'liyor; `build/` klasörünü silmeden gerçek recompile olmuyor
