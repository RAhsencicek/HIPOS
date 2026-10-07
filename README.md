# HIPOS Yönetim Paneli

Restoran yönetim platformunun yönetim paneli ve modül davranışını doğrulayan ASP.NET Core prototipi. Ayrı `apps/pos` yalnız geliştirme/test amaçlı sipariş ve **ödeme durumu simülatörü** ekranıdır; gerçek POS ürünü, tahsilat, garson, mutfak ve müşteri ekranları henüz tamamlanmamıştır.

## Çalıştırma

Gereksinim: Node.js 22.12 veya üzeri ve npm (eklenen Vitest 5 testleri için).

```bash
npm install
npm run dev
```

Panel: [http://localhost:5173/admin](http://localhost:5173/admin). Eski `/` adresi buraya yönlenir.

Derleme ve tip denetimi:

```bash
npm run build
npm run typecheck
npm test
npm run test:e2e
```

## Yerel .NET modül prototipi

Gereksinim: [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0). İki terminal kullanın:

```bash
ASPNETCORE_ENVIRONMENT=Development dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --urls http://127.0.0.1:5180
```

```bash
VITE_FEATURE_PROVIDER=http npm run dev
```

`/admin/settings/modules` sayfası yerel API'den okur. `VITE_FEATURE_PROVIDER` verilmezse mevcut frontend mock'u kullanılır. Yukarıdaki komut varsayılan **bellek modudur**; sunucu yeniden başlayınca tercihler sıfırlanır.

### PostgreSQL ile kalıcı prototip

Docker çalışıyorsa yerel veritabanını başlatın:

```bash
docker compose up -d db
dotnet tool restore
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context FeatureDbContext
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context CatalogDbContext
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context SalesDbContext
```

Ardından API'yi PostgreSQL modunda açın:

```bash
ASPNETCORE_ENVIRONMENT=Development HIPOS_FEATURE_STORAGE=postgres HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --urls http://127.0.0.1:5180
```

Diğer terminalde `VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_SALES_PROVIDER=http npm run dev` çalışır. Şube seçip **Ayarlar → Modüller ve Özellikler** içinde **Ürün taslakları**, **Fiyat Taslakları**, **Menü Yayınlama**, **Test POS Siparişleri** ve **Test Ödeme Simülatörü** özelliklerini ilgili şubede açın. **Ürünler ve Menü → Ürünler** alanında taslak oluşturun; ürün ayrıntısında fiyat sürümünü kaydedip POS'a yayınlayın. Ayrı terminalde `npm run dev:pos` test POS'u [http://localhost:5176](http://localhost:5176) adresinde açar. Yayınlanmış üründen sipariş ve ardından simüle ödeme sonucu gerçek PostgreSQL kayıtları oluşturur; yönetim paneli **Satışlar** ekranında bunları salt okunur görür. **Gerçek tahsilat yapılmaz.**

Migration **ayrı komutla** uygulanır; modül düğmesi migration veya tablo silme işlemi yapmaz. [compose.yaml](compose.yaml) yalnız yerel geliştirme içindir; örnek parolası üretimde kullanılmaz. Sunucu yalnız Development ortamında açılır; `X-Demo-Actor` başlığı gerçek kimlik doğrulaması değildir. Katalog veya satış migration'ı eksikse ilgili API açık bir `503` döner. `VITE_SALES_PROVIDER` verilmezse yönetimdeki eski satış görünümü açıkça örnek veridir.

Sunucu sözleşmesi ve HTTP testleri:

```bash
dotnet build apps/api/Hipos.Api/Hipos.Api.csproj
node --test apps/api/Hipos.Api.Tests/http.test.mjs
npm run test:api-ui
npm run test:db
```

`test:api-ui` panel–API bağlantısını tarayıcıda doğrular. `test:db` bu Mac'teki PostgreSQL 18 araçlarıyla geçici, izole bir veritabanı açar; yönetim panelinden taslak → fiyat → ilk POS yayını, ayrı Test POS'tan sipariş → simüle ödeme → yönetimde salt okunur izleme zincirini doğrular. Kısmi/belirsiz ödeme, tekrar isteği, yeniden başlatma, şube izolasyonu ve denetim kaydı da sınanır. Test kendi geçici verisini temizler; Docker gerektirmez.

## Bu sürümde

- Tek şubeli ve çok şubeli örnek işletme seçimi
- Tüm ana yönetim alanları ve alt ekranların gezilebilir menüsü
- Genel bakış, ürün listesi/ayrıntısı, şube durumu, adisyon izleme, stok özeti, raporlar ve entegrasyon görünümü
- Şube kapsamına göre PostgreSQL'den veya örnek veriden okunan salt okunur kategori özeti
- Şube bazlı modül kataloğu ve bağımlılık gösteren açma/kapama önizlemesi
- Kapalı modülde geçmiş okuması, yeni iş önizlemesini kapatma ve gerçek işlem olmadığına dair açık etiketler

Varsayılan panel verileri örnektir. Modül seçimleri tarayıcı oturumunda, .NET bellek modunda sunucu belleğinde veya PostgreSQL modunda veritabanında tutulur. HTTP/PostgreSQL hazırlandığında yönetici paneli taslak oluşturur/günceller, taslak fiyatı kaydeder, ilk POS yayınını yapar, geçmişi okur ve test POS sipariş/ödeme durumlarını salt okunur izler. Sipariş ve simüle ödeme yalnız ayrı Test POS ekranından oluşturulur; yeniden yayın, gerçek ödeme ve dış sağlayıcı bağlantısı henüz yoktur.

Bu sürüm görsel/etkileşimli tasarım prototipidir. Ekran kodu alan dosyalarına ayrıldı ve yollar `/admin` altında toplandı. **Ürünler ve Menü** listesi/ayrıntısı `CatalogProvider` üzerinden varsayılan mock veya isteğe bağlı PostgreSQL API verisi alır; HTTP modunda temel taslak formu gerçek yazma komutunu kullanır. Diğer alanlar hâlâ görsel fixture kullanır. Gerçek kullanıcı girişi ve işletme operasyonları henüz yoktur. Katalogdaki `catalogState` sorgu parametresi yalnız mock durum önizlemesi içindir.

## Ürün ve mimari belgeleri

- [Ana ürün tanımı](URUN_TANIMI.md)
- [Görsel tasarım yönü](TASARIM_YONU.md)
- [Teknik mimari](TEKNIK_MIMARI.md)
- [API ve mock veri sözleşmesi](API_VE_MOCK_SOZLESMESI.md)
- [UI sözleşmesi ve uygulama sırası](UI_UYGULAMA_PLANI.md)
- [Kimlik ve hesap akışı kararı](KIMLIK_VE_HESAP_AKISI.md)
- [Modüler backend planı](MODULER_BACKEND_PLANI.md)
- [Yönetim paneli özellik envanteri](OZELLIK_ENVANTERI.md)
- [Ürünler ve Menü backend sözleşmesi](KATALOG_BACKEND_SOZLESMESI.md)
- [Test POS ve ilk sipariş sözleşmesi](TEST_POS_VE_SIPARIS_SOZLESMESI.md)
- [Test ödeme çekirdeği sözleşmesi](ODEME_SIMULATORU_SOZLESMESI.md)
- [Bugünkü durum ve yol haritası](DURUM_VE_YOL_HARITASI.md)
