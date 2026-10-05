# Yönetim Paneli — Teknik Mimari Kararları

Durum: Kararlaştırılan teknoloji yönü ve hedef uygulama ilkeleri. Mevcut ilk tasarım prototipi bu hedef mimarinin tamamı değildir: sayfalar şimdilik tek `App.tsx` içinde, örnek veriler `data/catalog.ts` içinde ve HTTP/mock sağlayıcı arayüzü henüz kurulmadı. Ürün kapsamı için [Ana Ürün Dokümanı](URUN_TANIMI.md) geçerlidir. Ayrıntılı API alanları henüz taslaktır.

## 1. Tasarım hedefleri

1. İlk teslim, yönetim panelinin kullanılabilir frontend prototipidir.
2. Firma/şube kapsamı tüm veri ve yapılandırma işlemlerinde açık taşınır; marka isteğe bağlı alan olarak desteklenir.
3. Modül açma/kapama, modül verisinin varlığından ayrıdır. Kapatmak kayıt silme veya veritabanı şeması değiştirme anlamına gelmez.
4. Prototip, gerçek API ve planlı özellikler aynı arayüzde karışıklık yaratmadan temsil edilir.
5. Yönetici paneli günlük operasyon komutları üretmez; yalnız tanımlı yönetsel işlemleri sunar.
6. İkinci ürün yüzü geldiğinde ortak bileşen ve sözleşmeler paylaşılabilir; bugün gereksiz paket ve servis çoğaltılmaz.

## 2. Önerilen teknoloji seçimi

| Alan | İlk tercih | Neden / kullanım sınırı |
| --- | --- | --- |
| Dil | TypeScript, sıkı tip denetimi | Ekran, modül, bağlam ve API sözleşmelerinde değişiklikleri yakalamak. |
| Yönetim uygulaması | React + Vite | Yoğun etkileşimli iç panel için hızlı geliştirme ve üretim derlemesi. İlk aşamada sunucu tarafı HTML üretimi gerekmiyor. |
| Sayfa yönlendirme | React Router | İlk ekip için sade başlangıç; iç içe yönetim sayfaları ve adreslenebilir filtreler. TanStack Router ancak ekip ve ekran gereksinimi somut fayda gösterirse yeniden değerlendirilir. |
| Sunucu verisi | TanStack Query | Gerçek API eklendiğinde yükleme, hata, önbellek ve yeniden sorgulama yönetimi. Prototipte veri erişim katmanının arkasında kullanılır. |
| Görsel sistem | Tasarım değişkenleri + CSS; gerekirse Tailwind CSS ve erişilebilir başsız bileşenler | İlk prototip mevcut referansa göre CSS ile kuruldu. Bileşen kapsamı genişlerse ek araç seçilir. |
| Çalışma alanı | npm workspaces | İleride yönetim, POS ve diğer uygulamalar için ortak paketleri aynı depoda yönetmeye hazır olmak. Başlangıçta yalnız gerekli uygulama/paketler oluşturulur. |
| Uçtan uca doğrulama | Playwright | Şube değiştirme, modül kapalı hali ve prototip uyarısı gibi kullanıcı akışlarını tarayıcıda doğrulamak. |
| API | .NET 10 + ASP.NET Core | Yönetim paneli ve ilerideki ürün yüzleri için tek HTTP API. |
| Uygulama mimarisi | Modüler monolit; API → Application/Domain → Infrastructure | İş alanlarını ayırırken ilk backend'i tek dağıtım birimi olarak tutmak. |
| Veri erişimi | EF Core 10 + Npgsql → PostgreSQL | İlişkisel veri, işlemler ve sürümlü şema değişiklikleri. |

Seçim, her ihtimal için en fazla araç kurma hedefiyle yapılmaz. Bir kütüphane yalnız somut ihtiyacı karşıladığında eklenir. Özellikle global durum yönetimi ve grafik kütüphanesi ekran gereksinimleri netleşince seçilir.

## 3. Önerilen depo yapısı

```text
apps/
  admin/                  # İlk ve tek uygulama: yönetim paneli
    src/
      app/                # Uygulama açılışı, yönlendirme, sağlayıcılar
      features/           # Alan bazlı bağımsız özellikler
        overview/
        branches/
        catalog/
        sales/
        customers/
        cash/
        finance/
        inventory/
        kitchen/
        reports/
        central/
        settings/
      shared/             # Yalnız gerçekten ortak ekran parçaları
      data/               # API/prototip veri kaynağı uyarlayıcıları
packages/                 # Ortak ihtiyaç ortaya çıktığında eklenir
  contracts/              # Gelecekte paylaşılan API/veri sözleşmeleri
  ui/                     # Gelecekte ürün yüzleri arasında paylaşılan tasarım sistemi
```

`packages/` altındaki klasörler hedef yapıyı gösterir; ilk günden boş paket olarak oluşturulmaları gerekmez. Bir özelliğin sayfası, veri erişimi, türleri ve ekran durumları kendi `features/` alanında kalır. Bir özellik başka özelliğin iç dosyalarını doğrudan içe aktarmaz; açık dışa aktarım veya paylaşılan sözleşme kullanır. Döngüsel bağımlılık kabul edilmez.

Backend başladığında aynı iş alanları API altında modül sınırları olarak düzenlenir. Önerilen yapı:

```text
src/
  Admin.Api/                  # HTTP uçları, kimlik ve kapsam çözümleme
  Modules/
    Catalog/
      Catalog.Application/    # Kullanım senaryoları ve doğrulama
      Catalog.Domain/         # İş kuralları ve varlıklar
      Catalog.Infrastructure/ # EF Core eşlemeleri ve dış sistemler
    Inventory/
    Sales/
    Finance/
    ...
  BuildingBlocks/             # Az sayıda gerçekten ortak sözleşme
```

Bu, başlangıçta her modül için ayrı servis veya veritabanı kurma zorunluluğu değildir. Tek PostgreSQL kullanılabilir; modül tablolarının sahipliği açık olur. Domain katmanı ASP.NET Core veya EF Core'a bağımlı olmaz. Modüller birbirinin tablolarını doğrudan değiştirmez; uygulama sözleşmeleri ve açık olaylar üzerinden haberleşir. Raporlama için modüller arası okuma ihtiyaçları ayrıca tasarlanır.

## 4. Frontend modül sözleşmesi

Her modülün kalıcı bir kimliği, görünür adı, açıklaması, kapsamı, bağımlılıkları ve olgunluk durumu vardır. Modül kataloğu ile sayfa erişimi aynı tanım kaynağını kullanır. İlk sürümde yöneticilerin hepsi aynı sayfaları görür; ileride izin bilgisi ayrı bir politika katmanı olarak eklenebilir.

Örnek kavramsal model:

```text
FeatureDefinition:
  id
  name
  description
  scope: firm | branch
  dependencies[]
  availability: real | prototype | planned
  setupRequirements[]

FeatureState:
  firmId
  branchId?          # Şube kapsamlı özellikte zorunlu
  featureId
  enabled
  setupStatus
  providerStatus?
```

`availability` ürünün uygulanma düzeyidir; `enabled` ilgili işletmenin tercihi; `setupStatus` gerekli verilerin tamamlanma durumudur. Bu alanlar tek bir “aktif” bayrağına indirgenmez. Frontend, A1 kapsamındaki değişikliği A2 verisine uygulamaz. Gerçek backend geldiğinde bu kural sunucuda da doğrulanır; istemcideki filtre tek başına veri izolasyonu sayılmaz.

**Mimari modül ile aç/kapa ayarı farklı şeylerdir.** Modüler monolit kodu iş alanlarına ayırır. Özellik ayarı ise belirli firma/şubede hangi yeteneğin kullanılacağını belirleyen veridir. Bir özelliği kapatmak modülün kodunu kaldırmaz, EF migrasyonu çalıştırmaz ve geçmiş kayıtları silmez. Bir özelliği açmak; kapsam, bağımlılık, kurulum ve sağlayıcı kontrolleri başarıyla geçince etkili olur. UI, API ve arka plan işleri aynı etkili duruma uymalıdır. Kaydedilen tercihle fiilen kullanılabilir durum ayrı gösterilmelidir; örneğin “Açık, kurulum gerekiyor”.

## 5. Veri ve API sınırı

Hedef mimaride ekranlar doğrudan dağınık sabit veri dizilerini okumaz. Her alan bir veri erişim arayüzüne bağlanır; prototip veri sağlayıcısı bu arayüzü örnek senaryolarla doldurur. Gerçek API geldiğinde sağlayıcı değişir, ekran sözleşmesi korunur. İlk görsel prototipte ise fixture'lar tek `data/catalog.ts` dosyasındadır; sağlayıcı katmanı ve sözleşme tipleri sonraki uygulama adımıdır. Prototipte gerçek kaydetme olmayan komutlar başarı sonucu üretmez. Gerekirse etkileşimli taslak yalnız `prototip` etiketi altında, kalıcı işlem iddiası olmadan gösterilir.

Mock verinin hedef şekli, ilerideki ASP.NET Core API yanıtıyla aynı sözleşmeden türemelidir. Firma/marka/şube kapsamı, kimlikler, para ve miktar, liste sayfalaması, modül durumu ve hata biçimi [API ve Mock Veri Sözleşmesi](API_VE_MOCK_SOZLESMESI.md) içinde ilk taslak olarak tanımlanmıştır. Bugünkü görsel fixture'lar henüz bu sözleşmeyle bire bir aynı değildir; gerçek veri akışına geçmeden önce sağlayıcıyla birlikte hizalanacaktır.

Gelecekte HTTP API sözleşmesi OpenAPI ile belgelenir. İstek ve yanıtlar firma, isteğe bağlı marka ve şube kapsamını açıkça taşır. Liste ekranlarında filtre, sıralama, sayfalama ve zaman aralığı sözleşmesi tutarlı olur. Para tutarı, vergi ve miktar gösterimi biçimlendirilir; hesaplamanın kaynağı backend olur. Hata cevapları ekranın `hata`, `yetkisiz`, `kurulum gerekiyor` ve `modül kapalı` durumlarına eşlenir.

## 6. Backend çalışma kararı

Backend için çalışma kararı **.NET 10 + ASP.NET Core → Application/Domain → EF Core 10/Npgsql → PostgreSQL** zinciridir. Modüller tek uygulama ve ilk aşamada tek dağıtım birimi içinde kalır. NestJS ilk backend tercihi değildir; yalnız .NET prototipi somut teknik ölçütlerde başarısız olursa alternatif olarak değerlendirilir. Bu değişiklik kullanıcı kararıdır.

Firma ve şube izolasyonu her sorgu/komut için sunucuda doğrulanır. PostgreSQL satır güvenliği ek savunma katmanı olarak değerlendirilebilir; uygulama düzeyi kapsam denetiminin yerine geçmez. Modül etkinliği ayrı tablolarda veya kayıtlarda saklanır; modül kapatmak şema migrasyonu ya da veri silme yapmaz. EF Core migrasyonları ürün sürümlerinde kontrollü olarak uygulanır, kullanıcı modül düğmesine bastığında değil. Hassas yönetsel işlemler için işlem geçmişi, idempotent ödeme komutları ve tutarlı rapor tanımları backend tasarımının parçasıdır.

## 7. Uygulamaya geçiş sırası

1. Referans ekranları inceleyip tasarım değişkenlerini ve panel iskeletini kararlaştırmak.
2. Tek şube ve çok şube için örnek senaryoları, bağlam seçiciyi ve modül kataloğunu kurmak.
3. Her ana alanın yönlendirmesini, liste/detay şablonunu ve ortak ekran durumlarını oluşturmak.
4. Öncelikli akışları prototip veri sağlayıcısıyla çalıştırmak: ürün/menü, şube izleme, stok/satın alma, rapor ve ayarlar.
5. Yönetici ve operasyon sınırını, kapalı modül davranışını ve sahte başarı bulunmadığını tarayıcı akışlarıyla doğrulamak.
6. Backend kapsamı kesinleşince API sözleşmesini ve gerçek veri sağlayıcılarını eklemek.

## 8. Karara bağlanan sözleşmeler

1. Mock/API yapısı, ürün ihtiyaçlarından türetilen [başlangıç sözleşmesiyle](API_VE_MOCK_SOZLESMESI.md) kurulacaktır; backend geliştikçe sürümlü olarak doğrulanır.
2. Modül kapatılınca yeni işlemler durur, devam eden kritik işler güvenli şekilde sonuçlanır ve geçmiş kayıtlar okunabilir kalır. Somut durum geçişleri aynı sözleşmede açıklanmıştır.

## 9. Resmi teknik kaynaklar

- [React ve TypeScript](https://react.dev/learn/typescript)
- [Vite başlangıç ve React TypeScript şablonu](https://vite.dev/guide/)
- [Vite TypeScript denetimi notu](https://vite.dev/guide/features.html)
- [React Router yönlendirme](https://reactrouter.com/start/declarative/routing)
- [TanStack Query React dokümanı](https://tanstack.com/query/latest/docs/framework/react)
- [Tailwind CSS Vite kurulumu](https://tailwindcss.com/docs/installation/using-vite)
- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- [Playwright kullanım ilkeleri](https://playwright.dev/docs/best-practices)
- [.NET 10 destek süresi](https://learn.microsoft.com/en-us/dotnet/core/releases-and-support)
- [ASP.NET Core uygulama mimarileri](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures)
- [EF Core 10 sürümü](https://learn.microsoft.com/en-us/ef/core/what-is-new/)
- [Npgsql EF Core sağlayıcısı](https://www.npgsql.org/efcore/)
- [EF Core migrasyonları](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
- [OpenAPI belirtimi](https://spec.openapis.org/oas/)
- [PostgreSQL satır güvenliği](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
