# Yönetim Paneli — API ve Mock Veri Sözleşmesi

Durum: Frontend prototipi için başlangıç sözleşmesi ve tarihsel API taslağı. Gerçekleşen endpoint/şema kapsamı için [Backend Mimarisi ve Modül Bağımlılıkları](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) esas alınır. Bu belge üretim backend'i veya kesin OpenAPI dosyası değildir. Ürün kapsamı [Ana Ürün Dokümanı](URUN_TANIMI.md), teknoloji kararları [Teknik Mimari](TEKNIK_MIMARI.md) içindedir.

## 1. Temel ilkeler

- Mock sağlayıcı ve gelecekteki API aynı TypeScript istek/yanıt türlerini kullanır. Ekran, verinin mock veya HTTP kaynağından geldiğini bilmek zorunda kalmaz.
- Firma ve şube kapsamı hiçbir zaman yalnızca frontend filtresine emanet edilmez. Gerçek API her istekte kullanıcının ilgili firma/şubeye erişimini doğrular.
- Marka isteğe bağlı sınıflandırma katmanıdır. `brandId: null` geçerlidir; markanın olmaması şubenin firmasız olduğu anlamına gelmez.
- “Tüm şubeler” yalnız okuma ve rapor kapsamıdır. Şube ayarını değiştiren ilk komutlar tek bir açık `branchId` ister.
- API iş verisinin gerçekten kaydedildiğini yalnız başarılı sunucu yanıtıyla bildirir. Prototip sağlayıcı gerçek kayıt oluşturduğunu iddia etmez.
- Bağlantı, olgunluk, istenen modül tercihi ve fiilî kullanılabilirlik ayrı alanlardır.

## 2. Kimlik, zaman, para ve miktar

| Kavram | Sözleşme | Neden |
| --- | --- | --- |
| Kimlik | Opaque string; örneklerde UUID | İstemci kimlikten şube/firma çıkarmaya çalışmaz. |
| Zaman | ISO 8601 UTC (`2026-10-05T09:30:00Z`) | Yerel saat arayüzde `Europe/Istanbul` ile biçimlenir. |
| Para | `{ amountMinor: 129900, currency: "TRY" }` | 1.299,00 TL, tamsayı kuruşla taşınır; frontend güvenli tamsayıyı doğrular. |
| Stok miktarı | `{ value: "2.500", unit: "kg" }` | Ondalıklı miktar metin olarak taşınır; hesaplama sunucuda ondalık türle yapılır. |
| İsteğe bağlı marka | `brandId: string | null` | Tek markalı işletmeye yapay marka kaydı zorlanmaz. |
| Sürüm | `version: number` | Eşzamanlı yönetici değişikliklerinde eski verinin sessizce ezilmesini önlemek için. |

API alan adları JSON'da `camelCase`, TypeScript türleri aynı adlarla tutulur. Liste sıralaması ve zaman aralığı açık parametrelerdir; tarayıcı saatine göre gizli hesap yapılmaz. Vergi tutarları da para nesnesiyle taşınır; KDV hesaplama kuralı ilgili iş akışında ayrıca belirlenir.

## 3. Kapsam ve gezinme

Önerilen yol düzeni:

```text
GET /api/v1/firms/{firmId}/context
GET /api/v1/firms/{firmId}/branches
GET /api/v1/firms/{firmId}/products?branchId={branchId}
GET /api/v1/firms/{firmId}/sales/summary?branchId={branchId}&from={utc}&to={utc}
GET /api/v1/features/definitions
GET /api/v1/firms/{firmId}/branches/{branchId}/features
```

Firma içindeki toplu okumalarda `branchId` yoksa, yalnız yetkili olunan şubeler birleştirilir; yanıtta `scope` bunu açıkça belirtir. Modül durumu okuması ve değiştirme komutu ise bu ilk sözleşmede mutlaka tek şubeyi hedefler. `brandId` filtre olarak eklenebilir, ancak firma ve şube doğrulamasının yerine geçmez.

Kapsam yanıtı örneği:

```json
{
  "firm": { "id": "11111111-1111-4111-8111-111111111111", "name": "ABC Restoran Grubu" },
  "brands": [
    { "id": "22222222-2222-4222-8222-222222222222", "name": "PizzaMarka" }
  ],
  "branches": [
    { "id": "33333333-3333-4333-8333-333333333333", "brandId": "22222222-2222-4222-8222-222222222222", "name": "Kadıköy" },
    { "id": "44444444-4444-4444-8444-444444444444", "brandId": null, "name": "Ataşehir" }
  ]
}
```

Tek şubeli fixture aynı türde yalnız bir `branches` kaydı ve gerekirse boş `brands` listesi kullanır. UI marka satırını veri `brandId: null` olduğunda gizleyebilir.

## 4. Liste ve ayrıntı yanıtları

Tekil kaynak doğrudan nesne döner. Liste yanıtı `items` ve `pageInfo` taşır:

```json
{
  "items": [
    {
      "id": "55555555-5555-4555-8555-555555555501",
      "firmId": "11111111-1111-4111-8111-111111111111",
      "brandId": null,
      "branchIds": ["33333333-3333-4333-8333-333333333333"],
      "name": "Margherita Pizza",
      "sku": "PZZ-001",
      "category": { "id": "pizza", "name": "Pizzalar" },
      "status": "published",
      "channels": ["pos", "qr", "delivery"],
      "image": "🍕",
      "recipeLinked": true,
      "price": { "amountMinor": 32000, "currency": "TRY" },
      "priceSource": "central",
      "updatedAt": "2026-10-05T09:30:00Z",
      "version": 1
    }
  ],
  "pageInfo": { "page": 1, "pageSize": 25, "totalItems": 1, "totalPages": 1 },
  "scope": {
    "firmId": "11111111-1111-4111-8111-111111111111",
    "branchId": "33333333-3333-4333-8333-333333333333"
  },
  "categories": [{ "id": "pizza", "name": "Pizzalar" }]
}
```

Toplu görünümde `scope.branchId` `null` olur. `items: []` geçerli boş durumdur; hata veya modül kapalı anlamına gelmez. Ürünlerin `branchIds` alanı görünürlük örneğidir. `priceSource: central` merkez fiyatının gösterildiğini, `branch_override` seçili şubeye özgü fiyatın sunucu tarafından döndürüldüğünü anlatır. Frontend geçerli fiyatı hesaplamaz. Ayrıntı yanıtı buna ek olarak `description`, `allergens` ve `optionGroups` taşır. Merkezden miras ve şube istisnalarının kesin kuralları backend tasarımında ayrıntılandırılır. Gerçek API'nin bu alanları aynen kullanması zorunlu değildir; prototip boyunca tek bir sözleşme kullanılması zorunludur.

## 5. Modül kataloğu ve şube durumu

`FeatureDefinition` kataloğu ile `BranchFeatureState` şube durumu ayrı yanıtlar/alanlardır. Tanımda sabit `key`, ad, açıklama, kapsam, bağımlılık ve ürün olgunluğu vardır. Şube durumunda istenen tercih ile yeni işlem yapabilme durumu ayrıdır:

```json
{
  "key": "inventory.recipes",
  "name": "Stok ve Reçete",
  "scopeType": "branch",
  "availability": "prototype",
  "dependencies": ["catalog.products", "inventory.items"]
}
```

```json
{
  "key": "inventory.recipes",
  "firmId": "11111111-1111-4111-8111-111111111111",
  "branchId": "33333333-3333-4333-8333-333333333333",
  "desiredEnabled": true,
  "effectiveForNewWork": false,
  "lifecycle": "setup_required",
  "blockers": [
    { "code": "RECIPE_ITEMS_MISSING", "message": "Önce hammaddeleri tanımlayın." }
  ],
  "inFlightWorkCount": 0,
  "version": 2,
  "updatedAt": "2026-10-05T09:30:00Z"
}
```

`availability`: `real`, `backend_preview`, `prototype`, `planned`. `backend_preview`, geliştirme ortamında gerçek sunucu komutu bulunan ama gerçek kullanıcı kimliği/panel akışı veya yayın kapıları tamamlanmamış yetenektir; üretime hazır anlamına gelmez. `lifecycle`: `disabled`, `setup_required`, `provider_pending`, `ready`, `draining`. Bir özellik `prototype` durumundayken kullanıcı onu örnek olarak açabilir; `effectiveForNewWork` gerçek backend işlemi için `false` kalır. UI prototip akışını ayrıca gösterebilir. `desiredEnabled: true` tek başına kullanım izni değildir. Şimdiki mock tercihleri yalnız bellekte tutar; sayfa yenileme onları sıfırlar.

Yerel .NET prototipi tanım/durum listeleri ve sürüm kontrollü PUT komutunu sunar. `X-Demo-Actor` yalnız geliştirme testleri içindir, güvenilir kimlik doğrulaması değildir. **Bu belgenin ilk taslak döneminde** PostgreSQL kapsamı modül tercihi ve katalogla sınırlıydı; sonrasında `sales`, `cari` ve `service` şemaları da eklendi. Güncel şema, endpoint ve bağımlılık envanteri [Backend Mimarisi](BACKEND_MIMARISI_VE_MODUL_BAGIMLILIKLARI.md) içindedir. Bellek modu yeniden başlatılınca sıfırlanır; PostgreSQL modunda her dilimin kendi kalıcılık sınırı vardır. `/_prototype/.../complete-one-work` yalnız testte devam eden bir işin bittiğini simüle eder; gerçek mutfak veya ödeme komutu değildir. Üretim kimlik doğrulaması ve stok/sayım/reçete operasyonları kapsam dışıdır.

Bağımlılık listesi katalogda gösterilir ve etkinleştirme öncesi denetlenir. Bağımlılıklar döngü oluşturamaz. Eksik bağımlılık kullanıcıya aktivasyon planı olarak gösterilir; sessizce başka şubelerde değişiklik yapılmaz.

### Açma/kapama komutu

İlk API taslağı yalnız tek şubeyi hedefler:

```text
PUT /api/v1/firms/{firmId}/branches/{branchId}/features/{featureKey}
```

```json
{ "desiredEnabled": false, "expectedVersion": 2 }
```

Yanıt güncel modül durumudur. `expectedVersion` uyuşmazsa çatışma döner; istemci güncel durumu okuyup kullanıcıya gösterir. İstek tekrarı yeni yan etki üretmez. Gerçek backend'de komut yetkisi ve seçili kapsam sunucuda denetlenir.

### Kullanımdayken kapatma

Kabul edilen kural:

1. Kapatma isteğinden sonra yeni iş başlatma engellenir (`effectiveForNewWork: false`).
2. Devam eden kritik işler tutarlı şekilde sonuçlanır. Bunun mümkün olmadığı alanlarda güvenli bekleme veya açık hata durumu tanımlanır.
3. Geçmiş kayıtlar salt okunur kalır; veri silinmez.
4. Devam eden iş varsa `lifecycle: "draining"`; tamamlandığında `disabled` döner.
5. Ödeme, mutfak ve entegrasyon modülleri için “devam eden iş” sınırı ilgili iş akışında ayrıca tanımlanır.

Frontend `draining` durumunu “Yeni işlem kapalı; devam eden işler tamamlanıyor” gibi açıklayıcı metinle gösterir. Modül kapatma veritabanı migrasyonu tetiklemez.

## 6. Hata ve boş durum sözleşmesi

Hatalar ASP.NET Core'un desteklediği Problem Details biçiminde döner. `type`, `title`, `status`, `detail`, `instance` standart alanlarına işlenebilir `code` ve izleme için `traceId` eklenir:

```json
{
  "type": "https://api.example.test/problems/feature-setup-required",
  "title": "Kurulum gerekiyor",
  "status": 409,
  "detail": "Stok ve Reçete özelliği için önce hammadde tanımlayın.",
  "instance": "/api/v1/firms/11111111-1111-4111-8111-111111111111/branches/33333333-3333-4333-8333-333333333333/features/inventory.recipes",
  "code": "FEATURE_SETUP_REQUIRED",
  "traceId": "example-trace-id"
}
```

Örnek durum eşlemesi: `400` hatalı istek, `401` oturum yok, `403` yetkisiz kapsam/işlem, `404` görünür olmayan kayıt, `409` iş kuralı veya sürüm çatışması, `422` alan doğrulama hatası, `503` geçici sağlayıcı sorunu. Kesin hata kodları OpenAPI dosyasında sabitlenir. Ağ hatası ayrı istemci durumudur. Boş liste, yükleniyor, kapalı modül ve sağlayıcı bekleme durumları genel sunucu hatasına indirgenmez.

## 7. Mock veri uygulama kuralı

- Mock sağlayıcı gerçek API arayüzünü uygular; ekran bileşenleri `fetch` veya fixture dosyasını doğrudan çağırmaz.
- Fixture'larda firma, marka, şube ve kayıt kimlikleri tutarlıdır. A1 verisi A2 listesinde görünmez; konsolide rapor yalnız seçili kapsamı toplar.
- En az iki senaryo vardır: tek şubeli pizza/kahvaltı ve çok şubeli restoran. Her senaryoda açık/kapalı modül, kurulum eksiği, boş liste, hata ve yükleme örneği bulunur.
- Kaydetme prototipinde geçici ekran değişikliği gerekiyorsa bu açıkça “yalnız bu önizlemede” diye etiketlenir. Sunucuda kayıt oluştuğu söylenmez.
- Fixture kaynağına ait `demo` bilgisi uygulama katmanında tutulur; gelecekteki iş verisi JSON'unun içine sahte başarı bayrağı eklenmez.
- API eklendiğinde mock ve HTTP sağlayıcıları aynı sözleşme örnekleriyle doğrulanır. Sözleşme değişikliği sürümlendirilir.
- Frontend katalog sağlayıcısı `listProducts`, `getProduct`, `createDraft` ve `updateDraft` sözleşmelerini uygular. Varsayılan mock yazmayı açıkça reddeder. PostgreSQL migration'ı kurulduğunda `VITE_CATALOG_PROVIDER=http` ve `VITE_FEATURE_PROVIDER=http` ile temel taslak formu gerçek API'ye bağlanır. `catalogState` sorgu parametresi sadece mock durum önizlemesini seçer; API sözleşmesinin parçası değildir. Ayrıntı [Katalog Backend Sözleşmesi](KATALOG_BACKEND_SOZLESMESI.md) içindedir.

## 8. Açık teknik ayrıntılar

Bu taslak ilerlemeyi sağlayacak kadar belirgindir. Menü yayınlama mirası, merkez/şube istisnası, ödeme ve stok hesap kuralları kendi akışları tasarlandığında ayrıntılandırılır. Kimlik doğrulama biçimi ve nihai hata kodları backend başlamadan önce kararlaştırılır. Bu noktalar ilk yönetim paneli tasarımını durdurmaz.

## 9. Kaynaklar

- [ASP.NET Core 10 OpenAPI desteği](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/overview?view=aspnetcore-10.0)
- [ASP.NET Core API hata yanıtları](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api?view=aspnetcore-10.0)
- [EF Core eşzamanlılık denetimi](https://learn.microsoft.com/en-us/ef/core/saving/concurrency)
