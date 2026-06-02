# Testnizer — Release Issues Test Cases (`testnizer-releases` #1–#38)

> Her `apinizer/testnizer-releases` issue'su için **repro adımları + beklenen sonuç**.
> Tüm fix'ler `fix/release-issues-sweep` branch'inde. Bu doküman, release öncesi
> her fix'in **gerçek uygulamada** doğrulanması içindir.
>
> **Auto** sütunu: o issue için branch'te yazılmış otomatik test (vitest) var mı.
> `✓ <dosya>` = kapsanıyor · `—` = manuel/E2E ile doğrulanmalı.

| Durum | Anlamı |
|---|---|
| ☐ | Henüz test edilmedi |
| ✅ | Doğrulandı |
| ❌ | Sapma var (not düş) |

Test ortamı: Testnizer **v1.4.7** · Platform: ☐ macOS ☐ Windows ☐ Linux · Tester: ____ · Tarih: ____

---

## A. İstek ayarları & gönderme

### #24 — Request timeout backend'e iletilmiyor `Auto: ✓ http-engine-errors.test.ts`
1. Bir HTTP isteği aç → **Settings** sekmesi → **Request timeout** = `2000` ms.
2. URL: `https://httpbin.org/delay/5` → Send.
3. **Beklenen:** ~2 sn'de timeout hatası. ☐
4. Timeout = `0` yap, yavaş bir endpoint'e Send → **Beklenen:** hiç timeout olmaz (sınırsız). ☐

### #25 — Max redirects yok sayılıyor `Auto: ✓ http-engine-errors.test.ts`
1. Settings → **Max redirects** = `3`, Follow redirects ON. URL: `https://httpbin.org/redirect/5` → Send.
2. **Beklenen:** 3. yönlendirmeden sonra "too many redirects" hatası. ☐
3. Max redirects = `0`, URL: `.../redirect/1` → **Beklenen:** 302 döner, takip edilmez. ☐

### #26 — Follow redirects toggle etkisiz `Auto: ✓ http-engine-errors.test.ts`
1. Settings → **Follow redirects** OFF. URL: `https://httpbin.org/redirect/1` → Send.
2. **Beklenen:** Status **302**, response'ta `Location` header görünür, takip edilmez. ☐

### #27 — Per-request SSL verification etkisiz `Auto: —`
1. Settings → **Enable SSL certificate verification** OFF. URL: `https://expired.badssl.com/` → Send.
2. **Beklenen:** 200 OK döner (request-level OFF global ayarı ezer). ☐

### #22 — Param eklenince URL güncellenmiyor `Auto: ✓ request-url-params-sync.test.ts`
1. Bir istek aç → **Params** → `id=42` ekle. **Beklenen:** URL bar `?id=42` gösterir. ☐
2. URL'e `?a=1&b=2` yaz → **Beklenen:** Params sekmesinde a, b satırları belirir. ☐
3. Disabled bir param ekle, URL'i değiştir → **Beklenen:** disabled satır kaybolmaz. ☐

### #23 — Shift+F body beautify etmiyor `Auto: —`
1. Raw JSON body'ye minified JSON yapıştır → **Shift+F**. **Beklenen:** Beautify butonuyla aynı şekilde formatlanır. ☐

### #31 — `{{değişken}}` sonrası caret kayması `Auto: —`
1. URL'e `{{baseUrl}}/users` yaz, değişkenden sonra harf ekle/sil.
2. **Beklenen:** Caret doğru karakter sınırında; harfler karışmaz/kaymaz. ☐

---

## B. Protokoller

### #16 — WSDL yanlış target namespace (tempuri) `Auto: ✓ soap-envelope.test.ts`
1. WSDL: `https://www.dataaccess.com/webservicesserver/numberconversion.wso?WSDL` → parse.
2. **Beklenen:** Üretilen gövde `xmlns:ns1="http://www.dataaccess.com/webservicesserver/"` (tempuri DEĞİL); gönderim fault vermez; girinti tutarlı. ☐

### #17 — Manuel SOAP'ta SOAPAction boş gidiyor `Auto: —`
1. Manuel SOAP: URL `http://www.dneonline.com/calculator.asmx`, SOAP 1.1, SOAPAction `http://tempuri.org/Add`, gövde Add → Send.
2. **Beklenen:** `SOAPAction: "http://tempuri.org/Add"` (tırnaklı) gönderilir, AddResponse döner. ☐
3. SOAP 1.2 seç → **Beklenen:** Content-Type'ta `action="..."`, ayrı SOAPAction header'ı YOK. ☐

### #18 — Kaydedilen protokol isteği reopen'da kayboluyor `Auto: —`
1. SOAP/WebSocket/Socket.io/GraphQL/gRPC isteği oluştur, klasöre **kaydet**, **göndermeden** sekmeyi kapat, tekrar aç.
2. **Beklenen:** Tüm config (WSDL/URL/query/namespace/proto vb.) geri gelir. ☐

### #19 — WSSE Tool state sekme değişince sıfırlanıyor `Auto: —`
1. WSSE Tool'da değişiklik yap → başka sekmeye geç → geri dön. **Beklenen:** State korunur. ☐

### #20 — WSSE Tool butonlarında pointer cursor yok `Auto: —`
1. WSSE Tool'da Run/Send to active SOAP/Load sample/Clear + mod pill'leri üzerine gel. **Beklenen:** Pointer cursor. ☐

### #21 — Socket.io emit eventleri disconnect'te sıfırlanıyor `Auto: —`
1. Socket.io isteğinde emit event/payload + subscription ayarla → Connect → Disconnect.
2. **Beklenen:** Emit event/payload/subscription korunur. ☐

---

## C. Mock

### #29 — Mock template header lookup case-sensitive `Auto: ✓ mock-engine.test.ts`
1. Mock endpoint body: `{{request.headers.authorization}}`, `{{request.headers.Authorization}}`, `{{request.headers.AUTHORIZATION}}`.
2. `Authorization: Bearer x` ile istek at. **Beklenen:** Üçü de `Bearer x` döner. ☐

### #30 — Mock template hint'inde `{{request.query.x}}` yok `Auto: —`
1. Mock body editöründeki hint metnini oku. **Beklenen:** `{{request.query.x}} (query string)` ve `{{request.params.x}} (path param)` ayrı listeleniyor. ☐

### #28 — Mock endpoint silme dialog'u kötü tasarım `Auto: —`
1. Mock'ta bir endpoint'in çöp ikonuna tıkla. **Beklenen:** Native `confirm` değil, uygulamanın stilli DeleteConfirmDialog'u açılır. ☐

---

## D. Environment

### #13 — Secret env var Current Value'da açık `Auto: —`
1. Environment'ta secret tipli değişken oluştur, Initial Value gir, Current Value boş bırak.
2. **Beklenen:** Current Value sütununda secret açık görünmez (placeholder `••••••`). ☐

### #15 — Environment export edilemiyor `Auto: —`
1. Environment manager → bir env seç → **Export Environment**. **Beklenen:** Postman uyumlu `.json` kaydedilir; tekrar import edilebilir. ☐

### #10 — Request tab yokken Environment manager erişilemez `Auto: —`
1. Proje aç, hiçbir istek açma. Footer'daki environment göstergesine tıkla. **Beklenen:** Environment modal açılır. ☐

---

## E. Import / Export

### #9 — HAR import menüde yok `Auto: —`
1. APIs → Import → **HAR** kartı görünür. Bir `.har` dosyası seç + hedef klasör → import.
2. **Beklenen:** Endpoint'ler seçilen klasöre düşer. ☐

### #11 / #32 — Testnizer Native import boş klasör / endpoint düşüyor `Auto: —`
1. Bir projeyi/koleksiyonu **export** et. Import → **Testnizer Native** → seç.
2. **Beklenen (proje export'u):** Yeni proje oluşur ve içerik dolu, ona geçilir. ☐
3. **Beklenen (folder/koleksiyon export'u):** Mevcut projeye, seçilen hedefe endpoint'leriyle dolu gelir (boş klasör değil). ☐

### #12 — Insomnia query paramları URL'e yansımıyor `Auto: —`
1. Query param içeren bir koleksiyonu **Insomnia**'dan import et → ilgili isteği aç.
2. **Beklenen:** URL bar `?empNo={{...}}` gösterir (Postman ile aynı). ☐

### #38 — Export project / Clear history feedback yok `Auto: —`
1. Settings → Data → **Export project** ve **Clear history**. **Beklenen:** Başarı toast'ı görünür. ☐

---

## F. Branch & Git

### #8 — Branch içerik izolasyonu yok `Auto: ✓ branch-isolation.test.ts`
1. (Non-git proje) `test` branch oluştur, ona geç, `test-folder` ekle.
2. `main`'e geç. **Beklenen:** `test-folder` görünmez. Branching öncesi içerik her iki branch'te de görünür. ☐

### #35 — Branch silme success diyor ama silinmiyor `Auto: —`
1. Bir branch oluştur → sil. **Beklenen:** Listeden kalkar, tekrar seçilemez. ☐

### #36 — Clone from Git diske yazmıyor `Auto: —` (gerçek repo gerekir)
1. New Project → Clone from Git → repo URL + yerel dizin → tamamla.
2. **Beklenen:** Yerel dizinde `.git` + dosyalar oluşur; sonra Pull/Push çalışır. ☐

---

## G. Navigasyon / Header / Menü

### #1 — İkinci proje açınca ilki kapanıyor `Auto: —` (çekirdek; tık-turu önerilir)
1. Home'dan bir proje aç, sonra ikinci projeyi aç. **Beklenen:** Header'da Home | Proje A | Proje B; aralarında geçilebilir, her birinin sekmeleri korunur. ☐
2. Bir proje sekmesini × ile kapat → **Beklenen:** Diğer projeye/Home'a düşer, diğerinin sekmeleri durur. ☐

### #2 — Header Save file picker açıyor / feedback yok `Auto: —`
1. Header Save'e bas. **Beklenen:** Yapılandırılmış klasör varsa picker açılmaz, yeşil tik gösterir. Picker'ı iptal edersen Save modal'ı açılmaz. ☐

### #3 — Header'da kullanıcı/oturum menüsü yok `Auto: —`
1. Header sağ üstteki avatar butonuna tıkla. **Beklenen:** Lock (şifre varsa) / Set a password (misafir) / About menüsü. ☐

### #4 — APIs arama filtrelemiyor `Auto: —`
1. Arama kutusuna bir endpoint adı yaz. **Beklenen:** Ağaç case-insensitive filtrelenir, eşleşmeler açık; temizleyince tüm ağaç döner. ☐

### #5 — APIs New (+) menüsü eksik `Auto: —`
1. New (+) menüsünü aç. **Beklenen:** Quick Request, Import, Import cURL mevcut (protokollerin yanında). ☐
   *(Schema/Markdown/Folder/Module bu pas'ta kapsam dışı.)*

### #6 — APIs context menü Run/Export eksik `Auto: —`
1. Bir **klasöre** sağ tık. **Beklenen:** Run ve Export mevcut (iç içe klasörlerde de Export). ☐

### #14 — "Add Request" context menü çalışmıyor `Auto: —`
1. Klasöre sağ tık → Add Request → bir protokol seç. **Beklenen:** İstek o klasör altında oluşur (menü sessizce kapanmaz). ☐

### #37 — Accent color restart'ta sıfırlanıyor `Auto: —`
1. Themes → Accent Color seç (örn. pembe) → Save Changes → uygulamayı kapat-aç.
2. **Beklenen:** Accent color seçilen renkte kalır. ☐

---

## H. Paketleme & Güncelleme

### #33 — Windows kurulumda kısayol/ikon oluşmuyor `Auto: —` (Windows gerekir)
1. Windows'ta v1.4.7 installer'ı çalıştır. **Beklenen:** Masaüstü + Başlat Menüsü kısayolu oluşur, "yüklü program" olarak kayıtlı; her açılışta yeniden kurulum gerekmez. ☐

### #34 — Settings → Update başarısız `Auto: —` (imza kısıtı)
1. Settings → Update → güncelle. **Beklenen (mevcut mitigation):** Hata olursa **"En son sürümü manuel indir"** bağlantısı görünür; macOS imza hatası anlaşılır mesaja çevrilir.
   *(Tam otomatik güncelleme macOS'ta imzalı+notarize build gerektirir — ayrı iş.)* ☐

---

## Otomatik test özeti

```
npm run test:unit   # 1433 pass — tüm suite + bu sweep'in yeni testleri
```
Bu sweep'te eklenen issue-spesifik otomatik testler: **#8, #16, #22, #24, #25, #26, #29.**
Diğerleri typecheck + regresyon suite + bu dokümandaki manuel case'lerle doğrulanır.

**Manuel doğrulama özellikle gereken (çekirdek/dış-bağımlı):** #1, #8 (in-app), #33 (Windows), #34 & #36 (imza / gerçek repo).
