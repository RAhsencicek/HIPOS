# Kasa MVP — Elle test rehberi

Ön koşul: yerel PostgreSQL çalışıyor, `CashDbContext` migration'ı uygulanmış ve `demo:seed:cash` tamamlanmış olmalı. Komutlar yalnız `localhost` üzerindeki `hipos_features` veritabanını hedefler. API/panel geliştirme önizlemesidir; gerçek POS veya ödeme bağlantısı değildir.

## Başlatma

1. README'deki kasa bölümüne göre migration ve seed komutlarını çalıştırın. Seed'i ikinci kez çalıştırmak vardiya/hareket sayılarını artırmamalı.
2. `HIPOS-Baslat.command` dosyasını çalıştırıp paneli açın; bu script kasa HTTP sağlayıcısını etkinleştirir.
3. **Kasalar → Kasa Özeti** sayfasında PostgreSQL kaynağı, POS'un bağlı olmadığı ve başlangıçtaki geçmiş vardiyaların kurgusal örnek olduğu açıkça görünmeli.

## Gerçek panel akışı

1. Kasa Özeti'nde kapalı vardiya durumunu ve “Vardiyayı aç” formunu görün. Örneğin `1.000,00` TL açılış tutarı girin. İşlem sonrası vardiya açık olmalı, beklenen nakit `1.000,00 TL` görünmeli.
2. Açık vardiyada `250,00 TL` nakit satış toplamı girişi yapın. Beklenen tutar `1.250,00 TL` olmalı.
3. Aynı vardiyada `50,00 TL` işletme gideri çıkışı girin. Beklenen tutar `1.200,00 TL` olmalı.
4. **Vardiyalar / Açılış-Kapanış** sayfasına geçip `1.190,00 TL` fiziksel sayım yapın. Fark açıklaması olmadan kapatmayı deneyin; backend'in açıklama zorunluluğu hatası görünmeli. Açıklama ekleyip tekrar kapatın; `-10,00 TL` fark geçmişte saklanmalı.
5. **Kasa Hareketleri** alanında açılış, giriş ve çıkışı doğru yönleriyle görün. Kapanış farkı ekstra nakit hareketi oluşturmamalı.
6. Aynı kasa modülünü **Ayarlar → Modüller ve Özellikler** alanından kapatıp sayfayı yenileyin. Geçmiş okunmalı; yeni vardiya/hareket başlatılamamalı. Açık vardiya varken kapatmayı denerseniz güvenli kapanış tamamlanabilmeli.
7. Test POS'taki simüle nakit/kart sonucu kasa bakiyesini değiştirmemeli.

## Beklenen kapsam uyarıları

- Vardiya nakit satış toplamı yönetici tarafından elle girilir; adisyonlara veya test ödeme simülatörüne otomatik bağlı değildir.
- Kart, yemek kartı, karma ödeme, iade, banka mutabakatı, mali belge, kupür bazlı sayım ve yetki rolleri bu dilimde yoktur.
- Açılış/geçmiş örnek kayıtları kurgusaldır; bu rehberde yaptığınız yeni kayıtlar yerel PostgreSQL'e kalıcı yazılır.
- Hareketler silinemez veya düzenlenemez. Yanlış bir test girdisini “düzeltmek” için yeni ters/düzeltme akışı bu MVP'de henüz yoktur; geliştirme veritabanında kabul testi bittikten sonra seed geçmişini silmeye çalışmayın.

Otomatik PostgreSQL/API/panel kabulü: `npm run test:db`.
