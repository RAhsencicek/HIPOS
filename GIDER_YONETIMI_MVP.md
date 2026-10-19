# Gider Yönetimi MVP

Durum: `finance` şeması, API ve yönetim paneli sağlayıcısı uygulanmış manuel gider dilimi. API `X-Demo-Actor` ile çalışır; bu başlık taklit edilebilir ve Production ortamında da route'lar için auth yerine kullanılır. Gerçek kullanıcı trafiğine açılmamalıdır.

İlk sürüm, şube kapsamında yalnızca manuel gider kaydı oluşturur. Giderler `finance` PostgreSQL şemasında saklanır; kasa, cari ve muhasebe fişine yazılmaz.

## Kapsam ve davranış

- Firma düzeyinde sabit gider kategorileri: Kira, Faturalar, Sarf malzemeleri, Bakım ve onarım, Pazarlama, Diğer.
- Gider alanları: tarih, pozitif TRY tutarı, açıklama, kategori, kaynak (`manual`), oluşturan aktör ve kayıt zamanı.
- Kayıtlar silinemez veya güncellenemez. Yanlış kayıtlar için düzeltme/iptal bu sürümde kapsam dışıdır.
- Kategori yönetimi yoktur; kategoriler idempotent demo seed ile hazırlanır.
- `finance.expenses` açık değilse yeni gider reddedilir. Kategori, liste ve detay okumaları kapalı modülde de sürer.
- Gerçek kullanıcı/üyelik henüz yoktur; mevcut geliştirme API'si `X-Demo-Actor` kullanır.

## Kurulum

```bash
HIPOS_FEATURES_CONNECTION='Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only' \
  dotnet tool run dotnet-ef database update --project apps/api/Hipos.Api/Hipos.Api.csproj --context ExpenseDbContext

HIPOS_DEMO_DATABASE_URL='postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features' \
  npm run demo:seed:expenses
```

Seed yalnızca açıkça verilen yerel `hipos_features` veritabanını kabul eder. Tekrar çalıştırma mevcut kategori kaydını değiştirmez. Paneli `VITE_EXPENSE_PROVIDER=http VITE_FEATURE_PROVIDER=http npm run dev` ile açın; API PostgreSQL modunda çalışmalıdır. Ardından Ayarlar → Modüller ve Özellikler altında hedef şubenin `finance.expenses` özelliğini açın.

## HTTP sözleşmesi

Kök yol: `/api/v1/firms/{firmId}/branches/{branchId}`

- `GET /expense-categories`: firmanın etkin kategorileri.
- `GET /expenses?page=1&pageSize=25&from=YYYY-MM-DD&to=YYYY-MM-DD&categoryId=supplies`: şube gider listesi; tarih ve kategori filtreleri isteğe bağlıdır.
- `GET /expenses/{expenseId}`: aynı firma/şubedeki gider ayrıntısı.
- `POST /expenses`: yeni gider oluşturur.

Örnek istek:

```json
{
  "requestId": "e0000000-0000-4000-8000-000000000001",
  "categoryId": "supplies",
  "expenseDate": "2026-10-15",
  "amountMinor": 12345,
  "description": "Kahve ve sarf malzemesi"
}
```

`amountMinor` TRY kuruşudur; örnekte `12345`, `123,45 TRY` anlamına gelir. Para birimi istekte seçilemez; API ve PostgreSQL yalnızca `TRY` saklar. Kaynak sunucu tarafından `manual` atanır.

`requestId` firma içinde benzersizdir. Aynı kimlik ve aynı içerik tekrar gönderilirse mevcut gider `200` ile döner; farklı içerik veya kapsam `409 IDEMPOTENCY_CONFLICT` verir. İlk oluşturma `201` döner. Geçersiz tutar/açıklama/tarih `400`, erişilemeyen kapsam `403`, bulunamayan detay `404`, kapalı özellikte yeni kayıt `409 FEATURE_DISABLED`, migration yoksa `503 EXPENSE_STORAGE_UNAVAILABLE` döner.

## Kalıcı veri ve denetim

- `finance.expense_categories`: firma kapsamlı kategori anahtarları.
- `finance.expenses`: firma/şube kapsamlı, TRY check constraint'i ve pozitif tutar kısıtı olan gider kayıtları.
- `finance.audit`: her oluşturma için tek `expense_created` olayı. Audit; kategori, tarih, tutar, para birimi ve kaynağı taşır.

Kategoriye bileşik firma FK'si ve firma/requestId benzersiz kısıtı vardır. Listeleme firma/şube kapsamıyla filtrelenir. Bu MVP satış/adisyon modeline başlamaz ve gideri başka finansal deftere yansıtmaz.

## Kabul kontrolleri

`npm run test:expenses` izole PostgreSQL üzerinde migration eksikliğini, tekrar çalıştırılabilir kategori seed'ini, modül kapısı davranışını, firma/şube kapsamını, liste/detayı, pozitif TRY kısıtlarını, idempotency'yi, audit kaydını ve kasa/cari defterlerinin değişmediğini doğrular. Aynı test panelden gider oluşturma ve detay görüntülemeyi de kontrol eder.
