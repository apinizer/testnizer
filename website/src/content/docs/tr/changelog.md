---
title: Sürüm Notları
description: Testnizer için sürüm notları ve versiyon geçmişi.
order: 5
section: Referans
---

Her Testnizer derlemesi etiketlenir ve burada kayıt altına alınır. Bu
sayfa, sürüm açıklamaları için kaynak referansıdır — CI release job'u her
girdiyi karşılığı olan [GitHub Release](https://github.com/apinizer/testnizer-releases/releases)
sayfasına aynalar; imzalı yükleyiciler ve SHA-256 sağlama toplamları
orada eklenir.

## v1.4.10

**v1.4.9 üzerine iki takip düzeltmesi — Home sayfası içe aktarmadan sonra
yenileniyor ve klasör Run aksiyonu Tests genel görünümü yerine doğrudan
çalıştırmayı açıyor.**

- **İçe aktarma:** bir projeyi içe aktarmak artık görünmesi için uygulama
  yeniden başlatma gerektirmiyor — Home sayfasındaki proje listesi içe
  aktarma biter bitmez yenileniyor.
- **Runner:** bir klasöre sağ tık **Run** artık o klasörün endpoint'lerine
  scope'lu çalıştırmayı (çalışmaya hazır run config) açıyor; genel Tests
  görünümüne düşmüyor.

## v1.4.9

**v1.4.8'de yeniden raporlanan dört sorun için takip düzeltmeleri —
klasör dışa/içe aktarma, klasör Run aksiyonu, Windows yükleyici kısayolu
ve macOS güncelleme yolu.**

- **İçe/dışa aktarma:** kaydedilmiş isteklerden oluşan bir koleksiyonu dışa
  aktarıp **Testnizer Native** ile geri içe aktarmak artık kayıpsız. Klasör
  dışa aktarımı yalnızca yapısal endpoint'leri topluyor, ad-hoc kaydedilmiş
  istekleri sessizce düşürüyordu, bu yüzden koleksiyon boş geliyordu.
- **Runner:** APIs ağacında bir klasöre sağ tık **Run** artık runner'ı açıp
  yaşadığı Tests sayfasına geçiyor; eskiden APIs görünümünün arkasında
  görünmez açılıyordu — hiçbir şey olmamış gibi görünüyordu.
- **Windows:** yükleyici artık Başlat Menüsü ve Masaüstü kısayollarını
  açıkça oluşturuyor; kurulum sonrası her zaman bir başlatma noktası var,
  yükleyici `.exe`'yi tekrar çalıştırmaya gerek kalmıyor.
- **macOS güncellemeleri:** macOS derlemesi imzasız olduğundan
  electron-updater kendini kuramıyor; güncelleme penceresi artık macOS
  kullanıcılarını her zaman başarısız olan Download & Install düğmesi yerine
  doğrudan manuel indirmeye yönlendiriyor (açıklamasıyla). Gerçek
  uygulama-içi otomatik güncelleme Apple imzalama + notarization gerektirir.

## v1.4.8

**v1.4.7 kullanıcı raporlarının geniş bir taraması — istek ayarları,
SOAP taşıması, mock şablonlama, içe/dışa aktarma, branch izolasyonu ve
çoklu proje sekmeleri — tüm açık raporları kapatır.**

- **İstek ayarları:** istek bazlı **Settings** sekmesi artık gerçekten
  motora ulaşıyor — timeout (0 = sınırsız), max redirects, follow
  redirects ve SSL doğrulaması proje varsayılanlarına düşmek yerine
  istek başına uygulanıyor. URL çubuğu ile **Params** sekmesi çift yönlü
  senkron (param eklenince URL güncellenir; URL'e query yazılınca Params
  dolar). `Shift+F` body'yi formatlıyor ve `{{değişken}}` vurgusu artık
  caret'i kaydırmıyor.
- **Protokoller:** WSDL'den üretilen istek gövdeleri `http://tempuri.org/`
  yerine servisin gerçek target namespace'ini kullanıyor; manuel SOAP
  isteği SOAP Action'ı sürüme uygun yerde gönderiyor (1.1 için tırnaklı
  `SOAPAction`, 1.2 için Content-Type içinde `action="…"`). Kaydedilen
  SOAP / WebSocket / Socket.IO / GraphQL / gRPC istekleri yeniden
  açılınca tüm durumlarını geri yüklüyor; Socket.IO disconnect'te emit +
  subscription'ları koruyor; WS-Security aracı sekme değişiminde durumunu
  koruyor.
- **Mock sunucular:** yanıt şablonlama istek header'larını
  büyük/küçük harf duyarsız çözüyor, body ipucu query paramları için
  `{{request.query.x}}` belgeliyor ve silme onayı uygulamanın stilli
  diyaloğunu kullanıyor.
- **İçe / dışa aktarma:** HAR import menüde; Insomnia query paramları
  artık Postman gibi URL'de görünüyor; Testnizer-native import içeriği
  doğru yere yerleştiriyor (proje export → yeni proje, folder export →
  mevcut projeye); ve environment Postman uyumlu olarak dışa
  aktarılabiliyor.
- **Branch & projeler:** API ağacı içeriği branch başına izole (bir
  branch'te oluşturulan içerik diğerine sızmıyor), branch silme gerçekten
  siliyor ve **birden çok proje sekmesi açık kalıyor** — projeler arası
  geçiş öncekini kapatmıyor.
- **Navigasyon & ayarlar:** APIs arama kutusu ağacı filtreliyor; sağ tık
  **Run** / **Export** ve **Add Request** çalışıyor; New (+) menüsüne
  Quick Request / Import eklendi; header'a oturum menüsü (kilitle / şifre
  belirle / hakkında) eklendi; Environment yöneticisi istek açık
  olmadan erişilebilir; secret environment değişkenleri maskeli kalıyor;
  Themes accent rengi yeniden başlatmada korunuyor; ve Export project /
  Clear history başarı bildirimi gösteriyor.
- **Güncelleme & paketleme:** güncelleme kendiliğinden uygulanamadığında
  (örn. imzasız macOS build) diyalog daha net bir mesajla manuel-indirme
  bağlantısı sunuyor; Clone-from-Git depoyu diske yazıyor; ve Windows
  installer kısayol yapılandırması sağlamlaştırıldı.

## v1.4.7

**v1.4.4 kullanıcı bug listesinin kapsamlı taranması — Auto Update,
save akışı, Test Suite runner, importer'lar, her protokol editörü ve
credential persistence güvenlik sıkılaştırması.**

- **Auto Update:** Settings → Update'teki sürüm notları artık ham
  `<h2>…</h2>` kaynak metni yerine biçimlendirilmiş HTML (başlık,
  liste, kod) olarak render ediliyor — modal içinde changelog'u
  gizleyen bir DOMPurify interop regression'ı düzeltildi. Windows
  yükleyici akışı, `quitAndInstall` aslında istisna fırlattığında
  artık başarı bildirmiyor; IPC yanıtı hatayı modal'a geri taşıyor,
  böylece kullanıcı asılı kalmış "yeniden başlatılıyor…" yerine
  gerçek bir hata mesajı görüyor. `update-downloaded` olayı ayrıca
  disk üzerindeki yükleyici yolunu post-mortem destek için
  loglıyor.
- **File menüsü ve klavye:** File → New Tab / Close Tab / Save /
  Import… / Export… öğelerinin her biri artık gerçek aksiyonu
  tetikliyor — önceden bunların üçü hiçbir dinleyicisi olmayan ölü
  bir custom-event'e ateşleyip hiçbir şey yapmıyordu. `Ctrl+T` ve
  `Ctrl+W` artık çift fire etmiyor: menü accelerator'u ve pencere
  keydown dinleyicisi aynı kombinasyona bağlıydı, bu yüzden bir tab
  açmak gerçekten iki tab açıyordu. Menü etiketleri platforma uygun
  modifier'ı gösteriyor (`Cmd+T` macOS'ta, `Ctrl+T` Windows/Linux'ta).
  Menüden Close Tab artık kaydedilmemiş değişiklikler için uyarıyor
  ve tab'a özel protokol state'ini temizliyor — Workbench içindeki
  `Ctrl+W` yolu ile eşleşiyor.
- **Save akışı:** Önceden kalıcı hale gelmiş bir istek üzerinde
  `Ctrl+S` artık satırı yerinde günceller; aktif tab bir Test Suite
  item ise APIs'e duplicate request oluşturan folder-picker modal'ı
  açılmıyor. SOAP, Socket.IO, gRPC, WebSocket ve SSE istekleri tüm
  editör state'lerini (WSDL URL / namespace / proto path / custom
  header / composer şablonu / event-type filter / metadata) DB'ye
  yazıyor ve yeniden açıldığında geri yüklüyor — tab kapatmak
  artık sizi bir sonraki açılışta boş editör'e bırakmıyor.
- **Test Suite ve Runner:** "Create Test Suite from this folder"
  kaynak endpoint'in varsayılan case'inin params, headers, body ve
  auth alanlarını her yeni suite item'a taşıyor; böylece istekler
  açıldığında boş gelmiyor. NULL olan varsayılan-case sütunları
  endpoint'in template değerlerini boş fallback ile ezmek yerine
  olduğu gibi bırakıyor. Basic auth credentials artık runner
  geçişinde gösterilen URL'e sızmıyor — Authorization header
  üzerinden taşınıyor (RFC 7617) ve Run Results Request tab'ı
  gönderilen header'ı gerçekten gösteriyor. Header assertion'ları
  (`Header exists` / `equals` / `contains`) büyük/küçük harf
  duyarsız arama, boşluk trim ve `[k, v]` çiftleri vs.
  `Record<string, string>` farkını simetrik şekilde normalize
  ediyor. Tests sidebar'ındaki Import butonu artık Test Suite
  import sihirbazını açıyor — önceden APIs sihirbazını açıyor,
  type-mismatch banner'ı ile suite export'larını reddediyordu.
  Code → cURL / JS / Python snippet üreticileri URL, header, body
  ve binary path'teki `{{var}}` placeholder'larını çözüyor; snippet
  yapıştırmaya hazır geliyor. All Runs → run detayı bir sekme
  değişiminden sağ çıkıyor — sonuç paneli geri dönüldüğünde
  boşalıyordu çünkü snapshot persist edilmiyordu.
- **Importer'lar:** RAML dosyaları (`.raml`) native file picker'da
  seçilebilir ve `!include` direktifleri artık YAML parser'ı
  çökertmiyor — direktif string placeholder olarak korunuyor, tam
  include resolution sonraki iş olarak duruyor. Testnizer-native
  export'ları doğru `kind: "project" | "folder" | "testSuite"`
  şekli altında tespit ediliyor ve "JSON, native değil"
  reddedilmek yerine native importer'a yönlendiriliyor.
- **Protokoller:** Bir folder'a sağ tıklayıp Add Request →
  protokol seçici artık isteği gerçekten oluşturuyor, başarısızlık
  durumları sessizce yutulmak yerine toast ile yüzeye çıkıyor. SOAP
  → WS-Security Tool → "Send to active SOAP" imzalı zarfı doğru
  tab'a enjekte edip isteği gönderiyor (tab-state race'i eski bir
  SOAP tab'ını hedef olarak bırakıyordu). GraphQL Introspect
  şemasız URL'leri (`localhost:4000/graphql`) handle ediyor,
  varsayılan `Content-Type: application/json` ekliyor, boş URL'e
  karşı koruma sağlıyor ve URL hâlâ çözülmemiş `{{var}}`
  placeholder içeriyorsa `http://` eklemiyor — kullanıcı yanıltıcı
  bir DNS hatası yerine "değişken tanımsız" görüyor.
- **History ve credential hijyeni:** Test sonuçları, console
  log'ları ve yakalanan `actualRequest` snapshot'ı geçmiş bir satır
  yeniden açıldığında geri yükleniyor; böylece `pm.test()`
  verdict'leri Tests pane'ine geri geliyor. `user:pass@host`
  userinfo'su her persist edilen URL'den temizleniyor — history
  tablosu, request snapshot ve Run Results gösterimi — v1.4.6'da
  URL bar'daki credentials'ı sonsuza dek SQLite'ta bırakan sızıntı
  kapatıldı. Zaten userinfo taşıyan eski satırlar restore anında
  sanitize ediliyor.
- **Internals:** `cleanupTabState` ve `stripUrlCredentials` paylaşılan
  helper'lara taşındı; böylece menü / klavye / runner / engine
  yolları aynı teardown ve aynı credential-strip mantığını
  kullanıyor. Yeni bir `save-active-request` helper'ı her protokol
  store'unun snapshot'ını tek bir yerde topluyor, böylece Save As
  modalı ile yerinde Ctrl+S yolu yeni protokol eklendiğinde
  birlikte hareket ediyor. `header_contains`, `header_equals`'ın
  trim semantiğine uyduruldu. RunnerTab run-snapshot restore'u
  `useState` lazy initializer'lara taşındı; böylece MB ölçeğinde
  bir `JSON.parse` artık her render'da çalışmıyor.

## v1.4.6

**Tüm APIs Import formatları yanlış-dosya-tipi girdisini artık sessizce
boş klasör oluşturmak veya kafa karıştıran "şu alan eksik" mesajları
vermek yerine tek tutarlı hatayla reddediyor.**

- **Postman, Insomnia, SoapUI, cURL, Testnizer-native:** her
  importer önce girdinin kendisinden istenen formatla eşleştiğini
  doğruluyor. Eşleşmeyen her şey aynı tek satırı alıyor: *"Bu dosya
  bir {format} değil. Bu dosya tipini buradan yükleyemezsiniz."*
  Hayalet klasör yok, çapraz bulaşma yok, "aynı yanlış dosya için
  altı farklı validasyon ipucu" tahmin oyunu yok.
- **Postman:** standalone environment export'larını
  (`_postman_variable_scope: environment`) ve v2.x collection
  olmayan rastgele JSON dosyalarını reddediyor. Postman v1 yine
  kendi "v2.1 olarak yeniden export edin" ipucunu alıyor.
- **Insomnia:** v5 environment YAML dosyalarını reddediyor.
  Endpoint'lerle birlikte environment de içeren Insomnia v4
  collection'ları çalışmaya devam ediyor — v4 request-şeklinde,
  environment'lar yan yolculuk.
- **SoapUI:** ilk 4 KB'sinde `<con:soapui-project ...>` kök
  elementi olmayan her şey reddediliyor. Diğer XML / JSON / YAML
  dosyaları artık project parser'a kadar ulaşamıyor.
- **cURL:** `curl ` ile başlamayan girdi reddediliyor (önündeki
  shell prompt `$ ` tolere ediliyor). Bir JSON dosyası bırakmak
  eskiden parser'ın muğlak "no URL found" mesajına çarpıyordu;
  artık tutarlı yanlış-dosya-tipi hatasını alıyor.
- **Testnizer-native project:** "şu alan eksik" altı farklı dalı
  tek bir generic hataya indirgendi ve artık `kind: "project"`
  zorunlu — bir Postman / Insomnia / SoapUI / vs. dosyası native
  importer'a bırakıldığında tutarlı şekilde fail ediyor. Şekli
  doğru ama gerçekten boş olan export'lar yine kendi "kaynak
  projeyi yeniden export edin" ipucunu alıyor — dosya şeklinin
  doğru ama bayat olduğunu kullanıcı görüyor.
- **Environment-only import'lar** çalışmaya devam ediyor — sadece
  doğru giriş noktasına yönlendirildi. Environments modalindeki
  Import aksiyonu artık yeni `import:postmanEnvironment` /
  `import:insomniaEnvironment` IPC handler'larını çağırıyor;
  bunlar yalnızca env dosyalarını kabul ediyor ve sadece
  environments tablosuna dokunuyor.

## v1.4.5

**Hotfix: Windows update akışı artık uygulamayı sessizce kaldırmıyor.**

- **Updater quitAndInstall:** Windows installer artık `isSilent: false`
  ile çalıştırılıyor — NSIS wizard'ı görünür durumda ilerliyor,
  başarısızlık varsa hata dialogu açık çıkıyor. v1.4.4'te sessiz
  install, eski sürümün uninstall adımı tamamlandıktan sonra
  başarısız olabiliyordu; sonuç olarak kullanıcı tamamen kaldırılmış
  bir uygulama, hiçbir UI ve hiçbir teşhis ipucu bulmadan kalıyordu —
  tek belirti Start Menu / Desktop kısayolunun kaybolmasıydı. Wizard
  artık tamamlanana kadar açık kalıyor; kullanıcı gerçekte ne
  olduğunu görüyor ve gerektiğinde raporlayabiliyor.
- **Custom NSIS hook kaldırıldı:** v1.4.3'te "Missing Shortcut"
  dialogu için eklenen `build/installer.nsh` cleanup macro'ları
  build'e dahil edilmiyor artık. Sessiz install başarısızlığının
  şüpheli katkıcılarından biriydi. NSIS artık electron-builder'ın
  varsayılan install/uninstall akışını yerel eklenti olmadan
  kullanıyor.
- **NSIS `oneClick: false`:** Tek tıklamalı sessiz install yerine
  standart çok adımlı wizard'a geçildi. Kullanıcılar update sırasında
  install ilerlemesi + tamamlama ekranını görüyor; bu hem hataları
  yüzeye çıkarıyor hem de upgrade sürecine tanıdık bir şekil veriyor.

## v1.4.4

**Hotfix: OpenAPI 3 import beyaz ekranı + updater hata mesajı
görünürlüğü + top-level error boundary.**

- **OpenAPI import (beyaz ekran düzeltmesi):** Query/header
  parametrelerinde sayısal default'u olan (örn.
  `page: { schema: { type: integer, default: 1 } }`) bir OpenAPI 3
  dosyası import edildiğinde, kullanıcı listelenen ilk request'e
  tıkladığı an renderer bembeyaz kalıyordu. Sayı doğrudan
  `saved_requests.params[].value` alanına yazılıyordu; tab
  açıldığında KeyValueTable bu değere yalnızca string olarak
  çağrılabilecek API'leri (`isInsideVariableExpression`, suggestion
  filter) uyguluyor, `TypeError` fırlatıyor ve tüm React ağacını
  unmount ediyordu. Bozuk state localStorage'da kaldığı için
  uygulama her açılışta aynı crash'i tekrarlıyordu. Import artık
  default'u string'e dönüştürüyor: string ise olduğu gibi,
  null/undefined ise boş string, object ise JSON-stringified,
  diğerleri `String()` ile.
- **Top-level ErrorBoundary:** Yakalanmayan herhangi bir render
  crash'i artık boş pencere yerine bir recovery panelinde
  sonuçlanıyor. Panel üç seçenek sunuyor: Reload, "UI state'i
  sıfırla ve reload et" (localStorage + sessionStorage temizleniyor
  ama SQLite veritabanı — projeler, request'ler, environment'lar,
  sertifikalar, history kayıtları — olduğu gibi kalıyor) ve hatayı
  panoya kopyala. Bu sayede önceki sürümlerde crash yaşamış
  kullanıcılar kendi kendine kurtulabiliyor.
- **Updater hata görünürlüğü:** "Update check failed" artık tek
  başına detaysız çıkmıyor. Renderer'ın updater store'u yalnızca
  Promise-reject hatalarını yakalıyordu; IPC handler ise hata
  durumunda `{success:false, error:'...'}` ile resolve ediyor —
  böylece gerçek sebep (network, feed yapılandırılmamış, GitHub
  rate-limit) atılıyordu. Store artık sonucu inceleyip gerçek
  mesajı `errorMessage`'a basıyor; modal bunu kullanıcıya gösteriyor.

## v1.4.3

**İkinci test turu bug temizliği — updater, import, tests workbench,
script motoru, WSSE, GraphQL, history ve Windows installer'da 23
iyileştirme.**

- **Updater modali:** Release notları artık ham `<h2>` / `<p>` / `<ul>`
  metni yerine düzgün HTML olarak render ediliyor (DOMPurify ile
  temizleniyor). GitHub Releases'tan electron-updater'ın getirdiği
  içerik aslında Markdown değil HTML; eskiden modal bunu JSX text
  node olarak basıyordu. Birden fazla sürüm atlayan kullanıcılar
  (örn. v1.4.1 → v1.4.3) için `ReleaseNoteInfo[]` payload'ı
  birleştiriliyor; sadece en son sürüm değil, aradaki tüm bloklar
  görünüyor.
- **Windows updater:** "Missing Shortcut: Testnizer.exe değiştirilmiş
  veya taşınmış" hatası giderildi. Özel bir `installer.nsh` betiği
  electron-builder yeni kısayolları oluşturmadan önce eski Desktop /
  Start Menu / Quick Launch kısayollarını proaktif olarak siliyor.
  NSIS `differentialPackage` bayrağı kapatıldı; in-place patch yerine
  her seferinde tam uninstall + install yapılıyor.
- **Script motoru:** `pm.execution.skipRequest()` çağrısı artık pre-
  request script'i gerçekten durduruyor — sonraki kodlar çalışmıyor.
  Eskiden sadece bayrak set ediliyordu, kod akmaya devam ediyordu
  (Postman'in dokümante davranışıyla çelişiyordu). Senkron kesinti
  sentinel error mekanizmasıyla sağlanıyor.
- **Import:**
  - **Insomnia v4 environment export'ları** gerçek `environments`
    satırları + variables olarak persist ediliyor. v4 sadece
    `suggestedEnvVars`'a düşüyordu, Environment Manager'a hiç
    yansımıyordu — kullanıcı "Imported" toast'ı görüp boş listeye
    bakıyordu.
  - **Swagger 2.0 (OpenAPI v2)** istek body'leri artık boş gelmiyor:
    `parameters[].in='body'` schema'dan JSON örneği üretiyor,
    `in='formData'` form-data tablosunu her form alanıyla doldurarak
    getiriyor. petstore tarzı import'larda "This request does not
    have a body" yerine kullanılabilir bir başlangıç payload'ı
    görünüyor.
  - **Test suite re-import'larında** aynı native export, `X`,
    `X (1)`, `X (2)` suffix'leriyle eklenir; iki suite aynı isimle
    yan yana durmaz. (Postman/Insomnia kolunda zaten vardı, native
    branch'te eksikti.)
- **Tests workbench:**
  - Run-results Request sekmesi artık engine'in hat üzerine gerçekten
    koyduğu header / body / URL'i gösteriyor (Content-Type, Host,
    User-Agent, Auth sekmesinden gelen Authorization, query
    parametreleri URL'e gömülmüş halde). Önceden sadece kullanıcının
    elle eklediği header'lar listeleniyordu; auth token'ı ve content
    pazarlığı eksik gözüküyordu.
  - Bir suite item'ı düzenleyip kaydedip tab'ı kapat-aç yaptığınızda
    artık taze DB içeriği yükleniyor, pre-edit cache değil. Per-tab
    `_tabStates` cache'i orijinal snapshot'ı tutup DB okumasını
    bastırıyordu.
  - URL bar'dan istek kaydederken aktif tab'ın method / url / protokol
    chip'i de senkronize ediliyor — GET → POST değişikliği tab'a
    anında yansıyor, kapat-aç gerektirmiyor.
  - Tab'in method tipini değiştirip kaydetmek artık badge'i anında
    güncelliyor.
  - All Runs'tan bir run aç, başka tab'a geç, geri dön → detay paneli
    artık boşalmıyor. Seçili sonuç id'si tab'in sessionStorage'ıyla
    persist ediliyor.
  - APIs tree sağ tık → Add Request artık parent folder'ı otomatik
    expand ediyor — kullanıcı kapalı bir folder'a istek eklediğinde
    yeni request'i anında görüyor.
- **Save dialog'u:** SOAP / WebSocket / SSE editör'ündeki bir istek
  folder'a kaydedilirken artık gerçek protokol payload'ı persist
  ediliyor — eskiden modal yalnızca HTTP istek store'unu okuyup
  sessizce boş `protocol: 'http'` satırı ekliyordu. Her protokolün
  store'u save sırasında danışılıyor, protokole özgü meta veri
  (WSDL URL, seçili operation, WS-Security ayarları) yeni `metadata`
  kolonuyla round-trip ediyor.
- **Save modal scrollbar'ı:** Uzun folder listesi scrollbar belirince
  tüm dialog'u kaydırmıyor — `scrollbar-gutter: stable` boşluğu
  rezerve ediyor, layout net kalıyor.
- **Response pane:** Response Body toolbar'ındaki iki işlevsiz ikon
  (Search + Open-in-new-tab) kaldırıldı — Filter zaten substring /
  JSONPath aramayı kapsıyor, ikinci buton hiç bağlanmamıştı.
- **Console pane:** Console başlığındaki Layout (maximize) butonu
  artık çalışıyor. Response-pane in-tab görünümünde tıklayınca
  console'u alt panele yükseltiyor; alt panel içinden tıklayınca
  kullanıcı boyutu ile ~%78-viewport maksimize görünüm arasında
  toggle ediyor.
- **File menüsü:** Native File menüsünde önceden sadece "Exit"
  vardı. Artık New Tab (⌘/Ctrl+T), New Window, Import…, Export…,
  Save, Settings…, Close Tab ve Exit listeniyor; hepsi yeni
  `menu:*` IPC kanalı üzerinden ilgili in-app aksiyonlara bağlı.
- **Help / About:** Privacy Policy ve EULA footer'larındaki "Source
  repository" artık **public** olan `apinizer/testnizer-releases`
  repo'sunu işaret ediyor (private kaynak repo'su kullanıcıya 404
  döndürüyordu). Posta adresi İstanbul yerine Ankara olarak
  düzeltildi.
- **WSSE aracı:** "Send to active SOAP" artık hem imzalı envelope'ı
  SOAP tab'ına enjekte ediyor HEM istek gönderiyor; tek tıkla beklenen
  tam el sıkışma gerçekleşiyor. Eskiden body sessizce güncelleniyor,
  hat üstüne hiçbir şey gitmiyordu.
- **GraphQL Introspect:** Gerçek introspection hataları (HTTP
  hataları, bozuk JSON, `errors[]` body, eksik `data` alanı) artık
  schema panel'inde gerçek hata mesajı olarak görünüyor. Önceki
  fallback sessizce hatayı sabit kodlu bir demo schema ile değiştir-
  iyordu; kullanıcılar endpoint sorgularının neden çalışmadığını
  anlayamıyordu.
- **History:**
  - Today / runner-history yan paneli her runner-history folder
    grubunu ilk göründüğünde otomatik expand ediyor; suite-run
    satırları manuel tıklamadan görünüyor.
  - Suite-run isteğine tıklayınca response body / headers /
    body-size detayı görünüyor. History `response_snapshot` kolonu
    eskiden sadece `status` / `statusText` / `timing` persist
    ediyordu; detay paneli boş kalıyordu.
- **Code paneli:** Resolve edilemeyen `{{var}}` placeholder'ları
  cURL / JS / Python snippet'inin üstünde küçük turuncu bir banner
  olarak gösteriliyor ("Unresolved: {{employee_body}}") —
  kullanıcılar istek tarafından referans verilen ama aktif
  environment'da bulunmayan değişkenleri anında görüyor.
- **Iç işleyiş:** http-engine error testindeki DNS-hata assertion'ı
  bazı resolver'ların `.invalid` host için aldığı `ECONNABORTED`
  timeout yolunu da kabul edecek şekilde genişletildi; environment'a
  bağımlı CI flake giderildi.

## v1.4.2

**Legacy TLS desteği, Postman-eşdeğeri Console, v1.4.1 test turunun tüm bug'ları kapatıldı.**

- **Legacy TLS (1.0 / 1.1) kurumsal backend'leri yeniden konuşuyor.**
  TLS 1.0 veya 1.1 zorunlu tutan bankacılık, kamu ve sigorta API
  gateway'leri kutudan çıkar çıkmaz erişilebilir: Testnizer Settings →
  Certificates'te protokol pini'ni tespit edip request'i platforma
  özel bir bundle edilmiş statik `curl` binary'sine (~3MB) route
  ediyor; bu da işletim sisteminin TLS yığınını kullanıyor. Sistemde
  curl kurulu olmasına gerek yok — binary her installer'ın içinde
  geliyor, `PATH`'ten `curl.exe` çıkarılmış kilitli Windows imajları
  dahil. Legacy handshake için cipher suite otomatik olarak
  `DEFAULT@SECLEVEL=0`'a düşüyor; dropdown etiketleri yönlendirme
  yolunu açıkça gösteriyor ("TLS 1.0 — via system curl"). Modern TLS
  1.2/1.3 hâlâ hızlı axios path'inde, ek yük yok.
- **Scripting:** `pm` API, Postman script'lerinin beklediği yüzeyi
  kazandı. `pm.request` artık pre-request scope'unda doluyor (önceden
  method / URL / header'lar boştu); `pm.request.headers`
  case-insensitive bir koleksiyon: `add` / `upsert` / `remove` /
  `get` / `has` / `each`; pre-request mutasyonları wire'a gitmeden
  önce outgoing request'e dahil ediliyor. `pm.environment.has` /
  `.unset` ve `pm.globals.has` / `.unset` eklendi.
  `pm.execution.skipRequest()` artık gerçekten request'i iptal
  ediyor. Pre-request script'inde `pm.response`'a erişim, phantom bir
  shell yerine açıklayıcı hata fırlatıyor. AWS SigV4 / HMAC / webhook
  imzalama için `CryptoJS` built-in script global'i olarak sunuluyor.
- **Import:** Insomnia v5 YAML environment export'ları doğru import
  ediliyor — EnvironmentModal v5 şeklini ham metinden tespit edip
  main process'in YAML importer'ına yönlendiriyor. Postman + Insomnia
  env import'ları artık iç katman hatalarını (proje bulunamadı,
  eksik alan) yüzeyliyor; eskiden false-positive "imported" toast'ı
  görünüyordu. Project import'ları, workspace'te aynı isimde proje
  varsa `(imported)` / `(imported N)` suffix ekliyor. Folder/project
  export'ları başarı toast'ı ve net hata mesajı gösteriyor.
- **Tests workbench'i:** Overview, All Runs ve Scheduled Tasks
  sekmelerindeki "New Run" butonu, aynı stil ile paylaşılan tek bir
  component ve hepsinde aynı Test Suite seçici dropdown'unu açıyor.
  Proje içindeki her endpoint'i listeleyen eski APIs-tree seçici
  kaldırıldı — Test Suite'ler giriş noktası artık. Rastgele sekme
  geçişlerinde kullanıcı artık 200 endpoint gösteren scope'suz config
  view'a düşmüyor (eski `sessionStorage` view restore guard'ı
  eklendi). Runner iteration gruplama her iteration'ı kendi açılır
  grubu olarak gösteriyor; "New Run" tıklamasındaki beyaz ekran
  düzeldi.
- **Console:** Her request/response döngüsü için tek bir açılır kayıt
  (Postman ile aynı). Genişletildiğinde Network meta'sı, Request
  Headers, Request Body, Response Headers, Response Body ve Script
  Logs tek bir satırda gösteriliyor. Response pane'inde aynı veriyi
  tekrarlayan iki kırpılmış sekme ("Console" + "Actual") kaldırıldı.
  Network / Timings tablolarını gösteren globe popover'ı artık
  Console panelinin arkasına geçmiyor — portal'a alındı ve aşağıda
  yer kalmadığında otomatik yukarı açılıyor.
- **Branches:** Settings → Branches `main`'i doğru listeliyor
  (branch seeding'inden önce oluşturulmuş projelerde eksikti) ve aynı
  anda yalnızca tek bir active branch gösteriyor (iki active sorunu
  giderildi).
- **History:** History sayfasındaki bir kayda tıklamak onu tab'da
  açıyor — hem HTTP hem SOAP girdileri doğru yönlendiriliyor. Yeni
  tab gerçekten görünür olsun diye sidebar APIs'e geçiyor (eskiden
  yeni tab sessizce açılıyor ama History welcome ekranı yerinde
  kalıyordu).
- **Windows updater:** Start Menu / Desktop kısayollarını koruyan
  sessiz tek tıklı güncellemeler. Differential paketleme update
  download boyutunu yalnızca değişen block'lara indiriyor. "Problem
  with Shortcut: 'Testnizer.exe' has been changed or moved" diyaloğu
  düzeldi — kurulumlar UAC olmadan kullanıcı başına
  `%LOCALAPPDATA%\Programs\Testnizer` yoluna gidiyor. v1.4.1'den
  v1.4.2'ye ilk geçişte hâlâ eski wizard bir kez görünüyor (kurulu
  uninstaller v1.4.1'in NSIS'i); v1.4.2'den itibaren yeni sessiz akış
  devralıyor.
- **Internals:** macOS x64 CI runner'ı `macos-13`'ten (ölü pool,
  job'lar 10+ saat kuyrukta) `macos-14`'e `--x64` cross-build ile
  taşındı. Scheduler test DB şeması production migration'larıyla
  senkronlandı. `pm.request.headers` storage'ı RFC 7230
  case-insensitive semantik'e yeniden yazıldı. Bundled curl 8.20.0,
  OpenSSL 4.0 backend ile.

## v1.4.1

**Zamanlanmış Görevler Test Suite üzerine inşa edildi, kenar çubuğu rötuşları, yerel Hakkında.**

- **Zamanlanmış Görevler:** "New Run" butonu artık bir Test Suite
  seçici açıyor — zamanlamalar tasarım gereği Test Suite'lere ait,
  dolayısıyla ad-hoc APIs endpoint seçici kaldırıldı. Her görev
  satırı genişletildiğinde içindeki endpoint'leri (method rozetleri
  + ad + URL) ve son on çalışmayı (Ne Zaman / Sonuç / Test / Süre)
  gösteriyor. Satır başına bir "Run now" butonu görevi sonraki
  döngüyü beklemeden tetikliyor.
- **Schedule Configuration** Interval / Daily / Weekly / Cron
  modları kazandı. Daily / Weekly yerel saatle `HH:MM` alır; Weekly
  bir haftanın günü çip seçici ekler; Cron canlı doğrulamayla 5
  alanlı bir ifade alır. Scheduler timer her çalışmanın ardından
  sonraki tetiklemeyi yeniden hesaplıyor, böylece daily / weekly /
  cron sapma yapmıyor.
- **Runner config:** "Schedule runs" radyosu yalnızca run bir Test
  Suite kaynaklıysa görünüyor. APIs ağacı ve klasör çalışmaları
  tek seferlik — radyoyu orada gizlemek, kimsenin nerede bulacağını
  bilmediği "Scheduled: ad-hoc" görevlerin oluşmasını engelliyor.
  Tests kenar çubuğuna ilk geldiğinde artık 200 endpoint'lik runner
  yapılandırma ekranı yerine Tests Overview açılıyor.
- **Kenar çubuğu:** Hem APIs hem Tests kenar çubuklarında "+" New
  butonunun yanına ayrı bir Import butonu eklendi. Bir format
  seçince Import wizard'ı eski iki-tık "modal aç, sonra format seç"
  yolu yerine doğrudan 2. adımda açılıyor. Format listesi logo
  grid'ini bıraktı (cURL / RAML / WSDL gerçek logoya sahip değildi,
  ad iki kez yazılıyordu) ve yerine kategorili bir liste geldi
  (Specs / Collections / Quick). Tüm kenar çubuğu aksiyon butonları
  28×28'e ve aynı ikon boyutu / kalınlığa standardize edildi; Mocks
  paneli daha önce 26×26 idi. History kenar çubuğu başlığı 44px'e
  yükseltilerek diğer panellerle hizalandı.
- **Ağaç sağ tık:** Endpoint sağ tık menüsü "Bu istekten Test Suite
  oluştur" ve "Bu istekten Mock Sunucu oluştur" kazandı; oluşan
  suite veya mock isteğin adını otomatik alıyor. Klasör sağ tık
  menüsündeki Run girdisi kaldırıldı — Send tek endpoint için
  yeterli, Test Suite çoklu endpoint için.
- **İçe / Dışa aktar ikonları:** Yön uygulama genelinde düzeltildi
  — İçe aktarım için Download (aşağı ok, sisteme), dışa aktarım
  için Upload (yukarı ok, dışarı). Tests paneli context menüsü,
  Proje Hub ana ekran butonu ve Environment modali etkilendi.
- **Alt bar + yerel Hakkında:** Footer'daki Runner bağlantısı
  kaldırıldı (Tests kenar çubuğundaki Overview / All Runs /
  Scheduled Tasks girdileri açıkça kapsıyor). Enterprise butonu
  artık panoya kopyalanabilir e-posta adresli bir uygulama içi
  modal açıyor — gövde lisanslama, lokal kurulum ve özel desteği
  kapsıyor. macOS "About Testnizer" menü öğesi artık Electron'un
  varsayılan paneli (atom logosu + framework sürümü) yerine bizim
  markalı About modalimizi açıyor.
- **Console paneli:** Toolbar'daki ölü üç-nokta butonu kaldırıldı —
  click handler'ı yoktu ve Auto / Clear aksiyonlarının üzerine
  biniyordu. Toolbar'a sağ padding eklendi, böylece panelin
  kapatma butonuyla çakışmıyor.
- **İçeride:** `runner_history`'ye `scheduled_task_id` eklendi,
  böylece görev başına geçmiş, görev yeniden adlandırılsa bile
  korunuyor. `scheduled_tasks`'a `schedule_type`, `schedule_time`,
  `schedule_days`, `schedule_cron` ve `suite_id` sütunları eklendi
  (ek — eski satırlar 'interval' yolunda kalır). Yeni
  `scheduler:history`, `scheduler:runNow`,
  `scheduler:taskEndpoints` ve `scheduler:validateCron` IPC
  handler'ları yeni UI'a güç veriyor. About öğesinin
  bağlanabilmesi için varsayılanın yerine geçen özel bir macOS
  uygulama menüsü eklendi. CI, her derlemeden önce eski artifact,
  cache ve workflow run'larını boşaltan yeni bir `cleanup` job'u
  kazandı; artifact saklama süresi 90 günden 1 güne düştü —
  Actions depolama kotası release derlemelerini öldürüyordu.

## v1.4.0

**Üç ekipli QA turu: script'ler tekrar çalışıyor, dışa aktarım round-trip yapıyor, Test Suite dürüst.**

- **Script'ler:** Pre-request ve post-response script'leri tekrar
  çalışıyor — v1.3.1 `new Function()`'ı bloke eden bir CSP gönderdi,
  bu yüzden her `pm.*` script'i sessizce "Refused to evaluate a
  string as JavaScript" ile patladı. Renderer CSP'si artık
  kullanıcı tarafından yazılmış script'ler için `'unsafe-eval'`'a
  izin veriyor. `pm.expect` zinciri eksik Chai-BDD bağlayıcılarını
  anlıyor: `.that`, `.with`, `.is`, `.and`, ayrıca `.empty` ve
  `.lengthOf(n)`. `pm.expect(res.errors).to.be.an('array').that.is.empty`
  gibi assertion'lar artık response gerçekten eşleştiğinde geçiyor.
  Scripts ve Tests sekmeleri, script veya assertion mevcut
  olduğunda Auth sekmesinin konvansiyonuyla uyumlu yeşil-nokta
  göstergesi kazandı. Scripts Kılavuzu modali Ctrl/Cmd+A'yı odaktaki
  snippet'in içine kapatıyor — tüm diyaloğu seçmek yerine.
- **Yedekleme & Geri yükleme:** Export Project artık projenin
  verisi yüklenmediğinde 200 byte'lık stub yazmayı reddediyor. Dışa
  aktarım yükü bir sayım özeti (klasör / endpoint / environment /
  suite / mock) döndürüyor — UI bunu bir toast'ta gösteriyor — ve
  içe aktarıcı boş kabukları "Invalid project file format" yerine
  spesifik bir hatayla reddediyor. Bir projeyi Export → Import
  üzerinden round-trip yapmak uçtan uca tekrar çalışıyor.
- **Test Suite:** Form-data gövdeleri üretilen cURL'da görünüyor.
  cURL snippet'leri `{{variable}}` placeholder'larını aktif
  environment karşısında resolve ediyor — kelimesi kelimesine
  emitlemek yerine. Suite import'ları aynı isimli bir suite zaten
  projede varsa `(1)`, `(2)`… ekleyerek otomatik
  ayrıştırıyor. Test Suite Import → Insomnia artık `.yaml` /
  `.yml` dosyalarını kabul ediyor (Insomnia v5 export şekli).
  Insomnia v5 environment YAML'leri v4 yoluna düşmek yerine
  ayrı bir importer'a yönleniyor. Runner sekmesi singleton —
  "Run"'a üç kez sağ tıklamak artık üç hayalet runner sekmesi
  bırakmıyor. Suite-item sağ-tık menüsü dışarı tıklamayla
  kapanıyor. Runner geçmiş snapshot'ı artık çözülmüş header'ları,
  query param'ları, body önizlemesini ve auth tipini içeriyor;
  böylece run detaylarındaki Request paneli kabloda gerçekten ne
  gittiğini yansıtıyor. Sağ-tık "Run" yolu otomatik başlatmak
  yerine runner yapılandırma görünümünü açıyor ve runner
  sekmesinin aktif görünümü (config / results / history) sekme
  değişimleri arasında korunuyor.
- **İçe / Dışa aktarım:** Postman içe aktarımları başıboş "New
  Request" placeholder öğelerini (URL boş + varsayılan ad)
  atlıyor. Klasör dışa aktarım dosya adları projenin display
  name'ini kullanıyor ve duplike `folder-` prefix'ini bırakıyor;
  v1.3.1 `folder-folder-2026-mm-dd.json` dosya adı gitti.
  Format seçici, bir export'u yeni proje olarak yüklemek için
  `save:importProjectFromContent`'i yeniden kullanan bir
  "Testnizer Native" girdisi kazandı. Import → cURL dosya
  seçicinin yanına kod modunda bir textarea sunuyor. SoapUI
  importer'ı `con:operation`'a ek olarak `con:resource` /
  `con:method` ağaçlarını dolaşıyor; böylece SoapUI 5.x
  projelerindeki REST endpoint'ler boş interface klasörlerinde
  kaybolmuyor.
- **Environment içe aktarımları:** Postman environment ve
  Insomnia v4 environment içe aktarımları artık aktif-environment
  seçicisine yayılıyor — içe aktarma başarı toast'ı artık
  yalan söylemiyor.
- **Branch UX:** Bir branch oluşturmak otomatik olarak ona
  geçiyor (VS Code / IntelliJ / GitKraken ile uyumlu). Branch
  dropdown'u git fetch boş döndüğünde bile mevcut branch'i
  listeliyor; böylece pill ve menü uyuşuyor.
- **Project Hub:** Wizard avatar baş harfleri Details
  önizlemesi ile Storage Settings özet kartı arasında tutarlı
  — ikisi de `display_name`'i çekiyor, Storage Settings'in
  slug'dan baş harf türetmesine izin vermek yerine. `Cmd/Ctrl+P`
  Project Hub'ı açıyor. Header proje rozeti kullanıcıları aynı
  kısayola yönlendiren bir tooltip kazandı ve tıklamayla ana
  ekrana gidiyor — v1.3.1 "MP avatar hiçbir şey yapmıyor" UX
  şikayetini gideriyor. Bir klasöre sağ tıklamak artık tek bir
  transaction'da gerçek bir sunucu tarafı deep clone (alt
  klasörler, endpoint'ler, kaydedilmiş istekler) tetikliyor;
  Project Hub `…` menüsü aynı export → import-as-new pipeline'ı
  ile desteklenen bir Duplicate öğesi kazandı.
- **Kenar çubuğu:** Ağaç kök etiketi projenin slug'ı yerine
  display name'ini gösteriyor. Proje kökü üzerinde ağaç sağ
  tıklaması "Bu projeden Test Suite oluştur" / "Bu projeden Mock
  Sunucu oluştur" okuyor (ayrı i18n anahtarları; EN + TR
  aynası). Proje kökünü dışa aktarmak `save:exportFolder` yerine
  `save:exportProject` üzerinden yönleniyor; böylece JSON doğru
  şekilde `kind: 'project'` taşıyor. Klasör çoğaltma artık
  özelliğin henüz bağlı olmadığını açıklayan net bir toast
  gösteriyor — sessizce hiçbir şey yapmak yerine. APIs welcome
  ekranında en son beş istek tek tıklamalı kartlar olarak durum
  rengi, method rozeti ve "Xm ago" mührüyle render ediliyor.
- **APIs ↔ Tests ↔ Mocks round-trip'leri** kullanıcıyı welcome
  ekranına atmak yerine önceden odaklı sekmeyi geri yüklüyor.
  Tabs store kenar çubuğu sayfası başına son aktif sekmeyi
  yer imine alıyor.
- **Commit history kenar çubuğu:** History kenar çubuğu aktif
  projenin branch'i için git commit'lerini listeleyen bir
  "Commits" sekmesi kazandı — endpoint Save aksiyonları artık
  kullanıcıların beklediği yerde görünüyor.
- **Sertifikalar:** Project Settings modali'nin Save Changes
  butonu kayıttan sonra modali gerçekten kapatıyor. TLS 1.0 /
  1.1 sürüm dropdown'larında "desteklenmiyor" olarak
  işaretlendi ve runtime'da BoringSSL varsayılanına açıkça
  zorla çevriliyor; böylece bunları seçmek artık
  `ERR_SSL_INVALID_COMMAND` ile patlamıyor — seçenek zaten
  yanlış reklamcılık olarak vardı.
- **Hakkında:** Sürümünü `package.json`'dan okuyor (derleme
  zamanında paketlenmiş) ve fallback olarak
  `app.getVersion()` ile; böylece diyalog artık Electron
  framework'ünün `1.0.0` placeholder'ını göstermiyor.
- **Cmd/Ctrl+S** protocol alanı sekme durumuna yayılmadan
  önce bile aktif endpoint / kaydedilmiş istek / suite öğesi
  sekmesini proje kayıt modali yerine tercih ediyor.
- **Header autocomplete:** Substring eşleşmesi — "type"
  yazmak "Content-Type"'ı tekrar yüzeye çıkarıyor. Prefix
  eşleşmeleri en üstte kalıyor.
- **Değişkenler:** Runner tarafı Variables paneli
  `type: secret` değerlerini düz metinle göstermek yerine
  `••••••••` ile maskeliyor.
- **Durum çubuğu:** `ui.store.setStatusMessage(text, ttlMs)`
  merkezi, otomatik temizlenen bir status mesaj slotu
  sağlıyor; böylece bayat banner'lar alaka düzeylerinin
  ötesine geçemiyor.
- **Yeni endpoint baseline'ı:** Sekme şeridindeki "+ New" ve
  her welcome kartı her protokol store'unu
  `activeTabId`'daki bir Workbench efekti ile boş durumuna
  çeviriyor. Daha önce taze bir sekme son endpoint'in URL /
  param / script'lerini miras alıyordu. Scripts sekmesindeki
  "+ Insert example" butonu artık her zaman görünür durumda,
  ilk tuş vuruşunda kaybolmak yerine snippet'i ekliyor.
- **HTTP timing breakdown** soket yaşam döngüsü olayları
  (`lookup`, `connect`, `secureConnect`) artı axios'un
  `onDownloadProgress`'i üzerine yeniden inşa edildi —
  TTFB / download ayrımı için. TLS handshake HTTPS istekleri
  için doldurulmuş; download süresi body stream'ini yansıtıyor.
- **İçeride:** Tab durum cache'i sınırlandırıldı — request
  store, 20 cache'lenmiş sekmeden sonra en eski girdileri
  tahliye ediyor; böylece uzun oturumlar sınırsız sekme başı
  durum biriktirmiyor. Chai zinciri, TLS sürüm validatörü,
  header autocomplete substring semantiği,
  `validateProjectExport` (7 senaryo), Postman placeholder-
  öğe filtresi ve Insomnia v5 environment YAML importer'ı
  için regresyon kapsamı eklendi.

## v1.3.1

**Her yerde içe aktarım, Script Kılavuzu ve derin denetim turu.**

- **İçe Aktarımlar:** Tests panelindeki Import butonu artık doğrudan OS
  dosya seçicisini açmak yerine bir format-seçim modali (Testnizer /
  Postman v2.x / Insomnia v4-v5) açıyor. APIs tarafındaki içe aktarıcı,
  Insomnia 8'in tüm doküman alt türlerini (`collection`, `spec`, `proxy`
  — daha önce "bilinmeyen format" olarak reddediliyordu) kabul ediyor;
  `js-yaml` fallback'i sayesinde Insomnia v5 YAML dışa aktarımları
  JSON'a çevrilmeden hem endpoint hem test paketi olarak içe aktarılıyor.
  44 testlik fixture denetimi, 18 gerçek Insomnia dışa aktarımı + bir
  Postman + SoapUI fixture'ını uçtan uca sürüyor.
- **Environment'lar:** Environment modalindeki dedicated Import butonu
  Postman environment dosyalarını ve Insomnia dışa aktarımlarını alır,
  Postman koleksiyonlarını dostane bir mesajla APIs yoluna yönlendirir,
  tanınmayan dosyalar için net hata toast'ı verir.
- **Script'ler:** Hem Scripts tab'ında (Pre / Post varyantları) hem de
  Tests tab'ının Post-response Script bölümünde "?" Script Kılavuzu
  modali açılıyor — 4-6 kopyalanabilir snippet, 15 satırlık `pm.*` API
  tablosu, ve alias / async / scope / console üzerine notlar.
- **Header UX:** Value-cell autocomplete artık Accept, Cache-Control,
  Connection, Authorization, X-Requested-With ve diğerlerini kapsıyor;
  hücre boş olsa bile focus üzerine açılıyor ve popup hücre DIV'ine
  bağlanıyor — eskiden ekran dışına render oluyordu. Variable
  Autocomplete (`{{var}}`) aynı hücrede çalışıyor.
- **Runner Sonuçları:** Request ve Response panelleri artık standart HTTP
  mesaj sırasına uyuyor — status / headers üstte, body altta — ve Request
  tab'ı Method + URL'i özet başlık olarak gösteriyor.
- **Test Suite item'ları** tamamen self-contained (copy-on-add): kaynak
  endpoint silinse bile suite boşalmıyor. Bir suite item'a tıklamak
  artık her zaman onun editörünü Tests sayfasında açıyor (item'ları
  sessizce APIs'a sızdıran routing bug'ı düzeltildi).
- **Komut Paleti:** `Cmd+K` `cmdk` tabanlı bir palet açıyor — endpoint,
  recent, tool, mock server ve settings kategorileri. `?` klavye
  kısayolu cheat-sheet'i açıyor.
- **Toast + a11y:** `sonner` toast bildirimleri, EmptyState bileşenleri
  panel'ler arasında genişletildi ve her özel modal Radix Dialog
  wrapper'a taşındı — ESC + focus-trap + dışına tıklama ile kapanma.
- **İptal edilebilir istekler:** Her protokol (HTTP, SOAP, WebSocket,
  GraphQL, gRPC, SSE, Socket.IO, MCP) artık in-flight Cancel tıklamasına
  saygı duyuyor ve main process'te işi durduruyor.
- **About sayfası** EN ve TR'de düzgün label'lar (Version / Platform /
  Electron / Node / Chrome / License) gösteriyor — daha önce ham i18n
  anahtarları görünüyordu.
- **Page-aware workbench:** Tab strip aktif sidebar sayfasına scope'lu;
  sayfa değişimi tab oraya ait değilse aktif tab'ı temizliyor ve boş
  workbench her sayfanın doğru welcome ekranını gösteriyor (APIs'ta
  ProjectWelcome, Tests'te TestsHome, Mocks / History / Tools'ta
  EmptyState).
- **Düzeltmeler:** İçe aktarımlar kaynak sayfada kalıyor (APIs import'tan
  sonra otomatik Tests'e geçiş yok). Pre-script / post-script `pm.test()`
  sonuçları visual assertion'larla tek bir `response.testResults`
  array'inde birleşiyor. Postman environment dosyaları Postman import
  yolundan seçildiğinde doğru algılanıyor. `Cmd+S` aktif tab'ı kaydediyor.
- **Dahili:** IPC handler tiplemeleri sıkılaştırıldı, renderer-side `any`
  cast'ları kaldırıldı. Main-process handler'larında her renderer-sağlı
  path doğrulandı. RCE / path-traversal advisory'leri için `simple-git`
  3.36.0'a ve `fast-uri` 3.1.2'ye yükseltildi. Pre-release migration
  kodu kaldırıldı. Project export → import artık environment ve global
  değişkenler için `project_id` foreign key'ini koruyor (eskiden sessizce
  düşüyordu). Yinelenen import format dedektörleri temizlendi. 250+ test
  eklendi — IPC handler'lar, suite çoklu-format import, project export
  round-trip, header value önerileri, sayfa routing, cert + mTLS pipeline
  ve `BADSSL_NETWORK=1` ile gate'lenmiş opt-in BadSSL network suite.

## v1.3.0

**Git iş birliği ve geçmiş kapsamı.**

- `git merge` ve `git pull` çakışmaları için yan yana **Benimkini kullan
  / Onlarınkini kullan** seçici eklendi — endpoint, mock server, test
  suite ve environment için öğe-sayısı özetleriyle.
- Çoklu dosya çakışmaları için dosya başına sekme stripi, locale-aware
  commit mesajları ve çakışmayı iptal etme desteği eklendi.
- Mock Server, mock endpoint, mock response ve istemci sertifikaları
  `git push / pull / branch-switch` round-trip'ine alındı — önceden
  yalnızca DB'deydi, branch değişimi mock konfiglerini sessizce
  düşürüyordu.
- İstek geçmişi her protokol için kaydedilmeye başlandı: SOAP, GraphQL,
  gRPC unary, WebSocket / SSE / Socket.IO (bağlantı seviyesi) ve MCP
  tool çağrıları. History paneli artık aktif projeye scope'lu tam
  tabloyu gösteriyor.
- macOS giriş ekranındaki About butonunun traffic-light kümesinin altına
  girmesi düzeltildi.
- **Dahili:** Çakışma sırasında `git.show` okumaları paralelleştirildi,
  IPC'den ölü payload temizlendi, disk-import helper'ı tekilleştirildi,
  çakışma çözücü için 13 unit test eklendi.

## v1.2.0

**Mock Server ve Tools workbench genişlemesi.**

- **Mock Server:** `127.0.0.1`'e bağlı, çoklu instance destekli gerçek
  bir HTTP sunucusu eklendi.
- Endpoint eşleştirme için exact, param, wildcard ve regex modları
  desteklendi.
- Header, query, path-param, body-JSONPath, body-XPath ve method üzerinde
  koşullu yanıtlar uygulandı; `and` / `or` kompozisyonu desteklendi.
- Handlebars ve dinamik-değer template'leme, 5 saniyelik `vm`
  sandbox'ında pre-response JavaScript ve sunucu bazlı in-memory state
  eklendi.
- Bearer / Basic / API-key auth (endpoint-bazlı override), draft-07
  JSON Schema gövde doğrulaması, hata enjeksiyonu, sliding-window rate
  limit, ince-ayar CORS, `/__echo` endpoint'i ve opsiyonel recording'li
  proxy passthrough eklendi.
- OpenAPI 3 ve Postman v2 içe aktarma desteklendi. Copy / Copy as cURL
  / Open butonlu tam URL barı ve canlı istek log'u eklendi.
- **Tools workbench:** 17 offline araç yayınlandı — JWT debugger yeniden
  yazıldı (Decoder + Encoder sekmeleri, JSON / Table görünümü, her
  algoritma için Generate example), karakter düzeyinde intra-line vurgulu
  yan yana diff, Hash ve HMAC hesaplayıcıları (RFC vektörleri), Epoch
  dönüştürücü, HTTP status kodu referansı, sayı tabanı dönüştürücü
  (ASCII / Bin / Oct / Dec / Hex), JSON Schema üretici, JSON ↔ XML
  dönüştürücü, UUID üretici (v1 / v4 / v5 / v7), cheatsheet'li Regex
  tester ve YAML ↔ JSON dönüştürücü.
- JSONPath, XPath, Jolt ve XSLT için 17 hazır örnek bundle'landı.

## v1.1.1

**Runner, test motoru, console ve import iyileştirmeleri.**

- **Collection Runner:** Multi-iteration koşumu düzeltildi, açılabilir
  sonuç satırlarına Request / Response / Tests sekmeleri eklendi,
  skipped-count doğrulandı.
- **`pm` test motoru:** Async `pm.test()` artık bekleniyor, `pm.expect()`
  chain getter düzeltildi, `pm.info.requestName` dolduruluyor,
  `jsonBody(path)` uygulandı.
- **AI Chat:** Uç nokta URL'si her zaman görünür hale getirildi, 14
  sağlayıcı 2026 model kataloguyla yenilendi.
- **Console:** gRPC trailers, WS / SSE / Socket.IO / MCP handshake
  header'ları, event başına timing ve sizing eklendi; filter dropdown
  tamamlandı.
- **Import / export:** GraphQL gövdesi Postman ve Insomnia round-trip'te
  korundu, HAR disabled flag'ı dikkate alındı.
- **Kurumsal:** Kurumsal iletişim About modal, Footer ve EULA'ya eklendi.
  EULA, no-maintenance ve air-gap maddeleriyle güncellendi.

## v1.1.0

**MCP, Socket.IO ve Postman pariteliği.**

- MCP (Model Context Protocol) ve Socket.IO protokol desteği eklendi.
- Postman script ve collection variable import'u eklendi.
- gRPC reflection desteklendi (v1 ve v1alpha).
- Sekme kalıcılığı ve `Cmd+T` / `Cmd+W` kısayollu IDE-tarzı sağ-tık
  menüsü eklendi.
- `pm` ve `t` test API'si genişletildi.

## v1.0.3

- WS-Security çalışma tezgahı iyileştirildi.
- SOAP arayüz hataları düzeltildi.
- Açık sekmeler tekilleştirildi.

## v1.0.2

- gRPC tam akış desteği eklendi.
- GraphQL abonelikleri eklendi.

## v1.0.1

- İçe aktarma formatları genişletildi: HAR, Insomnia v4, SoapUI.

## v1.0.0

- İlk kamuya açık sürüm.
