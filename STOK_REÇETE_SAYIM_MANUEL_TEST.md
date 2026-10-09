# Stok, reçete ve sayım — yönetici paneli elle testi

Bu rehber yerel geliştirme içindir; seed verisi kurgusaldır. Migration ve inventory seed'ini [README'deki yönergeyle](README.md#kalıcı-stok-reçete-ve-sayım-dilimi) uygulayın. API'yi PostgreSQL ayarlarıyla yeniden başlatın; paneli şu sağlayıcılarla açın:

```bash
VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_INVENTORY_PROVIDER=http npm run dev
```

Tek şube **Mahalle Fırını / Kadıköy** bağlamını seçin. **Ayarlar → Modüller ve Özellikler** bölümünde sırayla **Stok Takibi**, **Reçete** ve **Stok Sayımı** özelliklerini açın. Ana sayfa ve depo stok ekranının gerçek PostgreSQL'e bağlı olduğunu doğrulayın.

## 1. Ana sayfa ve depo kapsamı

1. Ana sayfadaki **Kritik stoklar** alanında API'den gelen kritik hammadde sayısı ve kalemleri görünmeli. Mozzarella için mevcut 800 g, eşik 1.000 g ve eşik altı 200 g beklenir.
2. **Stok ve Tedarik → Depo stokları** (`/admin/inventory/warehouse-stock`) ekranında **Kadıköy Ana Depo** seçili olmalı. Sayfa yenilemesinde depo ve miktarlar API'den tekrar gelmeli.
3. `VITE_INVENTORY_PROVIDER=mock` ile açılan panelde etiket **Örnek gösterim** olmalı; mock veri PostgreSQL verisi gibi sunulmamalı.

## 2. Hammadde ve kritik eşik → hareket defteri

1. **Hammadde** ekranında yeni bir test hammaddesi oluşturun; adı, birimi ve sıfırdan büyük kritik eşiği kaydedin.
2. Eşiği değiştirip kaydedin. Sayfayı yenileyin; yeni eşik ve audit kaydı korunmalı. Negatif eşik API tarafından reddedilmeli.
3. Aynı ekrandan 25 birim giriş ve 5 birim çıkış girin. Bakiye 20 olmalı; geçmişte tür, açıklama, aktör ve zaman görünmeli.
4. Mevcut stoktan büyük çıkış deneyin. API reddetmeli; bakiye negatif olmamalı. Stok doğrudan düzenlenemez.

## 3. Reçete → teorik üretim

1. **Ürünler ve Menü → Ürünler** içinde Margherita Pizza ayrıntısında Un 250 g, Domates sosu 80 g, Mozzarella 120 g görünmeli.
2. **Stok ve Tedarik → Reçeteler** ekranında ürünün reçete kalemleri ve teorik üretim kapasitesi gösterilmeli. Demo başlangıcında pizza için en kısıtlayıcı malzeme Mozzarella'dır.
3. Ekrandaki açıklama fire, bozulma, diğer ürün tüketimi ve birim dönüşümünü dışarıda tuttuğunu; bunun üretim emri veya garanti edilmiş satış miktarı olmadığını belirtmeli.
4. API'de reçete birimini hammaddeninkinden farklı göndererek uyumsuzluğu doğrulayın: estimate üretilmemeli, birim hatası açıkça gösterilmeli.

## 4. Sayım → inceleme → onaylı düzeltme

1. **Stok Sayımları** içinde `count-mozzarella-demo` taslağını açın. Mozzarella sistem 800 g, fiziksel 700 g ve fark -100 g görünmeli.
2. Farklı fiziksel miktar kaydedilince satırda **İnceleme gerekli** görünmeli. Onaydan önce stok 800 g kalmalı.
3. Taslağı onaylayın. Stok 700 g olmalı; geçmişte yalnız bir `count_adjustment` (-100 g) oluşmalı. Aynı onay isteği ikinci düzeltme oluşturmamalı.
4. Yeni sayım başlatın. Taslak açıkken yeni stok hareketi ve hammadde kartı API'de `409 COUNT_IN_PROGRESS` ile reddedilmeli.
5. API korumasını sınamak için test veritabanına sayım açıkken dışarıdan movement ekleyin. Onay `409 COUNT_STOCK_CHANGED` vermeli, hiçbir düzeltme hareketi oluşmamalı.
6. Taslağı iptal edin. Snapshot ve audit korunmalı, stok değişmemeli; iptal sonrası normal stok girişi yeniden mümkün olmalı.

## 5. Modül sınırı

1. Sayım açıkken **Stok Takibi** veya **Stok Sayımı** kapatmayı deneyin. API `409 INVENTORY_COUNT_OPEN` vermeli; tercih açık kalmalı.
2. Sayımı onaylayın veya iptal edin; sonra modülü kapatın. Geçmiş kayıtlar okunur kalmalı, yeni yazmalar reddedilmeli.
3. Modül tercihi veri silmemeli ve migration çalıştırmamalı.

Bu MVP tek şube/tek depo örneğidir; veri modeli depo kimliği taşır. Reçete satışta otomatik stok tüketmez; satın alma belgesi, barkod, transfer, alış maliyeti ve gerçek kullanıcı/rol yetkisi bu akışta yoktur. Sorun bildirirken ekran URL'si, depo/şube, beklenen/görülen miktar ve test adımını birlikte not edin.
