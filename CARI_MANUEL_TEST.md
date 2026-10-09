# Cari ve demo arayüzü — elle test rehberi

Bu rehber yalnız yerel geliştirme ortamı içindir. `X-Demo-Actor` gerçek giriş/yetki sistemi değildir. Test için gerçek müşteri veya ödeme verisi kullanmayın.

## 1. Paneli kalıcı cari modunda aç

Proje kökünde veritabanı çalışmıyorsa `docker compose up -d db` komutunu verin. İlk kurulumda [README'deki](README.md) migration ve katalog/cari seed adımlarını uygulayın. Seed mevcut kayıtları değiştirmez; API zaten çalışıyorken **migration** uyguladıysanız API'yi yeniden başlatın. Yalnız seed sonrası API yeniden başlatması gerekmez.

İki ayrı terminal açın:

```bash
ASPNETCORE_ENVIRONMENT=Development HIPOS_FEATURE_STORAGE=postgres HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --urls http://127.0.0.1:5180
```

```bash
VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_CARI_PROVIDER=http npm run dev
```

Panel: <http://localhost:5173/admin/customers/accounts>. Başlıkta **PostgreSQL · ilk dilim** yazmalı. **Kurulum gerekiyor** veya bağlantı hatası varsa API terminalindeki hatayı kontrol edin. Varsayılan `npm run dev` yalnız demo carileri gösterir ve veri kaydetmez; bu iki modun etiketi farklı olmalıdır.

Bu çalışma oturumunda eski 5173/5180 süreçleri hâlâ açık olduğundan güncel sürüm ayrıca **<http://127.0.0.1:5177/admin/customers/accounts>** adresinde, API ise 5182 portunda açıldı. Önce bu bağlantıyı kullanın; eski 5173 ekranı yeni cari akışını göstermeyebilir. Ayrı portlardaki önizleme kapanırsa aynı ortamı şu iki komutla yeniden açabilirsiniz:

```bash
ASPNETCORE_ENVIRONMENT=Development HIPOS_FEATURE_STORAGE=postgres HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --no-launch-profile --urls http://127.0.0.1:5182
```

```bash
VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_CARI_PROVIDER=http VITE_API_BASE_URL=http://127.0.0.1:5177 HIPOS_DEV_API_TARGET=http://127.0.0.1:5182 npm run dev --workspace @hipos/admin -- --port 5177 --strictPort
```

## 2. Okuma testi — mevcut demo verisi

1. **Cari Hesaplar** ekranında Beta Ofis için **2.000 TL müşteri alacağı**, ABC Gıda için **9.500 TL tedarikçi borcu** bulun. Test kayıtları daha önce eklendiyse toplam kart sayısı dörtten fazla olabilir.
2. Beta Ofis'i seçin. Başlangıç/bitiş tarihini **08.10.2026** yapın. Beklenen: devir 0 TL, dönem etkisi +2.000 TL, kapanış 2.000 TL ve iki demo hareketi.
3. Her iki tarihi **09.10.2026** yapın. Beklenen: devir 2.000 TL, dönem etkisi 0 TL, kapanış 2.000 TL; “Bu tarihlerde hareket yok” yazısı. Bu, dönem dışı hareketin kaybolmadığını doğrular.
4. **Müşteriler** ve **Stok ve Satın Alma → Tedarikçiler** ekranlarında tür filtrelerini kontrol edin. Aynı kart iki tür taşıyorsa iki listede de görünmelidir.

Ekstre tarihleri İstanbul takvim günlerine göre yorumlanır. Tarih aralığı en çok 366 gün olabilir. Ekranda görülen demo hareketleri gerçek tahsilat/fatura değildir.

## 3. Yazma testi — yalnız test kartıyla

1. **Cari Hesaplar** ekranında “Arayüz Testi” gibi açıkça test olduğu anlaşılan yeni bir kart oluşturun. Tür olarak **Müşteri ve tedarikçi** seçebilirsiniz.
2. Bu kartı seçip müşteri alacağına 100 TL **bakiye artır** hareketi ekleyin; ardından 40 TL **bakiye azalt / kapama** ekleyin. Beklenen müşteri alacağı **60 TL**. Tedarikçi borcu ayrı kalmalı.
3. Sayfayı yenileyin. Kart, iki hareket, bakiye ve ekstre kalmalı.
4. **Cari kartını düzenle** ile unvanı değiştirin, sonra kartı pasif yapın. Beklenen: listede **Pasif**, hareket ekleme formu yok; önceki hareketler ve ekstre okunabilir.
5. Hareketi olan müşteri türünü karttan kaldırmaya çalışın. API bunu reddetmeli; eski hareket/bakiye kaybolmamalı. Kartı yeniden aktif etmek için aynı düzenleme formunu kullanabilirsiniz.

Test kartı veritabanında kalır; otomatik silme yoktur. Demo seed'i tekrar çalıştırmak test kartını silmez veya mevcut kartı sıfırlamaz. Başlangıç bakiyelerini sınamak için Beta Ofis/ABC Gıda üzerinde test hareketi girmeyin.

## 4. Diğer ekranları gözle kontrol et

- <http://127.0.0.1:5177/admin/catalog/products/55555555-5555-4555-8555-555555555501>: Margherita reçetesinde **Un 250 g**, **Domates sosu 80 g**, **Mozzarella 120 g** görünmeli; yanında veritabanına bağlı olmadığı yazmalı.
- <http://127.0.0.1:5177/admin/inventory/counts>: mozzarella örneği **800 g sistem**, **700 g fiziksel**, **−100 g fark** göstermeli. Onay düğmesi veya kalıcı düzeltme başarısı olmamalı.
- Sol menü yapısı korunmalı. Gelecek/etkin olmayan ekranların bağlantıları kırmızı; ilgili ekranların içinde durumları açık olmalı. “Bu alanda neler var?” ve “Gelecekte neler olacak?” ayrı bölümlerde olmalı.

## Geri bildirim gönderirken

Hangi URL'de, hangi modda (`VITE_CARI_PROVIDER=http` veya varsayılan demo), hangi kart/tarih aralığında ne beklediğinizi ve gerçekte ne gördüğünüzü yazın. Varsa ekran görüntüsü ve tarayıcı konsolu/API terminalindeki hata mesajını da ekleyin. Gerçek müşteri verisini paylaşmayın.
