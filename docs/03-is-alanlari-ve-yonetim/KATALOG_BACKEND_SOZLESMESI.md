# HIPOS — Ürünler ve Menü backend sözleşmesi

Durum: PostgreSQL liste/detay okuması, şube bazlı kategori ve fiyatlı ürün oluşturma, ürün düzenleme, ilk POS yayını ve yayımlanmış ürünün fiyatını güncelleme uygulandı. Ürün aktifliği, menü aktifliği ve kanal yayını ayrı durumlar olarak korunur. Seçenek gruplarının API'si ve ürün ayrıntısındaki yönetim paneli, sipariş sırasında güncel katalogdan doğrulama ve fiyat snapshot'ı uygulandı; garson ve kasa hızlı satış ekranlarında seçenek seçimi bağlıdır. QR/web yayını, ileri tarihli fiyat ve yayın geri alma planlıdır.

## Bugün çalışan okuma dilimi

Yerel geliştirme örneğinde, PostgreSQL ve `CatalogDbContext` migration'ı kurulmuşsa:

```text
GET /api/v1/firms/{firmId}/catalog/products
    ?branchId={branchId}&query={text}&categoryId={id}&page=1&pageSize=25
GET /api/v1/firms/{firmId}/catalog/products/{productId}?branchId={branchId}
GET /api/v1/firms/{firmId}/catalog/categories?branchId={branchId}
```

Yanıtlar mevcut frontend `CatalogProvider` biçimini izler. `branchId` yoksa yalnız **bütün şubelerine erişimi olan** demo aktör firma kataloğundaki ürünleri merkez fiyatıyla görebilir; kategori listesi bu durumda boş döner. Şube seçilirse yalnız o şubeye görünür ürünler ve `catalog.categories` tablosundaki o şubeye ait kategoriler döner. Kategori listesi `{scope, items: [{id, name, productCount, version, isActive, sortOrder}]}` biçimindedir; ürün sayısı yalnız seçili şubenin ürünlerini sayar ve sıfır olabilir. Ürün listesindeki kategori filtresi de seçili şubenin kategori kapsamını kullanır. Arama ürün adı/SKU üzerinde çalışır; ürün listesi sayfalıdır. Ürün başka firma veya seçili şube kapsamında değilse detay `404` döner. Yetkisiz kapsam `403`, girişsiz istek `401` döner.

Başlangıç veritabanı boş olabilir. Şema migration'ı deployment komutudur, modül aç/kapa düğmesi bunu çalıştırmaz. Katalog migration'ı eksikse API `CATALOG_STORAGE_UNAVAILABLE` ile `503` döner. `X-Demo-Actor` yerel geliştirme akışından gelir ama API route'ları bunu Development/Production ayrımı olmadan okuyabilir; başlık taklit edilebilir ve gerçek kullanıcı güvenliği sağlamaz.

`catalog.products` genel prototip anahtarı için `effectiveForNewWork=false` kalır. Taslak komutları ayrı `catalog.drafts` anahtarına bağlıdır. Bu anahtar katalogda **`backend_preview`** etiketlidir: yalnız PostgreSQL şeması hazır, demo yönetici yetkili ve özellik ilgili şubede etkinse `effectiveForNewWork=true` olur; üretime hazır anlamına gelmez. Kapatma yeni taslak yazmasını durdurur, mevcut ürün okumasını kapatmaz. HTTP okuması `VITE_CATALOG_PROVIDER=http` ile seçilebilir; varsayılan ekran mock kalır.

## Bugün çalışan yönetsel taslak komutları

```text
POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/products
Body: { draftId, priceVersionId, name, sku, categoryId, categoryName, description, amountMinor, allergens }

PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}
Body: { requestId, name, sku, categoryId, categoryName, description, allergens, expectedVersion }

POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts
Body: { draftId, name, sku, categoryId, categoryName, description }

PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}
Body: { name, sku, categoryId, categoryName, description, expectedVersion }
```

`draftId` istemcinin ürettiği UUID'dir. İlk oluşturma `201`, değişmemiş aynı taslağın aynı içerikle hemen tekrar gönderilmesi `200` döner ve ikinci denetim kaydı üretmez. Kimlik başka içerik için kullanılırsa veya taslak daha sonra değiştirilmişse eski oluşturma gövdesi `409` çakışır; bu mekanizma genel amaçlı kalıcı bir idempotency-key sistemi değildir. Stok kodu firma içinde tektir. Güncelleme yalnız taslak sahibinin şubesinde yapılır; `expectedVersion` eskiyse `409`, başka şubenin taslağıysa `404` döner. Kaydedilen taslak ürün okuma modeline ve denetim kaydına aynı PostgreSQL işleminde yansır.

Panelde yeni ürün ve ilk pozitif TRY fiyatı tek işlemde kaydedilir; ürün `draft` durumunda, kanal listesi boş olarak oluşturulur. Ürün ancak ayrı POS yayın komutundan sonra satılabilir. `catalog.drafts` ve `catalog.price_drafts` yeni ürün komutu için hazır olmalıdır. Eski taslak oluşturma API'si fiyatı `0` olan kayıt oluşturmayı sürdürür. Taslak ve yayımlanmış ürün düzenlemeleri şubenin kategori kaydını doğrular. Alerjen alanı yönetim arayüzünden kaldırılmıştır; eski API alanı ve önceden kayıtlı veriler uyumluluk için korunur ve panel ürün düzenlerken bunları değiştirmez. Tek şubeye ait yayımlanmış ürün adı, kodu, kategorisi ve açıklaması güncellenebilir. Bu komut `catalog.drafts` ve `catalog.publishing` yeteneklerini, sürümü ve `requestId` tekrarını denetler; yayın anlık görüntüsü ve `catalog.product_edit_audit` aynı işlemde yazılır. Birden çok şubeye bağlı ürünün bilgilerini değiştirme henüz desteklenmez. Panel mock modunda kayıt yapılmaz.

## Ürün, menü ve kanal durumları

Ürün durumu üç ayrı eksende değerlendirilir; tek bir alan diğerinin yerine geçmez:

| Kavram | Anlamı |
| --- | --- |
| Ürün `isActive` | Katalog kaydının yeni taslak/yayın/sipariş işlemlerinde kullanılabilir olup olmadığı. Pasife alınması ürünü veya geçmişini silmez. |
| Ürün `status` | `draft` veya `published`: ürünün katalog/POS yayın akışındaki olgunluk durumu. |
| Ürün `channels` ve `publications.channels` | Ürünün hangi kanala yayınlandığı. İlk MVP yalnız `pos` kanalını yazar; QR/web etkinmiş gibi gösterilmez. |
| Menü `isActive` | Seçili şubede POS'ta kullanılabilir/aktif menü durumu. Bir şubede birden fazla menü aktif olabilir; menü içerik kaydından ve tekil ürün aktifliğinden ayrıdır. |

Ürün API yanıtları `isActive` alanını taşır. Yeni ürün aktif olarak oluşturulur. Aktiflik değişikliği şu şube kapsamlı komutla yapılır:

```text
POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/activation
Body: { requestId, expectedVersion, isActive }
```

Komut firma/şube kapsamını, katalog yazma capability'sini, demo yönetici yetkisini ve sürümü sunucuda doğrular. Aynı `requestId` ve içerik tekrarlanırsa önceki sonuç döner; aynı kimlik farklı içerikle gelirse `409 REQUEST_ID_CONFLICT`, eski sürümle gelirse `409 VERSION_CONFLICT` döner. Durum ve audit satırı tek PostgreSQL işlemiyle yazılır. Migration mevcut ürünleri varsayılan olarak aktif korur. Ürün aktif/pasifliği değişirken `status`, `channels`, fiyat ve geçmiş yayın anlık görüntüleri değiştirilmez.

Pasif ürün:

- Yeni satış/adisyon sipariş kalemine eklenemez (`409 PRODUCT_INACTIVE`).
- Yeni POS yayın komutu reddedilir (`409 PRODUCT_INACTIVE`).
- Yeni menü aktif etme doğrulamasından geçemez. Menü içeriğindeki ürün bağlantısı silinmez; durum düzenleyicide görünür.
- Ürün daha önce aktif bir menüde bulunuyorsa ürünün pasife alınması o menüyü kendiliğinden pasifleştirmez veya içeriğini değiştirmez. Menü düzenleyicisinde ürün açıkça “Pasif ürün” olarak işaretlenir; sonraki aktivasyon denemesi sunucuda reddedilir.
- Açık adisyon satırları, siparişin ürün/fiyat anlık görüntüsü, eski yayınlar ve raporlama kaynakları değişmeden kalır.
- Ürün ve geçmişi silinmez. Ürün yeniden etkinleştirilirse yeni işlemlerde diğer `draft/published`, fiyat ve kanal kuralları uygulanır.

Pasif menü seçili şubede yeni kullanım/aktif seçim oluşturmaz. Menü içeriği, ürünler, önceki aktiflik audit anlık görüntüleri ve ürün yayın geçmişi korunur. Menü pasifleştirmek içindeki ürünleri pasifleştirmez; ürün pasifleştirmek de diğer menüleri veya ürünün bütün yayın geçmişini silmez.

Yayın geçmişi ürünün şube ve kanal bazlı değiştirilemez kayıtlarıdır. Ürünü veya menüyü pasife alma geçmiş yayın satırlarını fiziksel olarak silmez ya da geriye dönük değiştirmez. Ürün aktifliği, menü aktifliği veya kanal yayını UI'da tek bir “yayında” göstergesinde birleştirilmemelidir.

## Ürün aktifliği kabul sınırları

1. Aktif ve POS'a yayımlanmış ürünle açık adisyon oluşturulur.
2. Aynı ürünle aktif menü oluşturulur; ürün beklenen sürümle pasife alınır ve `isActive=false` olarak okunur.
3. Açık adisyon ve önceden aktif menü okunmaya devam eder; sipariş kalemi, tutar anlık görüntüsü, menü aktifliği ve ürün bağlantısı değişmez. Menü düzenleyicisinde “Pasif ürün” görünür.
4. Aynı ürünle yeni sipariş denemesi `409 PRODUCT_INACTIVE` alır; yeni sipariş oluşmaz.
5. Aynı ürünle yeni POS yayın isteği ve pasif ürünü içeren menünün yeni aktivasyonu reddedilir; eski yayın geçmişi ve menü içeriği korunur.
6. Tekrar kullanılan `requestId` ikinci durum değişikliği/audit oluşturmaz; farklı içerikte çakışır. Eski `expectedVersion` reddedilir.
7. Ürün pasifliği başka firma/şube kapsamındaki ürünü değiştiremez; menü pasifliği menü kompozisyonunu ve katalog ürünlerini silmez.
8. Kayıt, sürüm, audit, UI durumu ve firma/şube denetimleri migration'lı PostgreSQL kabul testinde doğrulanır.

## İlk fiyat sürümü ve POS yayını

```text
PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/price
Body: { priceVersionId, amountMinor, expectedVersion }

POST /api/v1/firms/{firmId}/branches/{branchId}/catalog/drafts/{draftId}/publish
Body: { publicationId, expectedVersion }

PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/price
Body: { priceVersionId, amountMinor, expectedVersion }

GET /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/price-versions
GET /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/publications
```

Yetkili yönetici aynı şubenin taslağına pozitif TRY fiyatı yazar; her değişiklik ayrı, numaralı ve değiştirilmeyen `price_versions` kaydıdır. `expectedVersion` eskiyse `409` döner. Fiyat kimliğiyle aynı tutarı tekrar göndermek ikinci sürüm üretmez. Yayın, son fiyat sürümünü ve ürünün ad/kategori/kod/fiyatını `publications` anlık görüntüsüne aynı işlemde kaydeder; ürünü yalnız `pos` kanalında `published` yapar, taslak yazma kaydını kaldırır. Geçerli fiyat yoksa yayın reddedilir. Yayın kimliğiyle tekrar aynı istek ikinci yayın yaratmaz. Denetim kaydı, ürün projeksiyonu ve yayın birlikte tamamlanır. `catalog.price_drafts` ve `catalog.publishing` bağımsız şube yetenekleridir; modül kapalıysa yeni komut işlemez, geçmiş fiyat/yayın kayıtları okunabilir.

Yayımlanmış POS ürününün fiyatı güncellendiğinde şubedeki yeni satışlarda hemen geçerli olur; eski sipariş ve yayın anlık görüntüleri korunur. Fiyat sürümü, güncel fiyat ve yeni POS yayın kaydı tek işlemde yazılır. Aynı fiyat kimliği ve tutarının tekrarı aynı kaydı döner; sürüm çakışması reddedilir. Fiyat ve POS yayını yetenekleri hazır olmalıdır. Yayını geri alma, kanal seçimi ve ileri tarihli fiyat henüz yoktur.

## Bugün çalışan şube kategorisi komutları

```text
POST /api/v1/firms/{firmId}/catalog/categories?branchId={branchId}
Body: { id, name }

PUT /api/v1/firms/{firmId}/catalog/categories/{categoryId}?branchId={branchId}
Body: { name, expectedVersion }
```

Kategori kimliği firma ve şube içinde benzersizdir; aynı kimlik farklı şubelerde kullanılabilir. Oluşturma ve ad değiştirme için `branchId` zorunludur. Yalnız seçili şubeye erişen yönetici kendi şubesinde komut verebilir; başka şube yöneticisi veya salt okuma kullanıcısı `403` alır. Kategori oluşturma `201`, aynı şube/kimlik/adla tekrar `200`, aynı şube/kimliğin farklı adla kullanımı `409` döner. Ad değiştirme eski sürümle `409 VERSION_CONFLICT` döner. Değişiklik kategori satırını, yalnız o şubeye ait taslak/projeksiyon anlık görüntülerini ve denetim kayıtlarını **tek veritabanı işleminde** günceller. Mevcut firma kategorileri migration sırasında firmanın ürün kayıtlarında bulunan her şubeye kopyalanır; sonraki ad değişiklikleri şubeler arasında bağımsızdır. Bu henüz üretim kimlik/yetki sistemi değildir: yetki geliştirme ortamındaki demo aktörlerle sınanır. Kategori sıralama ve pasifleştirme sonraki dilimlerdir.

## Ekran → veri ve komut ayrımı

| Alt ekran grubu | Okuma ihtiyacı | Gelecek yönetsel komut | Durum |
| --- | --- | --- | --- |
| Ürünler, ürün ayrıntısı | Firma/şube ürün listesi, detay, arama; aktiflik ve kanal/yayın durumu ayrı görünür | Taslak oluştur/güncelle, etkinleştir/pasifleştir | Ürün aktifliği, audit ve API korumaları panel/API/PostgreSQL kabul testinde doğrulandı; ürün yayın geçmişi okunabiliyor. |
| Kategoriler | Seçili şubeye ait kategori listesi ve şube ürün sayısı | Şubede kategori oluştur/ad değiştir/sırala | Okuma, şube kapsamlı oluşturma ve ad değiştirme API/PostgreSQL'de var. Panel yazma formu içerir; sıralama ve pasifleştirme yok. |
| Seçenek grupları ve görseller | Ürün ilişkileri | Bağla/çıkar, görsel yükle | Ürün ayrıntısında grup ve seçenekleri yönetme ve ürüne bağlama API'ye bağlıdır. Ürün ayrıntısından JPEG, PNG ve WebP (en fazla 2 MB) yükleme API ve PostgreSQL’e bağlıdır; görsel ürün, menü ve operasyon ekranlarında görüntülenir. |
| Menüler ve kompozisyon | Menü–kategori–ürün hiyerarşisi; menü aktifliği ürün durumundan ayrıdır | Taslak menü düzenle, şubede etkinleştir/pasifleştir | Menü düzenleme ve aynı şubede birden fazla aktif menü desteği panel/API/PostgreSQL/POS'ta vardır; etkinleştirme aktif olmayan, yayınlanmamış, POS kanalında bulunmayan veya geçersiz fiyatlı ürün içeriyorsa reddedilir. |
| Kanal görünürlüğü | Ürün kapsamı | Taslak kanal görünürlüğü değiştir | İlk POS yayını vardır; diğer kanallar için görünürlük komutu yoktur. Ayrı şube görünürlüğü ekranı kaldırılmıştır; şube kapsamı ve izolasyonu korunur. |
| Fiyatlar ve sürümler | Merkez/şube fiyatı, geçerlilik | Fiyat taslağı, şube istisnası, sürüm oluştur | Şube taslağı için numaralı fiyat sürümü API'si, panel formu ve geçmiş okuması var; ileri tarih/merkez istisnası yok. |
| İleri tarihli fiyatlar | Zamanlanmış sürümler | Gelecek tarihli fiyat planla/iptal et | Planlandı. |
| Menü yayınlama ve geçmişi | Taslak/yayın sürümleri | Yayınla, geri al | İlk taslak → POS yayını ve geçmişi panelden çalışır; geri alma ve tekrar yayın yok. |

## Ürün seçenekleri — yönetim paneli ve sipariş API'si

EF modeli, migration, firma kapsamlı grup yönetimi API'si ve sipariş fiyatlama/snapshot entegrasyonu PostgreSQL'e uygulanmıştır. Ürün ayrıntısı grup ve seçenek yönetimine bağlıdır; garson ve kasa hızlı satış ekranlarında seçenek seçimi bağlıdır.

### Veri modeli

- `catalog.option_groups` firma kapsamında tekrar kullanılabilir grupları tutar. Grup birden fazla ürüne bağlanabilir; ürün-grup bağı yoksa ürün için o grup seçeneği bulunmaz.
- `catalog.option_items` bir grubun seçeneklerini tutar. Her seçenek işaretli `price_delta_minor BIGINT` kullanır; TRY tutarları kuruş cinsindendir ve negatif fiyat farkı geçerlidir.
- `catalog.product_option_groups` ürün-grup bağını, ürün üzerindeki sıralamayı ve o ürün için `min_selections` / nullable `max_selections` sınırlarını tutar. Aynı grup farklı ürünlerde farklı seçim sınırlarıyla kullanılabilir.
- Grup sınırları farklı seçilmiş seçenek kimliklerini sayar; seçenek adetleri bu sayıya dahil değildir. Seçenek bazında `quantity_enabled` ve `max_quantity` bulunur. Adet girişi kapalı seçenek bir kez seçilir; açıksa seçilen adet en az 1 ve tanımlı üst sınırı aşmayacak biçimde doğrulanır.
- Pasif grup ve seçenek sipariş sırasında seçilebilir. `is_active` bu hedef akışta seçimi engellemez. Ürün aktifliği kuralı bundan ayrıdır: pasif ürün yeni siparişe eklenemez ve yeniden aktifleştirilene kadar mevcut `409 PRODUCT_INACTIVE` kuralı korunur.

Eski `catalog.products.option_groups` metin dizisi normalize grup ve seçeneklere dönüştürülmeyecek; eski değerlerin korunması gerekmiyor. Eski kod tüketicileri yeni ilişkilere geçirildikten sonra bu alanı kaldıran ileri migration yapılabilir. Uygulanmış migration dosyaları geriye dönük değiştirilmez.

### Grup yönetimi API'si

Firma çapında tekrar kullanılabilir grup tanımları, firma şubelerine erişimi olan yöneticilerce yönetilir. Grup/seçenek kayıtları pasif olsa bile okuma yanıtlarında döner. `requestId` ile aynı içerik tekrarlanırsa önceki anlık yanıt döner; aynı kimlik farklı içerikle gelirse `409 REQUEST_ID_CONFLICT` döner. Grup sürümü seçenek ekleme/düzenleme işlemlerinde de ilerler; ürün-grup bağlantısı ürünün ve varsa taslağın sürümünü ilerletir. Denetim snapshot'ları `catalog.option_management_audit` tablosuna yazılır.

```text
GET  /api/v1/firms/{firmId}/catalog/option-groups
POST /api/v1/firms/{firmId}/catalog/option-groups
PUT  /api/v1/firms/{firmId}/catalog/option-groups/{groupId}
POST /api/v1/firms/{firmId}/catalog/option-groups/{groupId}/items
PUT  /api/v1/firms/{firmId}/catalog/option-groups/{groupId}/items/{itemId}
GET  /api/v1/firms/{firmId}/catalog/products/{productId}/option-groups
PUT  /api/v1/firms/{firmId}/catalog/products/{productId}/option-groups
```

Grup oluşturma gövdesi `requestId`, `name`, `isActive`, `sortOrder` alır; `requestId` grup UUID'si olarak da kullanılır. Grup düzenleme bunlara `expectedVersion` ekler. Seçenek oluşturma `requestId`, `name`, `priceDeltaMinor`, `quantityEnabled`, `maxQuantity`, `isActive`, `sortOrder` ve grubun beklenen sürümünü alır; `requestId` seçenek UUID'sidir. Seçenek düzenleme gövdesi `expectedVersion` ile grubun mevcut sürümünü ister. Adet girişi kapalıysa `maxQuantity` tam 1 olmalıdır; fiyat farkı işaretli `BIGINT` olarak kabul edilir.

Ürün-grup PUT gövdesi `requestId`, ürünün `expectedVersion` değeri ve `{ groupId, minSelections, maxSelections, sortOrder }` listesi alır. Bu liste ürünün grup bağlantılarının tamamını değiştirir; listeden çıkarılan grup o üründen ayrılır. Grup aynı firmaya ait olmalı, aynı ürün için tekrarlanmamalı; alt sınır seçenek sayısını aşmamalıdır. Seçim sayımı farklı seçenekleri esas alır, seçenek adedini değil. Fiziksel grup/seçenek silme uç noktası bu API diliminde yoktur.

### Sipariş doğrulaması, fiyat ve anlık görüntü

Sipariş oluşturma sırasında sunucu seçilen grup ve seçenek kimliklerini güncel katalogdan çözer. Seçenek, ürünün bağlı olduğu gruba ait olmalı; grup sınırları, seçenek adedi ve seçenek üst sınırı sunucuda doğrulanmalıdır. İstemciden gelen ad veya fiyat, fiyat hesabının kaynağı değildir. Pasif ürün reddedilir; pasif grup/seçenek tek başına ret nedeni değildir.

Her ürün birimi için hesaplama:

```text
birim_fiyat = sipariş anındaki temel ürün fiyatı
            + Σ(seçenek sipariş anındaki birim fiyat farkı × seçilen seçenek adedi)
```

Hesaplanan ürün birim fiyatı sıfırın altındaysa sipariş reddedilir; sıfır kabul edilir. Kalem toplamı bu birim fiyatın sipariş edilen ürün adediyle çarpılmasıyla hesaplanır.

Sipariş kalemi temel ürün fiyatını ve hesaplanan nihai birim fiyatı ayırt edilebilir şekilde saklar. `options_json` sipariş anındaki grup/seçenek kimliklerini ve adlarını, seçenek adetlerini ve birim fiyat farklarını taşır. Katalogda sonradan yapılan ad, fiyat veya ilişki değişiklikleri mevcut sipariş kaleminin tutarını ve görüntüsünü değiştirmez. Sipariş seçenekleri yayımlanmış POS anlık görüntüsünden değil, sipariş anındaki güncel katalogdan doğrulanır; bu nedenle istemcide eski kalmış seçenek sunucu tarafından reddedilebilir.

Sipariş gövdesi seçenekler için `{ groupId, optionId, quantity }` kimliklerini taşır. Eski `{ groupName, optionName }` etiket girdisi fiyatlandırılmış seçenek kabul edilmez; istemcilerin bu girdiyi seçme kimlikleriyle değiştirmesi gerekir. Yanıtlarda sipariş anı snapshot'ı ad ve fiyat farkını içerir.

Sipariş API'si bu doğrulamayı kullanır. Garson ekranı ve QR menü için seçenek seçme deneyimi ayrıca tamamlanmalıdır.

### Kategori ve şube kapsamı kararı

Ürün listesindeki kategori sekmeleri ve ayrı Kategoriler ekranı sağlayıcının döndürdüğü veriden oluşur. Kategori tablosunun anahtarı firma, şube ve kategori kodudur. Kategori ekranından ürün listesi ilgili kategoriye göre açılabilir veya ürün taslağı seçili kategoriyle başlatılabilir. Taslak formu kategorileri seçili şubenin API listesinden alır ve seçilen kategori kimliğini ve güncel adını taslak komutuna gönderir.

Kategori seçili şubeye aittir. Bir kategorinin bulunması, o şubedeki ürünlerin POS'a yayınlandığı anlamına gelmez. Ürün oluşturma ve kategori yönetimi yetkileri ayrı doğrulanır; ürün taslağı oluşturma yetkisi kategori değiştirme yetkisi vermez.

## Yazmaya geçmeden önce korunacak kurallar

1. Ürün/kategori/fiyat için veri sahipliği ve firma/şube sınırı backend'de net olmalı. Bugünkü `catalog.products` tablosu **okuma modeli**, `catalog.drafts` ilk dar yazma modelidir. Kategori adı ve şube ID dizisi gibi alanlar denormalizedir; bütün kataloğun son domain modeli sayılmamalı.
2. Yeni iş komutu gerçek kullanıcı kimliği, firma/şube üyeliği, yetki, ilgili capability'nin `effectiveForNewWork` durumu, kurulum ve bağımlılıkları **sunucuda** denetlemeli. `desiredEnabled=true` tek başına izin değildir.
3. Taslak/fiyat değişikliği `expectedVersion` ile çakışmayı yakalamalı; tekrar edilen komutun sonucu ve denetim kaydı belirlenmeli.
4. Yayın, şube/kanal kapsamı ve fiyat sürümünü atomik, doğrulanabilir bir anlık görüntüye bağlamalı. Geçmiş satış tutarı sonraki fiyat değişiminden etkilenmemeli.
5. Modül kapalıysa yeni taslak/yayın komutu engellenir; mevcut ürün ve yayın geçmişi okunabilir kalır. İşlem sırasında kapatmanın nasıl davranacağı ayrıca test edilir.
6. Frontend gerçek API başarısı gelmeden “kaydedildi/yayınlandı” demez. Boş, hata, yetkisiz, kapalı ve migration eksik durumları ayrı gösterilir.

## Sıradaki teknik dilim

Fiyatlı ürün kaydı, tek şubeli yayımlanmış ürün düzenleme, fiyat güncelleme ve POS yayını panelden API'ye bağlıdır. Gerçek HIPOS hesabı/şube üyeliği pilot öncesi kapıdır. Daha kapsamlı şube/kanal görünürlüğü, yayını geri alma ve ödeme sözleşmesi henüz tamamlanmadı.


## Ürün görseli

Ürün ayrıntısında bilgisayardan JPEG, PNG veya WebP seçilerek ürün görseli kaydedilir (en fazla 2 MB). Görsel `catalog.product_images` içinde kalıcıdır; ürünün `image` alanı görsel kaydının kimliğini taşır. Ürün listesi, menü ve POS/garson ekranları görseli şube kapsamlı ve aktör başlıklı API üzerinden okur; eski emoji gösterimi korunur. Görsel yüklemesi önceden oluşturulmuş, tek şubeli ürünlerde çalışır.

`PUT /api/v1/firms/{firmId}/branches/{branchId}/catalog/products/{productId}/images?requestId={uuid}&expectedVersion={version}` dosya baytlarını gövde olarak alır; yönetici kapsamı ve `catalog.drafts`, yayımlanmış ürün için ayrıca `catalog.publishing` gerektirir. Biçim sunucuda dosya imzasıyla kontrol edilir. Ürün/draft sürümü ve görsel kaydı aynı işlemde güncellenir; istek kimliği, içerik özeti, aktör ve zaman saklanır. Aynı istek tekrarı ikinci kayıt oluşturmaz; farklı içerikle aynı kimlik reddedilir. Önceki görseller geçmişte korunur. `GET .../images/{imageId}` aynı firma/şube kapsamında okuma yetkisi ister. `AddProductImages` katalog migration'ı uygulanmalıdır. Gerçek kimlik doğrulama henüz yoktur; mevcut demo aktör güvenlik sınırı değildir.
