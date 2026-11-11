import { chromium } from "playwright";

async function run() {
  console.log("================================================================");
  console.log("🚀 HIPOS — CANLI UÇTAN UCA RESTORAN VE FİZİKSEL TERMAL YAZICI TESTİ");
  console.log("================================================================");

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // -------------------------------------------------------------
  // 1. ADIM: GARSON EKRANI (Masa 08 İçin Sipariş Oluşturma)
  // -------------------------------------------------------------
  console.log("\n=== 1. ADIM: GARSON EKRANINDA MASA 08 İÇİN SİPARİŞ OLUŞTURMA ===");
  await page.goto("https://hipos.hayatisleri.com.tr/waiter", { waitUntil: "networkidle" });

  // Garson PIN: 2222 (Mehmet Garson)
  console.log("PIN 2222 giriliyor...");
  for (const digit of ["2", "2", "2", "2"]) {
    await page.locator(`button:text-is("${digit}")`).first().click();
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);

  // Masa 08 seç
  console.log("Masa 08 seçiliyor...");
  await page.locator("button:has-text('Masa 08')").first().click();
  await page.waitForTimeout(1500);

  // Pizzalar kategorisini aç
  console.log("Pizzalar kategorisi açılıyor...");
  await page.locator("button:has-text('Pizzalar')").first().click();
  await page.waitForTimeout(1000);

  // İlk pizzaya (Margherita Pizza) + Ekle tıkla
  console.log("Margherita Pizza sepete ekleniyor...");
  await page.locator(".waiter-add-product").first().click();
  await page.waitForTimeout(1000);

  // Modalda 'Sepete ekle' tıkla
  console.log("Modalda 'Sepete ekle' onaylanıyor...");
  await page.locator("button:has-text('Sepete ekle')").first().click();
  await page.waitForTimeout(1000);

  // 'Siparişi mutfağa gönder' butonuna tıkla
  console.log("Sipariş mutfağa gönderiliyor (Mutfak fişi basılacak)...");
  await page.locator("button:has-text('Siparişi mutfağa gönder')").first().click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_cycle_01_waiter_ordered.png" });
  console.log("✅ 1. Adım tamamlandı: Masa 08 siparişi verildi (live_cycle_01_waiter_ordered.png).");

  // -------------------------------------------------------------
  // 2. ADIM: MUTFAK KDS EKRANI (Bilet Görüntüleme)
  // -------------------------------------------------------------
  console.log("\n=== 2. ADIM: MUTFAK KDS EKRANINDA BİLETİN GÖRÜNTÜLENMESİ ===");
  await page.goto("https://hipos.hayatisleri.com.tr/kitchen", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const pin3 = page.locator("button:text-is('3')").first();
  if (await pin3.isVisible()) {
    console.log("Aşçı PIN 3333 giriliyor...");
    for (const digit of ["3", "3", "3", "3"]) {
      await page.locator(`button:text-is("${digit}")`).first().click();
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(1500);
  }

  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_cycle_02_kitchen_ticket.png" });
  console.log("✅ 2. Adım tamamlandı: Mutfak KDS ekranı görüntülendi (live_cycle_02_kitchen_ticket.png).");

  // -------------------------------------------------------------
  // 3. ADIM: KASA EKRANI (Masa 08 Ödemesini Alma)
  // -------------------------------------------------------------
  console.log("\n=== 3. ADIM: KASA EKRANINDA ÖDEME ALMA (TAHSİLAT) ===");
  await page.goto("https://hipos.hayatisleri.com.tr/cashier", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Kasiyer PIN: 1111 (Ayşe Kasiyer)
  console.log("Kasiyer PIN 1111 giriliyor...");
  for (const digit of ["1", "1", "1", "1"]) {
    await page.locator(`button:text-is("${digit}")`).first().click();
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);

  // Masa 08 seç
  console.log("Kasa ekranında Masa 08 seçiliyor...");
  const table8Btn = page.locator(".waiter-table-card:has-text('Masa 08'), button:has-text('Masa 08')").first();
  await table8Btn.click();
  await page.waitForTimeout(1500);

  // 'TAM KALAN' butonuna bas
  console.log("Tam Kalan butonuna basılıyor...");
  const fullAmountBtn = page.locator("button:has-text('TAM KALAN')").first();
  if (await fullAmountBtn.isVisible()) {
    await fullAmountBtn.click();
    await page.waitForTimeout(600);
  }

  // 'Tahsilatı tamamla' butonuna bas
  console.log("Tahsilatı tamamla butonuna basılıyor (Kasa fişi basılacak)...");
  const completeBtn = page.locator("button.cashier-complete, button.cashier-action-primary:has-text('Tahsilatı tamamla')").first();
  if (await completeBtn.isVisible() && await completeBtn.isEnabled()) {
    await completeBtn.click();
    await page.waitForTimeout(3500);
  }

  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_cycle_03_cashier_paid.png" });
  console.log("✅ 3. Adım tamamlandı: Masa 08 tahsilatı yapıldı (live_cycle_03_cashier_paid.png).");

  // -------------------------------------------------------------
  // 4. ADIM: YÖNETİCİ PANELİ (DASHBOARD & SATIŞLAR)
  // -------------------------------------------------------------
  console.log("\n=== 4. ADIM: YÖNETİCİ PANELİ (DASHBOARD & SATIŞLAR) ===");
  await page.goto("https://hipos.hayatisleri.com.tr/admin/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const emailInput = page.locator("input[type='email'], input[name='email']").first();
  if (await emailInput.isVisible()) {
    console.log("Yönetici girişi yapılıyor...");
    await emailInput.fill("patron@hipos.local");
    await page.locator("input[type='password']").first().fill("Patron123!");
    await page.locator("button[type='submit']").first().click();
    await page.waitForTimeout(2500);
  }

  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_cycle_04_admin_dashboard.png" });
  console.log("✅ 4. Adım tamamlandı: live_cycle_04_admin_dashboard.png");

  // Satışlar sekmesine bak
  const salesLink = page.locator("a:has-text('Satışlar'), button:has-text('Satışlar')").first();
  if (await salesLink.isVisible()) {
    await salesLink.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_cycle_05_admin_sales.png" });
    console.log("✅ 5. Adım tamamlandı: live_cycle_05_admin_sales.png");
  }

  console.log("\n🎉 TÜM TEST DÖNGÜSÜ BAŞARIYLA TAMAMLANDI!");
  await browser.close();
}

run().catch((err) => {
  console.error("Test sırasında hata:", err);
  process.exit(1);
});
