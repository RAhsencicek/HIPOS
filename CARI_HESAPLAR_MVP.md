# Cari Hesaplar — ilk işletilebilir dilim

Durum: cari capability ve kaynak modelinin sadeleştirme dilimi uygulanıyor. Kapsam tek şubeli bir restoranın müşteri alacağını ve tedarikçi borcunu takip etmesidir. Bu modül yasal muhasebe, e-fatura, banka bağlantısı veya gerçek POS tahsilatı değildir.

## Yönetici için görünüm

- Cari özeti: aktif müşteri/tedarikçi sayısı, toplam müşteri alacağı, toplam tedarikçi borcu ve son hareketler.
- Müşteri ve tedarikçi kartları ayrı filtrelenir. Kartta ad/unvan ve isteğe bağlı telefon, e-posta, not bulunur.
- Kart ekstresi kayıt tarihini, işlem türünü, açıklamayı, varsa belge referansını ve alacak/borç etkisini gösterir.
- Müşteride **veresiye satış/alacak kaydı** alacağı artırır; **tahsilat kaydı** azaltır.
- Tedarikçide **borç kaydı** borcu artırır; **ödeme kaydı** azaltır.
- Bir kart Müşteri, Tedarikçi veya iki rolü birden taşıyabilir. Liste filtresi yeni kartın rolünü kısıtlamaz.
- Her iki hesap türünde gerekçeli **bakiye artırma/azaltma düzeltmesi** desteklenir.
- Tahsilat/ödeme elle girilen işletme kaydıdır; banka/kasa/POS işlemi veya mali belge oluşturmaz.

## API sözleşmesi

Firma ve şube kapsamı:

```text
GET    /api/v1/firms/{firmId}/branches/{branchId}/caris
GET    /api/v1/firms/{firmId}/branches/{branchId}/caris/summary
GET    /api/v1/firms/{firmId}/branches/{branchId}/caris/{partyId}
GET    /api/v1/firms/{firmId}/branches/{branchId}/caris/{partyId}/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
POST   /api/v1/firms/{firmId}/branches/{branchId}/caris
PUT    /api/v1/firms/{firmId}/branches/{branchId}/caris/{partyId}
POST   /api/v1/firms/{firmId}/branches/{branchId}/caris/{partyId}/movements
```

Yeni kart alanları: `name`, `types` (`customer`, `supplier`, ikisi de olabilir), `phone?`, `email?`, `note?`. `requestId` her yeni hareket için benzersiz UUID'dir. Yeni hareket komutu `kind`, `entryType`, pozitif `amountMinor`, `description`, `effectiveDate`, isteğe bağlı `reference`, `requestId` ve `expectedVersion` taşır. İnsan tarafından girilen API hareketlerinde kaynak sunucu tarafından `manual` atanır; istemci kaynak alanını seçemez. Eski istemcilerin `deltaMinor` komutu geriye uyumluluk için `legacy_manual` hareket olarak kabul edilir; eski kayıtlar da `legacy_manual` etiketiyle korunur.

| `kind` | `entryType` | Bakiye etkisi |
|---|---|---:|
| `customer` | `customer_charge` | + tutar |
| `customer` | `customer_collection` | − tutar |
| `supplier` | `supplier_debt` | + tutar |
| `supplier` | `supplier_payment` | − tutar |
| her ikisi | `adjustment_increase` / `adjustment_decrease` | + / − tutar |

Tutar kuruş cinsinden tamsayıdır; sıfır/negatif tutar, TRY dışı para birimi ve hesap türüyle uyumsuz işlem reddedilir. Bakiyeler hareket defterinden türetilir, kart üzerinde doğrudan yazılmaz. Ekstre dönemleri `effectiveDate` ve `Europe/Istanbul` takvim gününe göre hesaplanır; kayıt zamanı ayrıca saklanır.

## Kalıcılık ve güvenlik

- Cari kartı ve hareket firma + şube kapsamında saklanır. Hareketler ve denetim kayıtları silinmez; düzeltmeler yeni, gerekçeli hareket olarak eklenir.
- `requestId` idempotency anahtarıdır. Aynı istek yinelenirse aynı hareket yanıtlanır; farklı içerikle tekrar kullanılırsa `409 MOVEMENT_ID_CONFLICT` döner.
- `expectedVersion` eski kart durumuyla hareket eklenmesini engeller. Yazma; `cari.management`, firma/şube erişimi ve yönetici kapsamı doğrulandıktan, aynı DB işlemi içinde kilitlendikten sonra yapılır.
- `cari.management` tek şube capability'sidir. Kapatılınca yeni manuel kart, kart düzenleme ve manuel hareket yazımı durur; geçmiş kart, hareket, bakiye ve ekstre okunur. Eski `cari.customers`/`cari.suppliers` tercihleri ilk API başlangıcında bir kez birleştirilir: iki tercihten biri açıksa yeni ana modül açık kalır; ikisi de kapalıysa kapalı kalır. Eski denetim geçmişi korunur.
- Hareket `source` alanının izinli değerleri `manual`, `integration`, `sales`, `purchase`, `opening_balance`, `adjustment` şeklindedir. Bu dilimde kullanıcı API'si yalnız `manual` üretir; diğer değerler ilerideki yazma kanalları için veri sözleşmesidir, açık entegrasyon/satış/satın alma endpoint'i değildir.
- Capability tercihi tabloya dokunmaz; migration çalıştırmaz ve veri silmez. Gerçek kullanıcı/rol yetkisi bu prototipte yoktur.

## Bilinçli sınırlar ve sonraki dilim

Bu dilimde fatura/sipariş belgesi, vade/yaşlandırma, tahsilatın tek tek faturaya dağıtımı, satın alma-mal kabul/stok bağlantısı, satış adisyonundan otomatik cari hareket, kasa defteri, banka mutabakatı, e-fatura/vergi ve çoklu para birimi yoktur. Dolayısıyla “vadesi geçmiş tutar” hesaplanmaz. Bunlar eklenecekse belge ve ödeme tahsisi ayrı kalıcı kavramlar olarak tasarlanmalıdır; salt hareket tarihinden vade çıkarılmaz.

Uygulama sırası: additive PostgreSQL source doğrulama migration'ı ve eski capability tercihlerini idempotent birleştirme → ana capability gate/idempotent API → tekrar çalıştırılabilir kurgusal demo seed → rol filtresinden bağımsız kart/ekstre ve işlem formları → PostgreSQL ve tarayıcı kabul testleri.
