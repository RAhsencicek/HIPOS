# Modül 5 Devir Şartnamesi — Stok, Depo & Reçeteli Üretim (A'dan Z'ye)

> **Doküman Durumu:** Kesinleşmiş Modül Devir ve Uygulama Şartnamesi · Sürüm: v3.5 (9 Kasım 2026)
> **Kapsam:** Hammadde Kartları, Reçeteli Otomatik Stok Tüketimi (Depletion), Mal Kabul İrsaliyesi, Sayım Taslağı ve Fire Takibi
> **Modül Durumu:** Kalıcı MVP (Çalışıyor) · Mal Kabul, Satın Alma, Fire (Çalışıyor) · **Satıştan Otomatik Tüketim (FAZ 1 - Uygulanacak)**
> **PostgreSQL Şeması:** `inventory` (`inventory.warehouses`, `inventory.ingredients`, `inventory.recipes`, `inventory.recipe_lines`, `inventory.movements`, `inventory.counts`)
> **Yönetim Paneli:** Var (`InventoryHttpPage.tsx`)
> **API:** Var (`InventoryDbContext.cs`, `InventoryEndpoints.cs`)
> **Test:** Var (`docs/04-test-ve-rehberler/STOK_REÇETE_SAYIM_MANUEL_TEST.md`)
> **Ana Devir Rehberi:** [DEVIR_REHBERI.md](DEVIR_REHBERI.md) · **Yol Haritası:** [DURUM_VE_YOL_HARITASI.md](DURUM_VE_YOL_HARITASI.md)

---

### 📌 Gerçeklik ve Uygulama Durumu Özeti

| Alan / Özellik | Durum | Açıklama |
| :--- | :--- | :--- |
| **Reçete Tanımlama** | **Çalışıyor** | Ürün bazlı hammadde gramajları ve sürümleme PostgreSQL'de kalıcıdır. Menüdeki tüm ürünler (%100 - San Sebastian ve Karışık Pizza dahil) reçetelidir. |
| **Stok Hareketi** | **Çalışıyor** | `inventory.movements` manuel giriş/çıkış, mal kabul ve fire kayıtları çalışır. |
| **Sayım ve Düzeltme** | **Çalışıyor** | Taslak sayım, fark analizi ve tekil düzeltme hareketi çalışır. |
| **Satıştan Otomatik Tüketim** | **Çalışıyor (FAZ 1 - 9 Kasım 2026)** | Adisyon kapandığında reçetedeki hammadde miktarları `inventory.movements` tablosuna `kind: pos_sale` olarak yazılır ve depodan otomatik düşer. |
| **Mal Kabul / Satın Alma** | **Çalışıyor** | Satın alma siparişi, mal kabul irsaliyesi, kasadan nakit tediye veya cariye borç yazma çalışır. |
| **Fire Kayıtları** | **Çalışıyor** | Hammadde zayisi ve reçeteli ürün bozulması `waste_loss` hareketi oluşturur. |

---

## 🎯 1. Modülün Amacı Nedir?

Bu modül; restoranın hammadde maliyetini, depo güvenliğini ve stok kaçaklarını önleyen envanter motorudur. 
En kritik görevi: **Kasada veya masada bir yemek satıldığında, mutfaktaki ilgili malzemeleri (un, et, peynir, sos vb.) gramı gramına sistem stoğundan otomatik düşmektir.**

---

## 📂 2. Hangi Dosyalar ve Kod Bloklarıyla Çalışacaksın?

1. **Ön Yüz (Frontend):**
   * [InventoryHttpPage.tsx](../../apps/admin/src/features/inventory/InventoryHttpPage.tsx) — Depo stokları, kritik eşik uyarıları, sayım taslakları ve reçete ekranları.
   * [ReceivingPage.tsx](../../apps/admin/src/features/inventory/ReceivingPage.tsx) — Mal kabul ve satın alma irsaliyesi.
   * [WastePage.tsx](../../apps/admin/src/features/inventory/WastePage.tsx) — Fire ve zayi kayıtları.
2. **Backend (.NET API):**
   * [InventoryDbContext.cs](../../apps/api/Hipos.Api/Inventory/InventoryDbContext.cs) — Depolar, hammaddeler, reçeteler, stok hareketleri ve sayımlar.
   * [InventoryEndpoints.cs](../../apps/api/Hipos.Api/Inventory/InventoryEndpoints.cs) — Stok listeleme, reçete kaydetme ve depo işlemleri.
   * [PaymentSimulator.cs](../../apps/api/Hipos.Api/Sales/PaymentSimulator.cs) ve [SalesCheckEndpoints.cs](../../apps/api/Hipos.Api/Sales/SalesCheckEndpoints.cs) — Satış kapandığında reçete düşümünün tetikleneceği yer.

---

## 🚀 3. FAZ 1: Satıştan Otomatik Reçeteli Stok Düşümü (Depletion) Sözleşmesi

### A. Tetiklenme Zamanı (Trigger)
Adisyonun bakiyesi sıfırlandığında ve adisyon `status = 'closed'` durumuna geçtiği anda (hem masa tahsilatında hem hızlı satışta) aynı veritabanı oturumunda tetiklenir.

### B. Algoritma (Psödo-kod):
```csharp
// Adisyon kapandığında:
public static async Task DepleteInventoryForCheckAsync(
    DbConnection connection, 
    Guid checkId, 
    string firmId, 
    string branchId, 
    DbTransaction transaction, 
    CancellationToken ct)
{
    // 1. Kapanan adisyondaki tüm sipariş kalemlerini al
    var items = await GetCheckOrderItemsAsync(connection, checkId, transaction, ct);
    
    // 2. Her bir ürün için aktif reçeteyi çek
    foreach (var item in items)
    {
        var recipeLines = await GetRecipeLinesForProductAsync(connection, item.ProductId, firmId, branchId, transaction, ct);
        if (!recipeLines.Any()) continue; // Reçetesiz ürünse (örn. kutu içecek) atla

        // 3. Reçetedeki her bir hammadde için düşüm hesapla
        foreach (var line in recipeLines)
        {
            decimal totalDepletion = item.Quantity * line.Quantity; // Örn: 2 adet sandviç * 120g tavuk = 240g
            
            // 4. inventory.movements tablosuna 'pos_sale' kaydı at
            await InsertInventoryMovementAsync(connection, new InventoryMovement {
                Id = Guid.NewGuid().ToString(),
                FirmId = firmId,
                BranchId = branchId,
                WarehouseId = "warehouse-kadikoy-main",
                IngredientId = line.IngredientId,
                Delta = -totalDepletion,
                Unit = line.Unit,
                Kind = "pos_sale",
                Description = $"Satış düşümü · Adisyon {checkId.ToString()[..8]} · {item.Quantity}x {item.ProductName}",
                Actor = "system:sales-depletion",
                CreatedAt = DateTimeOffset.UtcNow
            }, transaction, ct);

            // 5. inventory.ingredients tablosundaki on_hand bakiyesini güncelle
            await DecrementIngredientOnHandAsync(connection, line.IngredientId, totalDepletion, transaction, ct);
        }
    }
}
```

### C. Doğrulama Kriteri (Definition of Done)
1. Garson veya Kasa ekranından 2 adet "Tavuklu Sandviç" satışı yapıldığında:
   - `inventory.movements` tablosuna `kind: "pos_sale"` olan 2 hareket yazılmalıdır (1 adet ekmek * 2 = -2 adet, 120g tavuk * 2 = -240g).
   - `inventory.ingredients` tablosunda `bread` bakiyesi 38'den 36'ya, `chicken` bakiyesi 7600'den 7360'a düşmelidir.
   - Admin Paneli `/admin/inventory/ingredients` ekranında stok anında güncel görünmelidir.

---

## 4. CANLI KRİTİK STOK VE TÜKENDİ GÜVENLİK SÖZLEŞMESİ (FAZ 8)

### A. İşletme Kuralı ve Eşikler:
1. **Tükendi Durumu (`isOutOfStock: true`):**
   - Reçeteli bir ürünün herhangi bir hammaddesi mevcudu `on_hand <= 0` ise ürün derhal tükenmiş sayılır (`availablePortions = 0`).
   - Kasa Hızlı Satış ve Garson ekranlarında kırmızı `🚫 Tükendi` rozetiyle işaretlenir.
   - Dokunmatik arayüzde sepete ekleme butonları kilitlenir; tıklandığında *"X ürünü tükendi. Mutfak stoğunda Y bulunmuyor."* uyarısı verilir.
2. **Kritik Stok Durumu (`isCriticalStock: true`):**
   - Reçetedeki herhangi bir hammadde kritik eşiğin altına (`0 < on_hand <= critical_below`) indiğinde ürün sarı/kehribar `⚠️ Kritik (X)` rozeti alır.
   - Personele kalan tahmini porsiyon bilgisi gösterilerek tedbirli satış yapılması sağlanır.
3. **Backend Sipariş Engeli ([`SalesOrders.cs`](file:///Users/mac/HIPOS/apps/api/Hipos.Api/Sales/SalesOrders.cs)):**
   - `SalesOrders.CreateAsync` metodu `CheckRecipeStockAvailabilityAsync` kontrolü yapar.
   - İstemci arayüzü atlansa veya doğrudan API çağrısı yapılsa dahi, tükenen ürün siparişleri HTTP 409 `PRODUCT_OUT_OF_STOCK` hatasıyla mutfağa veya adisyona iletilmeden anında durdurulur.
4. **SSE Canlı İletim:**
   - Kasa satışı, zayi/fire veya sayım onayı gerçekleştiğinde `inventory.stock_updated` SSE yayını yapılır.
   - Sayfa yenilemeye (F5) gerek kalmaksızın tüm şube terminalleri anlık olarak güncellenir.
