import { chromium } from "playwright";
import { resolve } from "path";

const ARTIFACT_DIR = "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926";

async function main() {
  console.log("=== FAZ 7 BROWSER AUTOMATION TEST ===");

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("[1] Kasa ekranına gidiliyor: http://localhost:5176/cashier...");
  await page.goto("http://localhost:5176/cashier", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // PIN ekranı kontrolü
  const pinModal = page.locator("text=Kasa Dokunmatik Ekranı");
  if ((await pinModal.count()) > 0) {
    console.log("    PIN ekranı algılandı, 1234 tuşlanıyor...");
    for (const d of ["1", "2", "3", "4"]) {
      await page.locator(`button:text-is("${d}")`).click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1000);
  }

  // Kasa İstasyonu Seçim Dialogu (Kadıköy Ana Kasa)
  const regBtn = page.locator("button:has-text('Kadıköy Ana Kasa')").first();
  if (await regBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log("    Kasa istasyonu seçiliyor: Kadıköy Ana Kasa...");
    await regBtn.click();
    await page.waitForTimeout(1000);
  }

  // Hızlı Satış Moduna Geç
  console.log("[2] Hızlı Satış / Gel-Al sekmesine geçiliyor...");
  await page.locator("button.cashier-seg-btn.quick").click();
  await page.waitForTimeout(1000);

  // Tavuklu Sandviç ekle (₺260,00)
  console.log("[3] Sepete Tavuklu Sandviç ekleniyor...");
  await page.locator("div.cashier-quick-product-card:has-text('Tavuklu Sandviç')").click();
  await page.waitForTimeout(600);

  const addBtn = page.locator("button:has-text('Sepete ekle')");
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(600);
  }

  // Sepeti Onayla & Tahsilata Geç
  console.log("[4] 'Sepeti Onayla' tıklanıyor...");
  await page.locator("button.quick-cart-btn-submit").click();
  await page.waitForTimeout(1500);

  // Cariye Yaz ödeme yöntemine tıkla
  console.log("[5] '👤 Cariye Yaz' seçiliyor...");
  await page.locator("button.quick-method-btn:has-text('Cariye Yaz')").click();
  await page.waitForTimeout(1000);

  // Modal screenshot
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz7_01_customer_modal.png") });
  console.log("    📸 Kaydedildi: faz7_01_customer_modal.png");

  // Müşteri seç (Ahmet Yılmaz)
  console.log("[6] Müşteri listesinden 'Ahmet Yılmaz' seçiliyor...");
  const ahmetBtn = page.locator("div.cashier-customer-list button:has-text('Ahmet Yılmaz')");
  await ahmetBtn.waitFor({ state: "visible", timeout: 5000 });
  await ahmetBtn.click();
  await page.waitForTimeout(1000);

  // Seçilmiş müşteri badge screenshot
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz7_02_customer_selected.png") });
  console.log("    📸 Kaydedildi: faz7_02_customer_selected.png");

  // Tahsil Et & Yazdır
  console.log("[7] 'Tahsil Et & Yazdır' butonuna basılıyor...");
  const submitPayBtn = page.locator("button.quick-submit-payment-btn");
  await submitPayBtn.click();
  await page.waitForTimeout(2500);

  // Ödeme başarı screenshot
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz7_03_payment_success.png") });
  console.log("    📸 Kaydedildi: faz7_03_payment_success.png");

  // Yönetici Cariler ekranına git
  console.log("[8] Yönetici Ekranına (Admin Cariler) gidiliyor: http://localhost:5173/?section=customers&item=accounts");
  await page.goto("http://localhost:5173/?section=customers&item=accounts", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz7_04_admin_cari.png") });
  console.log("    📸 Kaydedildi: faz7_04_admin_cari.png");

  // Ahmet Yılmaz kartına tıkla ve ekstresini görüntüle
  const ahmetCariCard = page.locator("button:has-text('Ahmet Yılmaz')").first();
  if ((await ahmetCariCard.count()) > 0) {
    console.log("[9] Ahmet Yılmaz cari kartına tıklanıyor...");
    await ahmetCariCard.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz7_05_admin_statement.png") });
    console.log("    📸 Kaydedildi: faz7_05_admin_statement.png");
  }

  await browser.close();
  console.log("\n✅ FAZ 7 BROWSER TESTLERİ BAŞARIYLA TAMAMLANDI!");
}

main().catch((err) => {
  console.error("❌ TEST HATASI:", err);
  process.exit(1);
});
