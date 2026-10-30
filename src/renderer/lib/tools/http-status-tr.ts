/**
 * Turkish names and descriptions for the HTTP Status Codes tool (issue #258).
 * The English reason phrase stays the primary name (it is what a response
 * line carries); the Turkish name is shown next to it in the Turkish UI.
 * Keyed by status code — every code in `HTTP_STATUS_CODES` has an entry
 * (guarded by tests/renderer/http-status-tr-258.test.tsx).
 */
export const HTTP_STATUS_TR: Record<number, { name: string; description: string }> = {
  100: {
    name: 'Devam',
    description: 'İsteğin ilk kısmı alındı; istemci isteğin geri kalanını göndermeye devam etmeli.',
  },
  101: {
    name: 'Protokol Değiştiriliyor',
    description:
      'Sunucu, istemcinin Upgrade başlığıyla istediği protokole geçiyor (örn. WebSocket).',
  },
  102: {
    name: 'İşleniyor',
    description: 'WebDAV: sunucu isteği aldı ancak henüz bir yanıt hazır değil.',
  },
  103: {
    name: 'Erken İpuçları',
    description:
      'Son yanıttan önce ön başlıkları (örn. Link: rel=preload) göndermek için kullanılır.',
  },
  200: { name: 'Tamam', description: 'Standart başarılı yanıt.' },
  201: {
    name: 'Oluşturuldu',
    description:
      'İstek başarılı oldu ve yeni bir kaynak oluşturuldu. Location başlığı onu gösterir.',
  },
  202: {
    name: 'Kabul Edildi',
    description: 'İstek işlenmek üzere kabul edildi; işlem eşzamansız olarak yürütülüyor.',
  },
  203: {
    name: 'Yetkili Olmayan Bilgi',
    description: 'Yanıt başlıkları aradaki bir proxy ya da dönüştürücü tarafından değiştirildi.',
  },
  204: {
    name: 'İçerik Yok',
    description: 'İstek başarılı oldu; yanıtın bilerek gövdesi yok.',
  },
  205: {
    name: 'İçeriği Sıfırla',
    description: '204 gibi, ancak istemci isteğe yol açan belge görünümünü sıfırlamalı.',
  },
  206: {
    name: 'Kısmi İçerik',
    description: 'Aralık isteği başarılı oldu; yalnız istenen bayt aralığı döndürülür.',
  },
  207: {
    name: 'Çoklu Durum',
    description: 'WebDAV: yanıt, birden çok ayrı durumu anlatan XML taşır.',
  },
  208: {
    name: 'Zaten Bildirildi',
    description: 'WebDAV: bağlamalar yanıtın önceki bir bölümünde zaten listelendi.',
  },
  226: {
    name: 'IM Kullanıldı',
    description: 'Sunucu GET isteğini bir ya da daha çok örnek dönüşümü uygulayarak karşıladı.',
  },
  300: {
    name: 'Çoklu Seçenek',
    description: 'Birden çok gösterim mevcut; istemci bunlardan birini seçmeli.',
  },
  301: {
    name: 'Kalıcı Olarak Taşındı',
    description: 'Kaynağın yeni ve kalıcı bir URL’si var; istemciler yer imlerini güncellemeli.',
  },
  302: { name: 'Bulundu', description: 'Kaynak geçici olarak başka bir URL’de.' },
  303: {
    name: 'Diğerine Bak',
    description: 'POST sonrasında istemciyi başka bir kaynağı GET ile almaya yönlendirir.',
  },
  304: {
    name: 'Değişmedi',
    description: 'Koşullu GET: önbellekteki kopya hâlâ geçerli.',
  },
  305: {
    name: 'Proxy Kullan',
    description: 'Kullanımdan kaldırıldı. Kaynağa belirtilen proxy üzerinden erişilmeli.',
  },
  307: {
    name: 'Geçici Yönlendirme',
    description: '302 gibi, ancak yönlendirme izlenirken istek yöntemi DEĞİŞMEMELİ.',
  },
  308: {
    name: 'Kalıcı Yönlendirme',
    description: '301 gibi, ancak yönlendirme izlenirken istek yöntemi DEĞİŞMEMELİ.',
  },
  400: {
    name: 'Hatalı İstek',
    description: 'Sunucu, istemci hatası (bozuk söz dizimi vb.) yüzünden isteği işleyemiyor.',
  },
  401: {
    name: 'Yetkisiz',
    description:
      'Kimlik doğrulama gerekli (ya da başarısız oldu). WWW-Authenticate başlığı ayarlanmalı.',
  },
  402: {
    name: 'Ödeme Gerekli',
    description: 'İleride kullanılmak üzere ayrıldı; üretimde nadiren görülür.',
  },
  403: {
    name: 'Yasak',
    description: 'Kimlik doğrulandı, ancak istemcinin bu kaynağa erişim izni yok.',
  },
  404: {
    name: 'Bulunamadı',
    description: 'Kaynak mevcut değil (ya da sunucu varlığını gizliyor).',
  },
  405: {
    name: 'Yönteme İzin Verilmiyor',
    description:
      'Hedef kaynak bu HTTP yöntemini desteklemiyor. İzin verilenler Allow başlığında listelenir.',
  },
  406: {
    name: 'Kabul Edilemez',
    description: 'Kaynak, Accept başlıklarına uygun bir gösterim üretemiyor.',
  },
  407: {
    name: 'Proxy Kimlik Doğrulaması Gerekli',
    description: '401 gibi, ancak kimlik doğrulama aradaki bir proxy’ye karşı yapılmalı.',
  },
  408: {
    name: 'İstek Zaman Aşımı',
    description: 'Sunucu isteği beklerken zaman aşımına uğradı.',
  },
  409: {
    name: 'Çakışma',
    description: 'İstek, kaynağın mevcut durumuyla çakışıyor (örn. sürüm uyuşmazlığı).',
  },
  410: {
    name: 'Kalıcı Olarak Gitti',
    description: 'Kaynak kalıcı olarak kaldırıldı ve bilinen bir yönlendirme adresi yok.',
  },
  411: {
    name: 'Uzunluk Gerekli',
    description: 'Content-Length başlığı zorunlu ancak gönderilmedi.',
  },
  412: {
    name: 'Ön Koşul Başarısız',
    description: 'If-Match / If-None-Match vb. başlıklardaki bir koşul sağlanmadı.',
  },
  413: {
    name: 'İçerik Çok Büyük',
    description: 'İstek gövdesi, sunucunun işlemeyi kabul ettiği boyutu aşıyor.',
  },
  414: {
    name: 'URI Çok Uzun',
    description: 'İstek URI’si sunucunun yorumlayabileceğinden uzun.',
  },
  415: {
    name: 'Desteklenmeyen Ortam Türü',
    description: 'İstek gövdesinin ortam türü kaynak tarafından desteklenmiyor.',
  },
  416: {
    name: 'Aralık Karşılanamıyor',
    description: 'Range başlığının değeri mevcut içerik aralığının dışında.',
  },
  417: {
    name: 'Beklenti Karşılanamadı',
    description: 'Expect başlığındaki beklenti sunucu tarafından karşılanamadı.',
  },
  418: {
    name: 'Ben Bir Çaydanlığım',
    description: 'RFC 2324 (1 Nisan şakası, 1998). Bazı API’ler “olmaz” demek için kullanır.',
  },
  421: {
    name: 'Yanlış Yönlendirilmiş İstek',
    description: 'İstek, yanıt üretemeyen bir sunucuya yöneltildi.',
  },
  422: {
    name: 'İşlenemeyen İçerik',
    description: 'İstek biçim olarak doğru ama anlam olarak geçersiz (örn. doğrulama hatası).',
  },
  423: { name: 'Kilitli', description: 'WebDAV: kaynak ya da hedef kaynak kilitli.' },
  424: {
    name: 'Başarısız Bağımlılık',
    description: 'WebDAV: istek, önceki bir isteğin başarısız olması yüzünden başarısız oldu.',
  },
  425: {
    name: 'Çok Erken',
    description: 'Sunucu, yeniden oynatılabilecek bir isteği işlemek istemiyor.',
  },
  426: {
    name: 'Yükseltme Gerekli',
    description: 'İstemci başka bir protokole geçmeli (hangisi olduğu Upgrade başlığında yazar).',
  },
  428: {
    name: 'Ön Koşul Gerekli',
    description: 'Kaynak sunucu isteğin koşullu olmasını istiyor (kayıp güncellemeleri önler).',
  },
  429: {
    name: 'Çok Fazla İstek',
    description:
      'Hız sınırı aşıldı. Retry-After başlığı ne zaman yeniden deneneceğini belirtebilir.',
  },
  431: {
    name: 'İstek Başlık Alanları Çok Büyük',
    description: 'Başlıkları çok büyük olduğu için sunucu isteği işlemek istemiyor.',
  },
  451: {
    name: 'Yasal Nedenlerle Kullanılamıyor',
    description:
      'Kaynak yasal talepler nedeniyle engellendi (RFC 7725; 451, Fahrenheit 451’e gönderme yapar).',
  },
  500: {
    name: 'Sunucu İç Hatası',
    description: 'Genel bir sunucu tarafı hatası: sunucuda bir şeyler ters gitti.',
  },
  501: {
    name: 'Uygulanmadı',
    description: 'Sunucu, isteği karşılamak için gereken işlevi desteklemiyor.',
  },
  502: {
    name: 'Hatalı Ağ Geçidi',
    description: 'Yukarı akıştaki bir sunucu ağ geçidine / proxy’ye geçersiz bir yanıt döndürdü.',
  },
  503: {
    name: 'Hizmet Kullanılamıyor',
    description: 'Geçici olarak aşırı yüklü ya da bakımda. Retry-After ayarlanmış olabilir.',
  },
  504: {
    name: 'Ağ Geçidi Zaman Aşımı',
    description: 'Ağ geçidi / proxy, yukarı akıştan zamanında yanıt alamadı.',
  },
  505: {
    name: 'HTTP Sürümü Desteklenmiyor',
    description: 'İstekte kullanılan HTTP sürümü sunucu tarafından desteklenmiyor.',
  },
  506: {
    name: 'Varyant da Müzakere Ediyor',
    description: 'Şeffaf içerik müzakeresi döngüsel bir başvuruyla sonuçlandı.',
  },
  507: {
    name: 'Yetersiz Depolama',
    description: 'WebDAV: sunucu isteği tamamlamak için gereken gösterimi depolayamıyor.',
  },
  508: {
    name: 'Döngü Algılandı',
    description: 'WebDAV: sunucu isteği işlerken sonsuz bir döngü algıladı.',
  },
  510: {
    name: 'Genişletilmedi',
    description: 'Sunucunun isteği karşılaması için isteğe ek uzantılar gerekli.',
  },
  511: {
    name: 'Ağ Kimlik Doğrulaması Gerekli',
    description:
      'Ağ erişimi için istemcinin kimlik doğrulaması yapması gerekli (örn. captive portal).',
  },
}
