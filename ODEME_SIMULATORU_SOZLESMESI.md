# HIPOS — Test ödeme çekirdeği sözleşmesi

Durum: **Yalnız Development prototipi.** Bu dilim PostgreSQL'de ödeme **girişimi ve sonucu** saklar; banka, Koddata cihazı, gerçek nakit tahsilatı, mali belge veya mutabakat yapmaz. `simulated: true` alanı ve arayüz etiketleri hiçbir sonucu gerçek ödeme gibi sunmaz.

## 1. Sahiplik ve kapsam

- Ödeme girişimi `sales.payment_attempts` tablosunda, sonucu `sales.payment_attempt_audit` tablosunda saklanır. Siparişin toplu ödeme durumu `sales.orders.payment_status` alanına yansır.
- Her istek firma, şube ve sipariş kapsamını sunucuda doğrular. Örnek POS aktörü başlatır/sonuçlandırır; yönetici yalnız okur. `X-Demo-Actor` gerçek oturum veya üretim yetkisi değildir.
- `payments.simulator` şube özelliği yeni girişimi kapatır. Kapatılmış olsa da önceden başlamış `pending`/`unknown` girişim sonuçlandırılabilir ve geçmiş okunur. Sipariş açma modülü kapalıyken mevcut siparişlerin ödeme işi devam edebilir.
- Migration deployment adımıdır; modül aç/kapa tablo oluşturmaz veya veri silmez.

## 2. Girişim ve sipariş durumu

| Girişim sonucu | Siparişe etkisi | Yeni girişim |
| --- | --- | --- |
| `succeeded` | Tutar başarılı simülasyon toplamına eklenir; sipariş `partially_paid` veya `paid` olur. | Kalan tutar varsa mümkün. |
| `failed` | Tutar eklenmez; önceki başarılı toplam korunur. | Mümkün. |
| `pending` | Sipariş ödeme durumu `pending`; gerçek başarı varsayılmaz. | Sonuç çözülene dek engelli. |
| `unknown` | Sipariş ödeme durumu `unknown`; gerçek başarı varsayılmaz. | Sonuç çözülene dek engelli. |
| `cancelled` | Yalnız bekleyen/belirsiz girişimin simülatör tarafından doğrulanmış iptal sonucu; tutar eklenmez. | Mümkün. |

Siparişin `paidMinor` değeri yalnız `succeeded` girişimlerden hesaplanır; `remainingMinor = totalMinor - paidMinor`. Tutar kalan kısmı aşamaz. Birden fazla kısmi girişim ve `cash`/`card` karışımı test edilebilir. Tam simüle ödeme sonrası sipariş **`open` kalır**; operasyonel kapanış, iade ve raporlama ayrı işlerdir. Böylece “ödendi” sonucundan sessizce “servis tamamlandı” anlamı çıkarılmaz.

## 3. HTTP sözleşmesi

Tüm uçlar `/api/v1/firms/{firmId}/branches/{branchId}/sales/orders/{orderId}` altında:

- `GET /` → seçili sipariş, `paymentStatus`, `paidMinor`, `remainingMinor` ve sürüm.
- `POST /payment-attempts` → `{ attemptId, amountMinor, method: "cash" | "card", simulatedOutcome: "succeeded" | "failed" | "pending" | "unknown", expectedOrderVersion }`.
- `GET /payment-attempts` → girişim geçmişi; modül kapalıyken de okunur.
- `POST /payment-attempts/{attemptId}/resolve` → `{ outcome: "succeeded" | "failed" | "cancelled", expectedOrderVersion }`. Yalnız `pending`/`unknown` girişimler sonuçlandırılır. Bu, simülatörün kesin cevabını taklit eder; dış sağlayıcı doğrulaması değildir.

Yeni girişim `201`, aynı `attemptId` ve aynı içerikle tekrar `200` döner; farklı içerik `409` olur. `expectedOrderVersion` eskiyse `409`. Kesin sonuca ulaşmış çözüm isteğinin aynı sonucu tekrarı ikinci kayıt üretmez. `pending` veya `unknown` varken farklı kimlikle yeni girişim `PAYMENT_UNRESOLVED` ile reddedilir. Ağ yanıtı kaybolursa istemci aynı `attemptId` ile tekrar eder veya geçmişi kontrol eder; belirsizliği otomatik başarıya dönüştürmez.

## 4. Kabul ve sınırlar

- Geçici PostgreSQL testinde: kısmi başarı, belirsiz sonuç, yeniden deneme, çözüm, iptal, kalan tutar, çift girişim engeli, yetkisiz aktör, şube ayrımı, sürüm çakışması ve denetim kaydı doğrulanır.
- Tarayıcıda ayrı Test POS sonuç üretir; yönetim paneli sonucu **simüle** etiketiyle salt okunur gösterir.
- Gerçek tahsilat, kart verisi, iade, kasa vardiyası, mutabakat, mali belge, sağlayıcı webhook'u ve rapor projeksiyonu yoktur.
- Gerçek Koddata/banka adaptörü için sağlayıcı cevabı, `unknown` uzlaşması, zaman aşımı, güvenli anahtar saklama ve çift tahsilat önleme ayrı kabul testleri ister. Simülatörün `succeeded` sonucu bu doğrulamaların yerine geçmez.
