# HIPOS Yönetim Paneli

Restoran yönetim platformunun yönetim paneli ve modül davranışını doğrulayan ASP.NET Core prototipi. Ayrı `apps/pos` yalnız geliştirme/test amaçlı sipariş ve **ödeme durumu simülatörü** ekranıdır; gerçek POS ürünü, tahsilat, garson, mutfak ve müşteri ekranları henüz tamamlanmamıştır.

## Çalıştırma

Yeni tek şubeli ürün odağı ve ilk üç uygulama dilimi: [İlk Üç Aşama](ILK_UC_ASAMA.md). Panel artık Mahalle Fırını tek şube örneğiyle açılır. Demo verisinin ürün, cari, reçete ve stok bağlantıları [ortak dosyada](contracts/demo-single-branch.v1.json) tanımlıdır. Cari yanında reçete, hammadde, stok hareketi ve onaylı sayım için PostgreSQL dilimi vardır; kapsamı ve sınırları aşağıda açıklanır.

Backend teknolojileri, bağımlılık grafiği, şema sahipliği, modül kapatma davranışı ve gerçek/örnek/planlı sınırları için [Backend Mimarisi ve Modül Bağımlılıkları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) ana referanstır. Diğer belgeler belirli bir dilimin test rehberi veya tarihsel ürün/UI kararıdır.

Alan girişlerinde **Alt ekranlar** bugün görülebilen örnekleri ve ilk aşamalarda etkinleşecek işleri, **Gelecekte neler olacak?** sonraki ürün planını gösterir. Her alt ekranın durumu [ekran durum eşlemesinden](apps/admin/src/data/featurePresentation.ts) gelir. Sol menüdeki yapı korunur; henüz etkin olmayan ve gelecek bağlantıların metni kırmızıdır. Reçete kalemleri ve stok/sayım ekranı `VITE_INVENTORY_PROVIDER=http` ile PostgreSQL API'sinden okunup yazılır; varsayılan mock sağlayıcı açıkça örnek veridir. Cari ekranı varsayılan olarak demo veridir; `VITE_CARI_PROVIDER=http` ile yerel PostgreSQL API'sine bağlanır.

Demo sözleşmesini doğrulamak için `npm run demo:check` kullanın. Mevcut katalog migration'ları uygulanmış **yerel geliştirme** veritabanına örnek kategori, ürün, fiyat sürümü ve POS yayınlarını yüklemek için:

```bash
HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' npm run demo:seed
```

Bu komut tekrar çalıştırıldığında aynı kimliklerle ikinci kayıt oluşturmaz; var olan kayıtları değiştirmez. Cari için **ayrı migration ve seed** gerekir:

```bash
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context CariDbContext
HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' npm run demo:seed:cari
```

Seed dört kurgusal cari kartı ve dört örnek hareket ekler; mevcut satırları değiştirmez. Buradaki yerel veritabanında 8 Ekim 2026'da 4 kart ve 4 hareket doğrulandı. Başka bilgisayarda veya Docker veritabanında bu komutları ayrıca çalıştırın. `HIPOS_DEMO_DATABASE_URL` yoksa seed durur. Cari migration'ını API çalışırken uyguladıysanız API'yi yeniden başlatın.

Masa servisi için **SalesDbContext ve ServiceDbContext migration'ları** gerekir. Katalog seed'inden sonra ayrı servis seed'i 24 masa, 3 kurgusal garson kişi kartı, 8 adisyon (7 masalı, 1 self-servis) ve 7 açık masa-adisyon bağı yükler:

```bash
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context ServiceDbContext
HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' npm run demo:seed:service
```

Servis seed'i tekrar çalıştırıldığında aynı kayıtları çoğaltmaz; çelişkili aynı kimlikli siparişte durur. API migration'dan sonra yeniden başlatılmalıdır. Paneli gerçek masa servisine bağlamak için `VITE_SERVICE_PROVIDER=http` kullanın. [Masa servisi test rehberi](MASA_SERVISI_TEST.md) ekran kontrolünü anlatır.

Seed yalnız `HIPOS_DEMO_DATABASE_URL` ile gösterilen **bu bilgisayardaki** yerel `hipos_features` veritabanına yazılır. Değişken verilmezse komut durur. Başka bilgisayarda veya ayrı Docker ortamında aynı veriyi görmek için komutu orada da çalıştırın. Seed öncesinde katalog migration'ları uygulanmış olmalıdır. Yalnız seed çalıştırdıktan sonra API'yi yeniden başlatmak gerekmez; API ürünleri her istekte veritabanından okur. Migration'ları API çalışırken yeni uyguladıysanız API'yi yeniden başlatın; tablo hazırlığını açılışta denetler.

Docker Compose veritabanında bu firmanın kayıtlarını kontrol etmek için (container adı değişebileceğinden servis adını kullanın):

```bash
docker compose exec -T db psql -U hipos -d hipos_features -c "SELECT 'products' AS alan, count(*) FROM catalog.products WHERE firm_id = '11111111-1111-4111-8111-111111111111' UNION ALL SELECT 'price_versions', count(*) FROM catalog.price_versions WHERE firm_id = '11111111-1111-4111-8111-111111111111' UNION ALL SELECT 'publications', count(*) FROM catalog.publications WHERE firm_id = '11111111-1111-4111-8111-111111111111';"
```

Boş geliştirme veritabanına ilk yüklemeden sonra her satırda `6` beklenir; aynı firmaya daha sonra eklenen ürünler toplamı artırabilir.

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
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context CariDbContext
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context ServiceDbContext
```

Ardından API'yi PostgreSQL modunda açın:

```bash
ASPNETCORE_ENVIRONMENT=Development HIPOS_FEATURE_STORAGE=postgres HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet run --project apps/api/Hipos.Api/Hipos.Api.csproj --urls http://127.0.0.1:5180
```

Diğer terminalde `VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_SALES_PROVIDER=http npm run dev` çalışır. Şube seçip **Ayarlar → Modüller ve Özellikler** içinde **Ürün taslakları**, **Fiyat Taslakları**, **POS'a Ürün Yayını**, **Test POS Siparişleri** ve **Test Ödeme Simülatörü** özelliklerini ilgili şubede açın. **Ürünler ve Menü → Ürünler** alanında taslak oluşturun; ürün ayrıntısında fiyat sürümünü kaydedip POS'a yayınlayın. Menü ise ayrı akışta şube kapsamında yayına alınır; bu özellik ürünün POS kanalına aktarılması anlamına gelmez. Ayrı terminalde `npm run dev:pos` test POS'u [http://localhost:5176](http://localhost:5176) adresinde açar. Yayınlanmış üründen sipariş ve ardından simüle ödeme sonucu gerçek PostgreSQL kayıtları oluşturur; yönetim paneli **Satışlar** ekranında bunları salt okunur görür. **Gerçek tahsilat yapılmaz.**

Masa ve personel görünümü için aynı panel komutuna `VITE_SERVICE_PROVIDER=http` ekleyin. **Şubeler → Masa Planı** gerçek `service.tables` ve açık bağları okur; masaya tıklayınca sipariş, zaman, toplam ve varsa sorumlu servis personeli görülür. Personel kartları **Mutfak ve Servis → Personel** alanında bölüm ve görev ızgaralarıyla yönetilir. `staff.records`, masa/garson atama özelliklerinden bağımsızdır; `branches.tables` kapanınca servis ataması kapanır ama personel kartları, satış adisyonları ve self-servis siparişler etkilenmez. Geçmiş servis kayıtları okunabilir. Bordro, vardiya/puantaj, personel giriş yetkileri ve üretim kimlik doğrulaması bu önizlemenin dışındadır.

## Kalıcı menü yönetimi

Menü genel bakışı ve düzenleme artık `/admin/catalog/menus` adresindedir; Ürünler ve Menü giriş sayfası da bu özeti gösterir. `CatalogDbContext` migration'larından sonra `HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' npm run demo:seed:menus` iki kalıcı örnek menü ekler. Panel `VITE_CATALOG_PROVIDER=http` ve `VITE_FEATURE_PROVIDER=http` kullanmalı; yazma için seçili şubede **Menü Yönetimi** açılmalıdır. Özel bölüm başlıkları, ikonlu/kategori filtreli mevcut ürün seçimi, sıralama, etkileşimsiz önizleme, sürüm kontrollü kaydetme ve şubede tek yayındaki menü seçimi vardır. QR ve web yayını sonraki fazdır. Sözleşme ve kabul akışı: [Menü Yönetimi MVP](MENU_YONETIMI_MVP.md).

## Kalıcı stok, reçete ve sayım dilimi

Önce katalog migration'ı, ardından `InventoryDbContext` migration'ı uygulanmış olmalı. Seed, reçete ürünlerinin katalogda bulunmasını gerektirir:

```bash
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context InventoryDbContext
HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' npm run demo:seed:inventory
```

Komut yalnız açıkça belirtilen yerel `hipos_features` veritabanına yazar; sabit kimlikli **Kadıköy Ana Depo**, 21 hammadde kartı, 4 reçete, 39 stok hareketi ve 21 kalemli taslak sayımı ekler. Sayımda kritik stoklar ve farklı miktarlardaki fiziksel uyuşmazlıklar örneklenir. Tekrar çalıştırma mevcut kartları, hareketleri veya sayım satırlarını değiştirmez. API'yi migration sonrasında yeniden başlatın. Paneli `VITE_FEATURE_PROVIDER=http VITE_CATALOG_PROVIDER=http VITE_INVENTORY_PROVIDER=http npm run dev` ile açıp **Ayarlar → Modüller ve Özellikler** bölümünde önce **Stok Takibi**, ardından **Reçete** ve **Stok Sayımı** özelliklerini seçili şubede etkinleştirin. İlk demo tek şube/tek depodur; veri modeli depoya bağlıdır. Reçete satışta otomatik tüketim yapmaz, gerçek kimlik doğrulaması yoktur.

Önemli kontroller: stok yalnız değiştirilemez hareket kayıtlarının toplamından hesaplanır; negatif bakiye reddedilir. Kritik kuralı `onHand < criticalBelow`; eşik hammaddede düzenlenebilir ve stok miktarı değildir. Açık sayım yeni hareketleri kilitler. Sayımın başındaki sistem miktarı sabitlenir, fiziksel sayı girilmeden onaylanmaz. Dışarıdan stok değişmişse onay `COUNT_STOCK_CHANGED` ile reddedilir; düzeltme yazılmaz. Onay, farkı her hammadde için en çok bir kez `count_adjustment` hareketi olarak kaydeder. Modül açık sayım sırasında kapatılamaz (`INVENTORY_COUNT_OPEN`); taslak iptal edilebilir. Reçete düzenleme yeni sürüm ekler, eski sürümü değiştirmez. Teorik üretim fire, bozulma, diğer tüketim ve birim dönüşümünü içermez.

Yönetici ekranını deneyip doğrulamak için [Stok, Reçete ve Sayım elle test rehberini](STOK_REÇETE_SAYIM_MANUEL_TEST.md) izleyin.

Cari ekranını da PostgreSQL'e bağlamak için panel komutuna `VITE_CARI_PROVIDER=http` ekleyin ve yukarıdaki cari seed'ini uygulayın. Cari kartı oluşturma, unvan/tür/aktiflik düzenleme ve manuel bakiye hareketi çalışır; bunlar gerçek tahsilat/fatura oluşturmaz. Ekstre İstanbul takvim günlerine göre devir + dönem hareketi + kapanış bakiyesi gösterir. Finans alt ekranları, otomatik belge bağlantısı ve gerçek oturum/yetki henüz yapılmamıştır. Elle arayüz testi için [Cari test rehberi](CARI_MANUEL_TEST.md) kullanın.

Migration **ayrı komutla** uygulanır; modül düğmesi migration veya tablo silme işlemi yapmaz. [compose.yaml](compose.yaml) yalnız yerel geliştirme içindir; örnek parolası üretimde kullanılmaz. Sunucu yalnız Development ortamında açılır; `X-Demo-Actor` başlığı gerçek kimlik doğrulaması değildir. Katalog, satış veya cari migration'ı eksikse ilgili API açık bir `503` döner. `VITE_SALES_PROVIDER` verilmezse yönetimdeki eski satış görünümü açıkça örnek veridir.

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

Varsayılan panel verileri örnektir. Modül seçimleri tarayıcı oturumunda, .NET bellek modunda sunucu belleğinde veya PostgreSQL modunda veritabanında tutulur. HTTP/PostgreSQL dilimleri katalog taslak/fiyat/ilk yayın, cari, masa servisi ve test POS sipariş/simüle ödeme kapsamlarını içerir; sınırlar için [backend belgesine](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) bakın. Sipariş ve simüle ödeme yalnız ayrı Test POS ekranından oluşturulur; yeniden yayın, gerçek ödeme ve dış sağlayıcı bağlantısı henüz yoktur.

Bu sürüm geliştirme prototipidir. Ekran kodu alan dosyalarına ayrıldı ve yollar `/admin` altında toplandı. Yönetici başlangıç ekranı API sağlayıcısı açıldığında açık adisyon ve masa özetlerini okur; mock modda bunları örnek diye etiketler. **Ürünler ve Menü**, **Cari**, **Satışlar**, **Masa Planı** ve **Stok/Reçete/Sayım** ilgili HTTP sağlayıcıları açıldığında PostgreSQL verisini kullanır; sağlayıcı kapalıysa ekran örnek gösterimdir. Gerçek kullanıcı girişi ve tam işletme operasyonları henüz yoktur. Katalogdaki `catalogState` sorgu parametresi yalnız mock durum önizlemesi içindir.

## Ürün ve mimari belgeleri

- [Backend mimarisi, bağımlılıklar ve modül sınırları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) — bugünkü uygulamanın teknik kaynak belgesi
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
