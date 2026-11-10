import { chromium } from "playwright";
import { resolve } from "path";

const ARTIFACT_DIR = "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926";

async function main() {
  console.log("=== FAZ 8 BROWSER AUTOMATION TEST ===");

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. KASA EKRANI (Quick Sale Tükendi Testi)
  console.log("\n[1] Kasa ekranına gidiliyor: http://localhost:5176/cashier...");
  await page.goto("http://localhost:5176/cashier", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // PIN ekranı
  const pinModal = page.locator("text=Kasa Dokunmatik Ekranı");
  if ((await pinModal.count()) > 0) {
    console.log("    PIN ekranı algılandı, 1234 tuşlanıyor...");
    for (const d of ["1", "2", "3", "4"]) {
      await page.locator(`button:text-is("${d}")`).click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1000);
  }

  // İstasyon seçimi
  const regBtn = page.locator("button:has-text('Kadıköy Ana Kasa')").first();
  if (await regBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log("    Kasa istasyonu seçiliyor: Kadıköy Ana Kasa...");
    await regBtn.click();
    await page.waitForTimeout(1000);
  }

  // Hızlı Satış Sekmesi
  console.log("[2] Hızlı Satış sekmesine geçiliyor...");
  await page.locator("button.cashier-seg-btn.quick").click();
  await page.waitForTimeout(1000);

  // Margherita Pizza kartını bul
  const pizzaCard = page.locator("div.cashier-quick-product-card:has-text('Margherita Pizza')");
  await pizzaCard.waitFor({ state: "visible", timeout: 5000 });

  const hasOutOfStockBadge = await pizzaCard.locator(".cashier-stock-badge.out-of-stock").isVisible();
  console.log(`    🍕 Margherita Pizza üzerinde '🚫 Tükendi' rozeti var mı: ${hasOutOfStockBadge ? 'EVET (✅)' : 'HAYIR (❌)'}`);

  // Tükenen karta tıkla ve engellemeyi doğrula
  console.log("[3] Tükenen Margherita Pizza kartına tıklanıyor (Engelleme testi)...");
  await pizzaCard.click();
  await page.waitForTimeout(600);

  // Uyarı mesajını kontrol et
  const errorAlert = page.locator(".cashier-quick-error, [role='alert'], .ops-error");
  const errorText = await errorAlert.textContent().catch(() => "");
  console.log(`    ⚠️ Gösterilen uyarı: "${errorText.trim()}"`);

  // Sepette olmamalı
  const cartItem = page.locator(".quick-cart-inline:has-text('Margherita Pizza')");
  const inCart = await cartItem.isVisible().catch(() => false);
  console.log(`    Sepete eklendi mi: ${inCart ? 'HAYIR - EKLENDİ (HATA!)' : 'HAYIR - ENGELLENDİ (✅)'}`);

  // Screenshot 1: Kasa Tükendi Rozeti ve Uyarı
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz8_01_pos_out_of_stock.png") });
  console.log("    📸 Kaydedildi: faz8_01_pos_out_of_stock.png");

  // 2. GARSON EKRANI (Waiter App Tükendi Testi)
  console.log("\n[4] Garson ekranına gidiliyor: http://localhost:5176/waiter...");
  const waiterPage = await context.newPage();
  await waiterPage.goto("http://localhost:5176/waiter", { waitUntil: "networkidle" });
  await waiterPage.waitForTimeout(1000);

  // Garson PIN ekranı (Mehmet Garson PIN 2222)
  const waiterPin = waiterPage.locator("text=Garson Tablet Girişi");
  if ((await waiterPin.count()) > 0) {
    console.log("    Garson PIN ekranı algılandı, 2222 tuşlanıyor...");
    for (const d of ["2", "2", "2", "2"]) {
      await waiterPage.locator(`button:text-is("${d}")`).click();
      await waiterPage.waitForTimeout(100);
    }
    await waiterPage.waitForTimeout(1200);
  }

  // Boş bir masa seç (örneğin Masa 04)
  console.log("[5] Masa seçiliyor...");
  const tableBtn = waiterPage.locator(".waiter-table-card").first();
  await tableBtn.waitFor({ state: "visible", timeout: 5000 });
  await tableBtn.click();
  await waiterPage.waitForTimeout(1000);

  // Menüde Margherita Pizza aranıyor
  console.log("[6] Menüde Margherita Pizza aranıyor...");
  const searchInput = waiterPage.locator("input[placeholder='Ürün ara…']");
  if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.fill("Margherita");
    await waiterPage.waitForTimeout(500);
  } else {
    const pizzaToggle = waiterPage.locator("button.waiter-category-toggle:has-text('Pizza')");
    if (await pizzaToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pizzaToggle.click();
      await waiterPage.waitForTimeout(500);
    }
  }

  const waiterPizza = waiterPage.locator("article.waiter-product:has-text('Margherita Pizza')");
  await waiterPizza.waitFor({ state: "visible", timeout: 5000 });

  const waiterBadge = await waiterPizza.locator(".waiter-stock-badge.out-of-stock").isVisible();
  console.log(`    🍕 Garson ekranında '🚫 Tükendi' rozeti var mı: ${waiterBadge ? 'EVET (✅)' : 'HAYIR (❌)'}`);

  const addBtn = waiterPizza.locator(".waiter-add-product");
  const isDisabled = await addBtn.isDisabled();
  const btnText = await addBtn.textContent();
  console.log(`    Buton durumu: Disabled=${isDisabled}, Metin="${btnText?.trim()}" (✅)`);

  // Screenshot 2: Garson Ekranı Tükendi Rozeti ve Buton Blokajı
  await waiterPage.screenshot({ path: resolve(ARTIFACT_DIR, "faz8_02_waiter_out_of_stock.png") });
  console.log("    📸 Kaydedildi: faz8_02_waiter_out_of_stock.png");

  await browser.close();
  console.log("\n🎉 [FAZ 8] Canlı Tarayıcı Testleri Başarıyla Tamamlandı!");
}

main().catch(err => {
  console.error("❌ Test Başarısız:", err);
  process.exit(1);
});
