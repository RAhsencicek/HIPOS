# Masa servisi — yerel elle test

Bu dilim geliştirme ortamı içindir. Önce [README](README.md) içindeki Feature, Catalog, Sales ve Service migration'larını; katalog ve servis seed'lerini kendi `hipos_features` veritabanınızda uygulayın. API'yi migration sonrasında yeniden başlatın. `HIPOS_DEMO_DATABASE_URL` olmadan seed çalışmaz.

Paneli `VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_SALES_PROVIDER=http VITE_SERVICE_PROVIDER=http npm run dev` ile açın. API varsayılan `127.0.0.1:5180` üzerinde olmalı. Panelde **Mahalle Fırını → Kadıköy Şubesi**, ardından **Şubeler ve Canlı Durum → Masa Planı** seçin.

1. `7/24 masada açık bağ` görünmeli. Boş masa 01'e tıklayın: “Bu masada açık adisyon yok.” yazmalı.
2. Dolu masa 12'ye tıklayın: Mehmet Kaya, Tavuklu Sandviç ×2, Ev Yapımı Limonata ×1, sipariş zamanı ve 645,00 ₺ toplam görünmeli. Diğer dolu masaları da açarak verinin masa bazında değiştiğini kontrol edin.
3. **Satışlar ve Adisyonlar → Açık Adisyonlar** ekranında `…9908` sonlu kurgusal self-servis siparişini de görebilirsiniz. Bu sipariş masa doluluğunu artırmaz. Satış ekranı masa/servis türünü ayrı alan olarak henüz göstermez; `9908` ayrımı yalnız demo sözleşmesinden bilinir.
4. **Ayarlar → Modüller ve Özellikler** içinde `staff.records`, `service.waiters` ve `branches.tables` durumunu kontrol edin. Masa servisini kapattığınızda garson ataması otomatik kapanmalı; satış ve personel kayıt modülleri açık kalmalı. Masa planında geçmiş kayıtlar okunmalı ancak yeni masa işlemleri görünmemeli. Personel kartları **Mutfak ve Servis → Personel** ekranından yönetilir; bu alanı doğrulamak için [personel MVP rehberini](PERSONEL_YONETIMI_MVP.md) izleyin.
5. API kapalı veya Service migration'ı eksikse ekranda veri varmış gibi boş/dolu masa uydurulmamalı; açık kurulum/bağlantı hatası görülmeli.

Masa kapatma, adisyonu veya ödemeyi kapatmaz. Yönetim paneli bugün adisyonu masaya bağlamaz; bu işlem ayrı POS/servis API'sindedir. Garson kişi kartı çalışma süresi ya da performans verisi değildir. Gerçek kullanıcı girişi, yetki politikası ve canlı POS entegrasyonu pilot öncesi eksiktir.

Tekrarlanabilir otomatik testler: `npm run test:api`, `npm run test:db`, `npm run typecheck`. PostgreSQL testi geçici veritabanında masa bağlama, kapatma, şube izolasyonu, satış bağımsızlığı ve gerçek tarayıcıdaki masa ayrıntısını doğrular.
