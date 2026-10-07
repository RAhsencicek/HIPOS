# HIPOS — Test POS ve ilk sipariş sözleşmesi

Durum: **Geliştirme prototipi.** `apps/pos` yönetim panelinden ayrı bir operasyon yüzüdür; gerçek kullanıcı oturumu veya ödeme cihazı bağlantısı içermez. Kaydettiği sipariş gerçek PostgreSQL kaydıdır, fakat demo aktör ve test ürünleriyle oluşturulur. Müşteri kullanımına açılmaz.

## İlk dar akış

```text
Yayınlanmış ve POS kanalında açık ürün
→ test POS'tan sipariş oluşturma
→ sales.orders ve sales.order_lines'a fiyat anlık görüntüsü
→ yönetici satış ekranından salt okunur izleme
```

`POST /api/v1/firms/{firmId}/branches/{branchId}/sales/orders` gövdesi `{ orderId, items: [{ productId, quantity }] }` alır. İstemci fiyat veya ürün adı göndermez. Sunucu ürünün aynı firma/şubede görünür, `published`, `pos` kanalında ve pozitif TRY fiyatlı olmasını denetler. Satış anındaki ürün adı, SKU, adet, birim fiyat ve toplam sipariş kalemine kopyalanır. Şube fiyat istisnası varsa o kullanılır. İlk sipariş `open` ve `unpaid` durumunda kalır; ödeme alınmış veya sipariş kapanmış sayılmaz.

Sipariş yalnız ilgili şubenin **test POS aktörü** tarafından oluşturulur. Yönetici ve rapor kullanıcısı sipariş açamaz; `GET /api/v1/firms/{firmId}/sales/orders?branchId=...` ile yetkili kapsamını salt okunur görür. `branchId` yoksa ancak firmanın bütün şubelerine erişen yönetici firma listesini görür. Liste şu an en son 100 kaydı döner; sayfalama sonraki iştir.

Yeni sipariş, `sales.pos_orders` özelliğinin `effectiveForNewWork=true` durumuna bağlıdır. Bu özellik yalnız katalog ve satış migration'ları hazırsa etkinleşebilir. Kapatma yeni siparişi durdurur, eski siparişin okumasını engellemez. Kayıt ile denetim satırı aynı PostgreSQL işleminde yazılır. Aynı `orderId` ve aynı kalem/adet tekrar gönderilirse var olan sipariş `200` döner; farklı içerik veya kapsam `409` çakışır. Ağ sonucu belirsiz kaldığında POS aynı kimlikle tekrar deneyebilir.

Panel `VITE_SALES_PROVIDER=http` olduğunda listeyi API'den okur ve beş saniyede bir yeniler. Bağlantı/migration hatasında örnek veriye sessizce düşmez. Varsayılan mock modu eski görsel prototiptir; gerçek sipariş diye sunulmaz.

## Bilerek henüz yapılmayanlar

- Gerçek HIPOS hesabı, POS personeli yetkisi ve cihaz kimliği: bugünkü `X-Demo-Actor` yalnız Development içindir.
- Panelden satılabilir ürün yayınlama/fiyat sürümü: test veritabanında yayınlanmış fixture kullanılır. Üretim siparişinden önce fiyat sürümü ve atomik yayın modeli gerekir.
- Masa/adisyon çoklu kalem düzenleme, iptal, ikram, KDS, stok tüketimi ve sipariş kapatma.
- Ödeme simülatörü, nakit/kart sağlayıcısı, iade ve mutabakat. `unpaid` dışında ödeme durumu henüz yazılamaz.
- Push bağlantısı ve çevrimdışı POS: panel şu an periyodik okur. POS ağ kesintisinde yerel kuyruk tutmaz.
- Koddata donanımı entegrasyonu: protokol, SDK ve cihaz testleri gelmeden tamamlandı sayılmaz.

## Kabul testi

Geçici PostgreSQL testinde yalnız POS aktörü kendi şubesine sipariş açar; yöneticinin yazması reddedilir. Taslak/kanalı kapalı ürün satılamaz. Şube fiyatı siparişe kopyalanır. Aynı isteğin tekrarı ikinci sipariş/denetim satırı doğurmaz. Modül kapalıyken yeni kayıt engellenir, geçmiş okunur. Sunucu yeniden başlatılınca kayıt durur. Playwright testi ayrı test POS ekranından kaydeder ve yönetim panelinin salt okunur ekranında aynı siparişi görür.
