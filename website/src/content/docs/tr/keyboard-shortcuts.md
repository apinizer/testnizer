---
title: Klavye kısayolları
description: İstek gönderme, sekme yönetimi, kenar çubuğunda gezinme ve araçları açma için varsayılan klavye kısayolları.
order: 2
section: Referans
---

Tüm varsayılan kısayollar aşağıda listelenmiştir. Bir kısayol işletim sistemine
göre farklılık gösterdiğinde, macOS tuşu önce, Windows / Linux karşılığı ise
ardından gösterilir.

---

## İstekler

| Eylem | macOS | Windows / Linux |
|---|---|---|
| İstek gönder | `Cmd+Enter` | `Ctrl+Enter` |
| İsteği kaydet | `Cmd+S` | `Ctrl+S` |
| Mevcut sekmeyi çoğalt | `Cmd+D` | `Ctrl+D` |
| Mevcut sekmeyi kapat | `Cmd+W` | `Ctrl+W` |
| İşlemdeki isteği iptal et | `Cmd+.` | `Ctrl+.` |

---

## Gezinme

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Yeni sekme | `Cmd+T` | `Ctrl+T` |
| Sonraki sekmeye geç | `Cmd+]` | `Ctrl+]` |
| Önceki sekmeye geç | `Cmd+[` | `Ctrl+[` |
| Numarasına göre sekmeye geç (1–9) | `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` |
| URL çubuğuna odaklan | `Cmd+L` | `Ctrl+L` |
| Sol kenar çubuğuna odaklan | `Cmd+Shift+E` | `Ctrl+Shift+E` |
| Sol kenar çubuğunu aç/kapat | `Cmd+B` | `Ctrl+B` |

---

## Araçlar

| Eylem | macOS | Windows / Linux |
|---|---|---|
| JWT Hata Ayıklayıcı'yı aç | `Cmd+Shift+J` | `Ctrl+Shift+J` |
| JSON Biçimleyici'yi aç | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Diff görüntüleyiciyi aç | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Konsolu aç | `Cmd+Shift+C` | `Ctrl+Shift+C` |
| Ortam yöneticisini aç | `Cmd+Shift+N` | `Ctrl+Shift+N` |

---

## Kenar çubuğu — yeni istek

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Yeni HTTP isteği | `Cmd+Alt+N` | `Ctrl+Alt+N` |
| Yeni SOAP isteği | `Cmd+Alt+S` | `Ctrl+Alt+S` |
| Yeni WebSocket bağlantısı | `Cmd+Alt+W` | `Ctrl+Alt+W` |
| Yeni GraphQL isteği | `Cmd+Alt+G` | `Ctrl+Alt+G` |
| Yeni gRPC isteği | `Cmd+Alt+R` | `Ctrl+Alt+R` |
| Yeni SSE dinleyicisi | `Cmd+Alt+E` | `Ctrl+Alt+E` |

---

## Genel

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Komut paleti | `Cmd+K` | `Ctrl+K` |
| Ayarları aç | `Cmd+,` | `Ctrl+,` |
| Pencereyi yeniden yükle (yalnızca geliştirme) | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| DevTools'u aç (yalnızca geliştirme) | `Cmd+Option+I` | `Ctrl+Shift+I` |
| Yardım / belgeler | `F1` | `F1` |
| Testnizer'dan çık | `Cmd+Q` | `Alt+F4` |

---

## Notlar

- Yukarıda listelenen tüm kısayollar Testnizer ile birlikte gelen varsayılanlardır.
  Herhangi bir kısayolu **Ayarlar → Klavye kısayolları** bölümünden yeniden
  atayabilirsiniz.
- İşletim sisteminizde sistem genelinde bir kısayolla çakışan kısayollar, sistem
  kısayolu devre dışı bırakılana veya Testnizer bağlaması değiştirilene kadar
  çalışmayabilir.
- Komut paleti (`Cmd+K` / `Ctrl+K`), tüm eylemler üzerinde belirsiz arama kabul
  eder; böylece tam kısayolu hatırlamadan herhangi bir özelliği tetikleyebilirsiniz.
- Sekme numarası kısayolları (`Cmd+1` ile `Cmd+9`) açık sekmelerin soldan sağa
  görsel sırasını izler. `Cmd+9`, kaç sekme açık olduğundan bağımsız olarak
  her zaman son sekmeyi etkinleştirir.
