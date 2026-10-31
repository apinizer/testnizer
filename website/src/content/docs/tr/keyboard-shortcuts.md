---
title: Klavye kısayolları
description: İstek gönderme, sekme yönetimi, panelleri açıp kapatma ve içe aktarma için varsayılan klavye kısayolları.
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
| İstek gönder (MCP sekmesinde tool / resource / prompt'u çalıştırır) | `Cmd+Enter` | `Ctrl+Enter` |
| İsteği kaydet | `Cmd+S` | `Ctrl+S` |
| Projeyi kaydet | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| İstek gövdesini biçimlendir | `Cmd+Shift+F` | `Ctrl+Shift+F` |
| Mevcut sekmeyi kapat | `Cmd+W` | `Ctrl+W` |
| Mevcut sekmeyi zorla kapat (kaydedilmemiş değişiklik sorulmaz) | `Cmd+Alt+W` | `Ctrl+Alt+W` |

---

## Gezinme

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Yeni istek sekmesi | `Cmd+N` | `Ctrl+N` |
| Yeni sekme | `Cmd+T` | `Ctrl+T` |
| Sonraki sekmeye geç | `Cmd+Alt+→` | `Ctrl+Alt+→` |
| Önceki sekmeye geç | `Cmd+Alt+←` | `Ctrl+Alt+←` |
| URL çubuğuna odaklan | `Cmd+L` | `Ctrl+L` |
| Sol kenar çubuğunu aç/kapat | `Cmd+B` | `Ctrl+B` |
| Proje Hub'ını aç | `Cmd+P` | `Ctrl+P` |

---

## Paneller ve pencereler

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Konsolu aç/kapat | `Cmd+Alt+C` | `Ctrl+Alt+C` |
| Konsolu kapat | `Esc` | `Esc` |
| Yeni pencere | `Cmd+Shift+N` | `Ctrl+Shift+N` |

---

## Genel

| Eylem | macOS | Windows / Linux |
|---|---|---|
| Komut paleti | `Cmd+K` | `Ctrl+K` |
| Kısayol kılavuzunu göster | `?` | `?` |
| Ayarları aç | `Cmd+,` | `Ctrl+,` |
| İçe aktar | `Cmd+O` | `Ctrl+O` |
| cURL içe aktar (İçe Aktar penceresini açar) | `Cmd+I` | `Ctrl+I` |
| Pencereyi yeniden yükle | `Cmd+R` | `Ctrl+R` |
| Pencereyi zorla yeniden yükle | `Cmd+Shift+R` | `Ctrl+Shift+R` |
| DevTools'u aç/kapat | `Cmd+Option+I` | `Ctrl+Shift+I` |
| Testnizer'dan çık | `Cmd+Q` | `Alt+F4` |

---

## Notlar

- Burada uygulamanın yanıt verdiği kısayollar yer alır. Bunlar **Proje Ayarları
  → Kısayollar** bölümünde ve uygulama içi kılavuzda (`?` tuşu) salt okunur
  olarak listelenir; yeniden atanamazlar.
- İşletim sisteminizde sistem genelinde bir kısayolla çakışan kısayollar, sistem
  kısayolu devre dışı bırakılana kadar çalışmayabilir.
- macOS'ta Testnizer, menülerde, ipuçlarında ve komut paletinde kısayolları
  Apple sembolleriyle gösterir — örneğin `Cmd+Alt+C` ⌥⌘C, `Cmd+Alt+→` ise ⌥⌘→
  olarak görünür.
- Komut paleti (`Cmd+K` / `Ctrl+K`), tüm eylemler üzerinde belirsiz arama kabul
  eder; böylece tam kısayolu hatırlamadan herhangi bir özelliği tetikleyebilirsiniz.
- Yeniden yükle, Zorla yeniden yükle ve DevTools'u aç/kapat standart Electron
  **View** menüsünden gelir.
