# HIPOS — Test POS ve ilk sipariş sözleşmesi

Durum: **Geliştirme prototipi.** `apps/pos` yönetim panelinden ayrı bir operasyon yüzüdür; gerçek kullanıcı oturumu veya ödeme cihazı bağlantısı içermez. Kaydettiği sipariş ve simüle ödeme sonucu PostgreSQL kaydıdır, fakat demo aktör ve test ürünleriyle oluşturulur. ASP.NET API'de bu test akışını `Development` ortamıyla sınırlayan guard yoktur; `X-Demo-Actor` taklit edilebilir, bu yüzden müşteri kullanımına/açık ağa çıkarılmaz. Gerçek tahsilat yoktur.

## İlk dar akış

```text
Yayınlanmış ve POS kanalında açık ürün
→ test POS'tan sipariş oluşturma
→ sales.checks → sales.orders ve sales.order_lines fiyat anlık görüntüsü
→ isteğe bağlı simüle ödeme girişimi ve sonucu
→ yönetici satış ekranından salt okunur izleme
```

`POST /api/v1/firms/{firmId}/branches/{branchId}/sales/orders` gövdesi `{ orderId, items: [{ productId, quantity }] }` alır. İstemci fiyat veya ürün adı göndermez. Sunucu ürünün aynı firma/şubede görünür, `published`, `pos` kanalında ve pozitif TRY fiyatlı olmasını denetler. Satış anındaki ürün adı, SKU, adet, birim fiyat ve toplam sipariş kalemine kopyalanır. Şube fiyat istisnası varsa o kullanılır. İlk sipariş `open` ve `unpaid` durumunda kalır. Ardından yalnız [test ödeme simülatörü](ODEME_SIMULATORU_SOZLESMESI.md) durum kaydı oluşturabilir; gerçek tahsilat yapılmaz ve sipariş otomatik kapanmaz.

Bu belge eski test POS endpoint akışını anlatır. `POST /api/v1/firms/{firmId}/branches/{branchId}/sales/orders` siparişi oluştururken aynı transaction'da self-servis ortak check de oluşturur. Modern ortak adisyon sözleşmesi check açma, adisyona yeni sipariş ekleme, liste/detay ve check üzerinden simüle ödeme için [ORTAK_ADISYON_SOZLESMESI.md](ORTAK_ADISYON_SOZLESMESI.md) içindedir. Garson web akışı `/service/tables/{tableId}/orders` çağırır ve açık masa atamasına bağlı check'i oluşturur/kullanır. API endpoint'lerinde bugünkü `DemoAccess` yöneticiyi/operatörü taklit edilebilir `X-Demo-Actor` değerinden çözer; bu gerçek kullanıcı/rol sistemi değildir. Sipariş listeleme en son 100 check/order ile sınırlıdır.

Yeni sipariş, `sales.pos_orders` özelliğinin `effectiveForNewWork=true` durumuna bağlıdır. Bu özellik yalnız katalog ve satış migration'ları hazırsa etkinleşebilir. Kapatma yeni siparişi durdurur, eski siparişin okumasını engellemez. Kayıt ile denetim satırı aynı PostgreSQL işleminde yazılır. Aynı `orderId` ve aynı kalem/adet tekrar gönderilirse var olan sipariş `200` döner; farklı içerik veya kapsam `409` çakışır. Ağ sonucu belirsiz kaldığında POS aynı kimlikle tekrar deneyebilir.

Panel `VITE_SALES_PROVIDER=http` olduğunda listeyi API'den okur ve beş saniyede bir yeniler. Bağlantı/migration hatasında örnek veriye sessizce düşmez. Varsayılan mock modu eski görsel prototiptir; gerçek sipariş diye sunulmaz.

## Bilerek henüz yapılmayanlar

- Gerçek HIPOS hesabı, POS personeli yetkisi ve cihaz kimliği: bugünkü `X-Demo-Actor` Development ile sınırlı değildir ve taklit edilebilir; gerçek auth değildir.
- Merkezi/çok şubeli fiyat ve yeniden yayın kuralları. İlk fiyat sürümü ve POS yayını yönetici formundan API'ye bağlıdır; üretim satışından önce daha geniş kapsam netleşmelidir.
- Masa/adisyon kalem düzenleme, iptal, taşıma/birleştirme, ikram, gerçek KDS durumu, stok tüketimi, adisyon kapama/tahsilat.
- Gerçek nakit/kart sağlayıcısı, iade ve mutabakat. Simülatör yazdığı durumu gerçek tahsilat saydırmaz.
- Push bağlantısı ve çevrimdışı POS: panel şu an periyodik okur. POS ağ kesintisinde yerel kuyruk tutmaz.
- Koddata donanımı entegrasyonu: protokol, SDK ve cihaz testleri gelmeden tamamlandı sayılmaz.

## Kabul testi

Geçici PostgreSQL testinde yalnız POS aktörü kendi şubesine sipariş ve simüle ödeme girişimi açar; yöneticinin yazması reddedilir. Taslak/kanalı kapalı ürün satılamaz. Şube fiyatı siparişe kopyalanır. Aynı isteğin tekrarı ikinci sipariş/denetim satırı doğurmaz. Sipariş modülü kapalıyken yeni sipariş engellenir, geçmiş okunur; yayınlama modülünün kapatılması ise önceden yayınlanmış ürünü satıştan kaldırmaz. Sunucu yeniden başlatılınca kayıt durur. Playwright testi yöneticinin panelden oluşturup fiyatlandırdığı ve yayınladığı ürünü ayrı Test POS ekranından siparişe ekler, simüle sonuç oluşturur; sonra yönetim panelinin salt okunur ekranında görür.
