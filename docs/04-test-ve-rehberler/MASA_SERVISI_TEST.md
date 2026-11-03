# Masa servisi — yerel elle test

Bu dilim geliştirme ortamı içindir. Önce [README](../../README.md) içindeki Feature, Catalog, Sales ve Service migration'larını; katalog ve servis seed'lerini kendi `hipos_features` veritabanınızda uygulayın. API'yi migration sonrasında yeniden başlatın. `HIPOS_DEMO_DATABASE_URL` olmadan seed çalışmaz.

Paneli `VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_SALES_PROVIDER=http VITE_SERVICE_PROVIDER=http npm run dev` ile açın. API varsayılan `127.0.0.1:5180` üzerinde olmalı. Panelde **Mahalle Fırını → Kadıköy Şubesi**, ardından **Şubeler ve Canlı Durum → Masa Planı** seçin.

1. `7/24 masada açık bağ` görünmeli. Boş masa 01'e tıklayın: “Bu masada açık adisyon yok.” yazmalı.
2. Dolu masa 12'ye tıklayın: Mehmet Kaya, Tavuklu Sandviç ×2, Ev Yapımı Limonata ×1, sipariş zamanı ve 645,00 ₺ toplam görünmeli. Diğer dolu masaları da açarak verinin masa bazında değiştiğini kontrol edin.
3. **Satışlar ve Adisyonlar → Açık Adisyonlar** ekranında `…9908` sonlu kurgusal self-servis siparişini de görebilirsiniz. Bu sipariş masa doluluğunu artırmaz. Satış ekranı masa/servis türünü ayrı alan olarak henüz göstermez; `9908` ayrımı yalnız demo sözleşmesinden bilinir.
4. **Ayarlar → Modüller ve Özellikler** içinde `staff.records`, `service.waiters` ve `branches.tables` durumunu kontrol edin. Masa servisini kapattığınızda garson ataması otomatik kapanmalı; satış ve personel kayıt modülleri açık kalmalı. Masa planında geçmiş kayıtlar okunmalı ancak yeni masa işlemleri görünmemeli. Personel kartları **Mutfak ve Servis → Personel** ekranından yönetilir; bu alanı doğrulamak için [personel MVP rehberini](../03-is-alanlari-ve-yonetim/PERSONEL_YONETIMI_MVP.md) izleyin.
5. API kapalı veya Service migration'ı eksikse ekranda veri varmış gibi boş/dolu masa uydurulmamalı; açık kurulum/bağlantı hatası görülmeli.
6. Garson ekranında (`/waiter`) boş masaya ilk siparişi gönderin. Aynı masa ve garsonla ikinci siparişi gönderin: iki sipariş aynı açık adisyonda bulunmalı, toplamları birleşmeli ve mutfak listesinde ayrı siparişler olarak görünmelidir. Her iki mutfak fişinde de aynı masa ve garson adı bulunmalıdır; masa okumasındaki `assignment.orderIds` bu masaya bağlı tüm sipariş kimliklerini içerir. Taşıma ve birleştirmeden sonra fişler güncel hedef masa adıyla görünmelidir. Aynı gönderim kimliğiyle tekrar denemek çift sipariş oluşturmamalıdır. Bu akışın yazma kapısı `sales.checks` özelliğidir; `sales.pos_orders` yalnız eski test POS uçlarını yönetir.

7. İki siparişli masada **Adisyon Böl** üzerinden ilk siparişin bütün kalemlerini seçin; kaynak adisyonda diğer sipariş kalsın. Bölme tamamlanmalı, ilk siparişin kimliği ve masa bağlantısı korunmalı, masa dolu kalmalı ve iki adisyonun toplamı önceki tutara eşit olmalıdır. Aynı isteği tekrar göndermek yeni adisyon üretmemeli; sonrasında aynı masaya yeni sipariş eklenebilmelidir. Miktar bazlı bölmede kalan adet, not ve tercihler de korunmalıdır.

Masa kapatma, adisyonu veya ödemeyi kapatmaz. Yönetim paneli bugün adisyonu masaya bağlamaz; bu işlem ayrı POS/servis API'sindedir. Garson kişi kartı çalışma süresi ya da performans verisi değildir. Gerçek kullanıcı girişi, yetki politikası ve canlı POS entegrasyonu pilot öncesi eksiktir.

Tekrarlanabilir otomatik testler: `npm run test:api`, `npm run test:db`, `npm run typecheck`. PostgreSQL testi geçici veritabanında masa bağlama, kapatma, şube izolasyonu, satış bağımsızlığı ve gerçek tarayıcıdaki masa ayrıntısını doğrular.

## Masa grubu elle test

1. Garson ekranında boş bir masa açın, **Masa Grubu Oluştur** seçin. Kişi sayısını 10 yapın, iki boş ek masa seçip onaylayın.
2. Masa listesine dönün: üç masa da **Grupta**, **3 masa · 10 kişi** olarak görünmeli. Sayfayı yenileyince grup korunmalı. Her üyeye dokununca aynı başlık ve ana masa açılmalı.
3. Garson seçip siparişi mutfağa gönderin. Üç masa aynı hesap toplamını göstermeli; mutfak fişinde üç masa adı birlikte bulunmalı. Ek sipariş aynı ana adisyona eklenmeli.
4. Sepete ürün ekleyin: grup işlemleri kapanmalı. Sepeti gönderin/boşaltın. Aktif grupta taşıma ve adisyon birleştirme kapalı kalmalı, adisyon bölme çalışmalı ve toplam değişmemeli.
5. **Grubu Ayır** açıklamasını onaylayın: ek masalar boşalmalı; açık siparişler ve adisyon ana masada kalmalı.
6. API kontrolünde aynı oluşturma isteği tekrarında ikinci grup oluşmamalı; farklı içerikli aynı requestId, dolu ek masa, zaten gruptaki masa, ek masada ayrı adisyon açma ve eski grup sürümü reddedilmeli. Başka firma/şube erişimi engellenmeli.
