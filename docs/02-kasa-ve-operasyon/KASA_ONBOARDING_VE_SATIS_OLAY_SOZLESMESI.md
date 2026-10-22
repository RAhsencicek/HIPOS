# HIPOS — Kasa Onboarding ve Satış–Kasa Olay Sözleşmesi

> **Durum:** Gelecek Entegrasyon Karar Taslağı (Henüz Kodda Uygulanmamıştır)
> **Son Güncelleme:** 21 Ekim 2026
> **Sorumlu:** Finans & Entegrasyon Mimarisi
> **Kapsam:** Satıştan kasaya otomatik hareket akışı, imza doğrulama kuralları ve olay formatı

---

> [!NOTE]
> Bu belge **uygulanmış bir API sözleşmesi DEĞİLDİR**; satıştan kasaya gerçek ödeme olaylarının nasıl yansıtılacağını belirleyen **Gelecek Entegrasyon Karar Taslağıdır**. Kasa MVP'si dondurulmuştur. Bu belge yeni POS endpoint'i, migration veya ödeme davranışı eklemez; sonraki dilimler için kabul edilmiş sınırları ve çözülmesi gereken kararları kaydeder.

Bu belge yalnızca mevcut **manuel kasa defterine doğrulanmış POS nakit olayını yansıtma** sınırını tartışır. Yeni kasa ekranının satış/adisyon/ödeme domain kapsamı daha geniştir ve [Kasa/POS Operasyon Sözleşmesi](KASA_POS_VE_OPERASYON_SOZLESMESI.md) içindedir. Token/Beko başvuru ve teknik bilgi toplama süreci [Entegrasyon Envanteri](../01-mimari-ve-altyapi/ENTEGRASYON_ENVANTERI_VE_TOKEN_SURECI.md) içindedir. Bu belgelerin hiçbiri gerçek provider entegrasyonu değildir.

## 1. Onboarding ve varsayılan kasa

### Bugünkü davranış

Firma ve şube oluşturma API'si/orkestrasyonu bu uygulamada henüz bulunmuyor. Mevcut provisioning API'si daha önce kalıcı hale gelmiş firma ve şube kimlikleri için ayrı çağrılır:

```http
PUT /api/v1/firms/{firmId}/branches/{branchId}/cash/registers/default
Content-Type: application/json
X-Demo-Actor: manager-...

{ "requestId": "<uuid>" }
```

Beklenen sonuç:

| Şube durumu | Sonuç |
|---|---|
| Hiç aktif kasa yok | `201`; etkin `MAIN / Ana Kasa / manual` oluşturulur ve provisioning audit'i aynı transaction'da yazılır. |
| Etkin, uyumlu MAIN zaten var | `200`; mevcut kayıt döner; yeni kasa/audit oluşmaz. Tekrar aynı requestId ile veya ayrı requestId ile güvenlidir. |
| MAIN yok, başka aktif kasa var (ör. KAD-01) | `409 EXISTING_REGISTER`; hiçbir kasa değiştirilmez/oluşturulmaz. |
| MAIN var fakat adı, sağlayıcısı veya etkinliği varsayılanla uyuşmuyor | `409 DEFAULT_REGISTER_CONFLICT`; mevcut kayıt değiştirilmez. |
| Yanlış firma/şube yetkisi | `403 UNAUTHORIZED_SCOPE`; kapsam verisi açığa çıkarılmaz. |

Şube başına transaction advisory lock, MAIN sorgusu ve aktif kasa kontrolü aynı transaction içinde çalışır. Provisioning `cash.management` tercihini açmaz. Seed'deki `KAD-01 / Kadıköy Ana Kasa` korunur; seed verisi onboarding'de yeniden adlandırılmaz.

### Gelecekteki onboarding çağrı noktası

Şube oluşturma özelliği geldiğinde önerilen sıra:

1. Firma/şube kimlikleri ve temel ayarları kalıcılaştır.
2. Varsayılan kasa provisioning'ini çağır.
3. Başarılıysa onboarding adımını tamamlandı olarak işaretle; başarısızsa kurulumu “tamamlanmadı / yeniden denenebilir” göster.
4. Retry aynı şube için güvenli olmalı; kasa capability'sini kullanıcı adına otomatik etkinleştirmemeli.

Bu akışın tek bir dağıtık transaction gibi sunulması doğru olmaz. Firma/şube kaydı tamamlanıp provisioning başarısız olabilir; orkestratör bu durumu saklamalı ve güvenli tekrar sunmalıdır. Provisioning endpoint'i tek başına firma/şube yaratmaz. Üretim onboarding'inde demo aktör başlığı yerine gerçek üyelik ve yetki doğrulaması gerekir.

## 2. Satıştan kasaya ilerideki olay

### Kabul edilmiş sınırlar

- Mevcut ödeme simülatörü yalnız satış ödeme durumunu gösterir; kasa veya cari hareketi üretmez. Bu davranış korunur.
- Gerçek entegrasyon diliminde yalnız sağlayıcı imzası sunucuda doğrulanmış, kesinleşmiş ve `method=cash` olan bağımsız ödeme olayı kasa hareketi oluşturabilir.
- Genel checkout/adisyon karma olsa bile sağlayıcı nakit parçasını bağımsız, imzalı, kesinleşmiş `cash` olayı olarak ayırıp kimliklendirebiliyorsa yalnız o nakit olayı işlenebilir. Ayrıştırılamayan karma olay `pending/review_required` saklanır ve kasa hareketi oluşturmaz.
- Kart/yemek kartı/online ödeme, pending/bekleyen, failed/başarısız, unknown/belirsiz parçalar kasayı etkilemez. Simüle ödeme olayları hiçbir durumda kasa hareketi oluşturmaz.
- Kesinleşmiş nakit tahsilatın sonradan iadesi, orijinal olayı/hareketi değiştirmez; orijinal olaya bağlı yeni bir telafi hareketi olarak ele alınır. İade olayı da sağlayıcıdan doğrulanmalı ve idempotent olmalıdır.
- İlk gerçek entegrasyon tek şube ve o şubedeki etkin `MAIN` kasa ile sınırlıdır. Çok şube/terminal-kasa yönlendirmesi bu dilimin dışındadır.
- Bu entegrasyon cari hareketi üretmez ve siparişin/ödemenin satış tarafındaki kaydını değiştirmez. Satış/ödeme kendi verisinin sahibi kalır; kasa nakit defterine doğrulanmış olayın bir yansımasını ekler.
- Orijinal hareket silinmez veya güncellenmez. İade, manuel hata düzeltmesindeki reversal ile aynı işlem değildir; ayrı provider refund event'i ve telafi hareketi olarak modellenir.
- Sağlayıcı uyarlaması, gerçek kimlik doğrulaması/imza doğrulaması ve firma/şube çözümlemesi `X-Demo-Actor` üzerinden yapılmaz.

### Önerilen olay zarfı

Bu alanlar sözleşme taslağıdır; mevcut API request'i değildir:

```json
{
  "provider": "<provider-code>",
  "providerEventId": "<provider-unique-event-id>",
  "externalReference": "<provider-payment-or-transaction-reference>",
  "firmId": "<firm-id>",
  "branchId": "<branch-id>",
  "orderId": "<sales-order-id>",
  "paymentId": "<sales-payment-id>",
  "status": "succeeded",
  "method": "cash",
  "amountMinor": 12500,
  "currency": "TRY",
  "occurredAt": "<provider-confirmed-time>"
}
```

`providerEventId` aynı sağlayıcı tarafından olayın tekrar gönderilmesinde sabit kalmalı; idempotency anahtarı firma + şube + provider + providerEventId kapsamındadır. `externalReference` satış/ödeme kaydına iz sürmeyi sağlar; tek başına idempotency anahtarı sayılmaz. İç API `requestId` ile sağlayıcının olay kimliği farklı sorumluluklardır.

### Önerilen kabul ve defter yansıtma kuralları

1. Sunucu sağlayıcı imzasını/kimliğini doğrular; payload'daki firma/şube/order/payment ilişkisinin kendi satış kaydıyla uyuştuğunu doğrular. İstemcinin gönderdiği `succeeded` veya `signatureVerified` alanı tek başına güven kanıtı değildir.
2. Yalnız imzalı/doğrulanmış, `status=succeeded`, bağımsız `method=cash`, pozitif tutarlı ve desteklenen para birimindeki olay kabul adayıdır. Simüle işaretli olay daima reddedilir/yoksayılır.
3. İlk aşamada firma/şube kapsamı tek tenant + tek şube ve etkin `MAIN` kasası ile sınırlandırılır. Olay uygun açık vardiyaya güvenle bağlanmadan `cash.movements` yazılmaz. Kasa hareketi ve audit aynı transaction'da oluşturulur; hareket `source=pos` ve sağlayıcı alanlarını taşır. Olayı manuel hareket gibi etiketlememek için hareket türü (`kind`) genişletmesinin migration ihtiyacı uygulama öncesi teyit edilir.
4. Aynı providerEventId ve aynı normalize edilmiş payload ikinci hareket yaratmaz; önceki sonuç döner. Aynı providerEventId farklı tutar, tender, satış referansı veya kapsam ile gelirse `409 PROVIDER_EVENT_CONFLICT` önerilir; mevcut defter satırı değişmez.
5. Kart ve diğer nakit dışı parçalar kasa hareketi yaratmaz. Tek ve ayrıştırılamayan karma olay bekleyen/inceleme gereken olarak saklanır; bağımsız ve doğrulanmış nakit parçası ise kendi olay kimliğiyle değerlendirilebilir. Pending, unknown, başarısız ve simüle olay kasa hareketi yaratmaz. İade orijinal satırı değiştirmeden ayrı telafi hareketi üretir. Hiçbir olay cari deftere otomatik yansımaz.

### Ekipçe onaylanan olay, karma ödeme ve vardiya davranışları

13 Ekim 2026'da ekipçe onaylandı:

- Yalnız bağımsız, imzalı, kesinleşmiş ve `method=cash` olan sağlayıcı olayı kasaya yazılır. Checkout karma olsa bile nakit parça sağlayıcı tarafından ayrı ve güvenilir olay olarak bildirilmelidir.
- Ayrıştırılamayan karma olay bekleyen/inceleme gereken olarak saklanır ve kasa hareketi oluşturmaz. Kart, bekleyen veya belirsiz parçalar kasayı etkilemez.
- İade mevcut kasa hareketini değiştirmez; orijinal ödeme olayına bağlı yeni telafi hareketi olarak işlenir.
- İlk gerçek entegrasyon tek şube ve etkin `MAIN` kasa ile sınırlıdır.
- Kesinleşmiş ödeme olayı geldiğinde uygun açık kasa vardiyası yoksa ödeme olayı satış tarafında kalıcı outbox/bekleyen entegrasyon kaydı olarak tutulur. Olay atılmaz; henüz `cash.movements` yazılmaz.
- Vardiya/provisioning hazır olunca aynı `providerEventId` ile güvenli tekrar işlenir; idempotency ikinci nakit hareketini engeller.
- Olayın zamanı kapalı vardiyaya denk geliyorsa ya da açık vardiyaya güvenle eşleştirilemiyorsa otomatik olarak kapalı vardiya değiştirilmez ve gelişigüzel sonraki vardiyaya aktarılmaz. Olay inceleme/uzlaştırma için bekler.
- Bekleyen ve inceleme gereken olayların işletmeci tarafından görünür olması; retry/uzlaştırma işlemlerinin audit edilmesi gelecek entegrasyon diliminin gereksinimidir.

Bu davranışlar şu anda uygulanmış değildir. Outbox'ın sahibi/şeması, yeniden deneme politikası, refund/telafi hareketinin tam alanları ve yönetici inceleme UX'i uygulama sözleşmesinde ayrıca belirlenecektir.

### Uygulama öncesi karara bağlanacak sorular

Bu belirsizlikler çözülmeden olay endpoint'i veya migration yazılmamalı:

1. **Provider/olay zamanı:** Hangi POS sağlayıcısının webhook/polling modeli kullanılacak; imza anahtarının rotasyonu, tekrar sıralaması, `occurredAt` doğrulaması ve TRY dışı para birimleri nasıl yönetilecek? Önerim ilk uygulamada seçilen provider için imza doğrulaması, yalnız TRY ve provider zamanı + sistem alım zamanının ayrı saklanması.
2. **Bekleyen olayların işletimi:** Outbox retry aralığı/sınırı, inceleme ekranı, yönetici retry/uzlaştırma yetkisi ve alarm eşiği nedir? Önerim `pending/review_required/processed/failed_retryable` durumlarının görünür ve audit'li olması; retry tükenince olay silinmemeli.
3. **İade ayrıntıları:** Onaylanan ilke orijinali değiştirmeyen, orijinal olaya bağlı yeni telafi hareketidir. Tam/parsiyel iade, bir ödemeye birden çok iade, iade olayının imzalanması/idempotency anahtarı ve kapalı vardiyada bekletme ayrıntıları uygulama öncesinde belirlenmelidir.
4. **Karma olay ilişkilendirmesi:** Bir cash event başka bir card event ile aynı order/checkout referansını paylaşabilir. Provider iki olayı da bağımsız biçimde doğruluyorsa nakit olayının kendi tutarının dışında kalan ödeme parçalarını yanlışlıkla nakde eklemediğini nasıl kanıtlayacağımız provider adaptörünün doğrulama kuralı olmalıdır.

Özellikle 1 ve 2. maddeler kesinleşmeden gerçek bir provider bağlantısı güvenli şekilde açılmamalıdır.

## 3. Gelecekteki kabul testi matrisi

- Doğrulanmış tek tender nakit olayı bir kasa hareketi ve bir audit üretir; satış kaydı değişmeden kalır.
- Aynı olay aynı payload ile tekrarlandığında ikinci hareket/audit oluşmaz; farklı payload aynı event kimliğiyle gelirse 409 olur.
- Kart, simüle, bekleyen, başarısız ve belirsiz ödeme parçaları kasa hareketi üretmez. Ayrıştırılamayan karma olay bekler; yalnız bağımsız ve doğrulanmış nakit olayı yazılır.
- İade, orijinal hareketi değiştirmeden orijinal provider event'ine bağlı tekil bir telafi hareketi üretir.
- İlk gerçek entegrasyonda yalnız tek şubenin etkin MAIN kasası hedeflenir.
- Cari hareket sayısı ve cari bakiyesi olay öncesi/sonrası değişmez.
- Farklı firma/şube/provider kapsamı reddedilir; olayın bağlantısız veya başka siparişe ait referansları kabul edilmez.
- Açık vardiya yok/geç olay/kapalı vardiya senaryoları, yukarıdaki ürün kararları kesinleştikten sonra veri kaybı olmadan test edilir.
- Denetim kaydı provider, externalReference, providerEventId, aktör/sistem kimliği ve zaman için izlenebilirlik sağlar; hassas ödeme verisi veya kart verisi loglanmaz.

## 4. Ayrı dilimler

1. Bu taslaktaki onboarding çağrı noktası ve olay/shift kararlarını ekipçe kesinleştir.
2. Sales ödeme domain'i, event inbox/outbox ve cash ledger sahipliğini belirle; gerekiyorsa API/OpenAPI/Postman sözleşmesini bu kararlardan üret.
3. Ancak onaydan sonra migration → API/adaptör → audit/idempotency → panel görünümü → PostgreSQL ve tarayıcı kabul testleri sırasına geç.

Mevcut durumda yalnız onboarding provisioning API'si uygulanmıştır. Bu belgedeki satış–kasa olay zarfı ve akış önerileri geleceğe yöneliktir; çalışır endpoint veya gerçek POS bağlantısı değildir.
