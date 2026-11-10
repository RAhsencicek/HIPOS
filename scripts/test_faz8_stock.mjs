// HIPOS - FAZ 8 Canlı Kritik Stok ve Tükendi Rozeti API Doğrulama Testi
import assert from 'node:assert';

const BASE_URL = 'http://127.0.0.1:5180';
const FIRM_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';

async function main() {
  console.log('🧪 [FAZ 8] Canlı Kritik Stok ve Tükendi Rozeti Testi Başlatılıyor...');

  // 1. Menü endpoint'inden stok durumlarını oku
  console.log('\n--- 1. Menü Stok Durumu Denetimi (GET /catalog/menus) ---');
  const menuRes = await fetch(`${BASE_URL}/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/catalog/menus`, {
    headers: { 'X-Demo-Actor': 'pos-single' }
  });
  assert.strictEqual(menuRes.status, 200, `Menü alınamadı: ${menuRes.status}`);
  const menuData = await menuRes.json();

  const pizza = menuData.products.find(p => p.name === 'Margherita Pizza');
  assert(pizza, 'Margherita Pizza bulunamadı');
  console.log('🍕 Margherita Pizza Stok Durumu:', {
    isOutOfStock: pizza.isOutOfStock,
    isCriticalStock: pizza.isCriticalStock,
    availablePortions: pizza.availablePortions,
    limitingIngredientName: pizza.limitingIngredientName
  });

  assert.strictEqual(pizza.isOutOfStock, true, 'Margherita Pizza tükenmiş (isOutOfStock=true) olmalı!');
  assert.strictEqual(pizza.availablePortions, 0, 'Kalan porsiyon 0 olmalı!');
  assert.strictEqual(pizza.limitingIngredientName, 'Mozzarella', 'Kısıtlayan hammadde Mozzarella olmalı!');

  const sandwich = menuData.products.find(p => p.name === 'Tavuklu Sandviç');
  assert(sandwich, 'Tavuklu Sandviç bulunamadı');
  console.log('🥪 Tavuklu Sandviç Stok Durumu:', {
    isOutOfStock: sandwich.isOutOfStock,
    isCriticalStock: sandwich.isCriticalStock,
    availablePortions: sandwich.availablePortions,
    limitingIngredientName: sandwich.limitingIngredientName
  });
  assert.strictEqual(sandwich.isOutOfStock, false, 'Tavuklu Sandviç stokta var (isOutOfStock=false) olmalı!');
  assert(sandwich.availablePortions > 0, 'Tavuklu Sandviç porsiyonu > 0 olmalı!');

  // 2. Tükenen ürün (Margherita Pizza) için satış açma denemesi
  console.log('\n--- 2. Tükenen Ürün Satış/Sipariş Blokajı Testi ---');
  const outOfStockCheckPayload = {
    requestId: crypto.randomUUID(),
    firstOrderId: crypto.randomUUID(),
    items: [
      {
        productId: pizza.id,
        productName: pizza.name,
        sku: pizza.sku,
        quantity: 1,
        unitPriceMinor: pizza.price.amountMinor
      }
    ]
  };

  const outOfStockRes = await fetch(`${BASE_URL}/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/sales/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Actor': 'pos-single' },
    body: JSON.stringify(outOfStockCheckPayload)
  });

  const outOfStockResult = await outOfStockRes.json();
  console.log(`Tükenen sipariş yanıtı HTTP ${outOfStockRes.status}:`, outOfStockResult);

  assert.strictEqual(outOfStockRes.status, 409, `Tükenen ürün siparişi 409 dönmeli, gelen: ${outOfStockRes.status}`);
  assert.strictEqual(outOfStockResult.code, 'PRODUCT_OUT_OF_STOCK', `Hata kodu PRODUCT_OUT_OF_STOCK olmalı, gelen: ${outOfStockResult.code}`);
  const msg = outOfStockResult.message || outOfStockResult.detail || '';
  assert(msg.includes('Mozzarella'), `Hata mesajı tükenen hammaddeyi (Mozzarella) içermeli: ${msg}`);
  console.log('✅ BACKEND SIPARIS BLOKAJI BAŞARIYLA ÇALIŞTI:', msg);

  // 3. Stokta olan Tavuklu Sandviç'i sipariş etmeyi dene (Başarılı olmalı)
  console.log('\n--- 3. Stokta Olan Ürün Siparişi Testi ---');
  const validCheckPayload = {
    requestId: crypto.randomUUID(),
    firstOrderId: crypto.randomUUID(),
    items: [
      {
        productId: sandwich.id,
        productName: sandwich.name,
        sku: sandwich.sku,
        quantity: 1,
        unitPriceMinor: sandwich.price.amountMinor
      }
    ]
  };

  const validOrderRes = await fetch(`${BASE_URL}/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/sales/checks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Demo-Actor': 'pos-single' },
    body: JSON.stringify(validCheckPayload)
  });
  assert(validOrderRes.status === 200 || validOrderRes.status === 201, `Geçerli sipariş kabul edilmeli: ${validOrderRes.status}`);
  const createdCheck = await validOrderRes.json();
  console.log(`✅ Stokta olan Tavuklu Sandviç siparişi kabul edildi (HTTP ${validOrderRes.status}, Adisyon ID: ${createdCheck.id})`);

  console.log('\n🎉 [FAZ 8] Tüm API ve Stok Blokajı Testleri Başarıyla Tamamlandı!');
}

main().catch(err => {
  console.error('❌ Test Başarısız:', err);
  process.exit(1);
});
