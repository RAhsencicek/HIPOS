import { chromium } from "playwright";
import { resolve } from "path";

const ARTIFACT_DIR = "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926";

async function main() {
  console.log("=== FAZ 9 BROWSER AUTOMATION TEST ===");

  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // 1. Yönetici Girişi
  console.log("[1] Yönetici paneline gidiliyor: http://localhost:5173/admin/login...");
  await page.goto("http://localhost:5173/admin/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const emailInput = page.locator("input[type='email'], input[name='email']").first();
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log("    Giriş yapılıyor: patron@hipos.local...");
    await emailInput.fill("patron@hipos.local");
    await page.locator("input[type='password'], input[name='password']").first().fill("Patron123!");
    await page.locator("button[type='submit']").first().click();
    await page.waitForTimeout(1500);
  }

  // 2. Stok Sayfası (/admin/inventory)
  console.log("[2] /admin/inventory sayfasına gidiliyor...");
  await page.goto("http://localhost:5173/admin/inventory", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Canlı bildirim metnini kontrol et
  const noticeText = await page.locator(".demo-notice, .notice").first().textContent().catch(() => "");
  console.log(`    🟢 Stok Bannerı: "${noticeText.trim()}"`);

  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz9_01_admin_inventory_live.png") });
  console.log("    📸 Kaydedildi: faz9_01_admin_inventory_live.png");

  // 3. Kasa Sayfası (/admin/cash)
  console.log("[3] /admin/cash sayfasına gidiliyor...");
  await page.goto("http://localhost:5173/admin/cash", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz9_02_admin_cash_live.png") });
  console.log("    📸 Kaydedildi: faz9_02_admin_cash_live.png");

  // 4. Raporlar Sayfası (/admin/reports)
  console.log("[4] /admin/reports sayfasına gidiliyor...");
  await page.goto("http://localhost:5173/admin/reports", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(ARTIFACT_DIR, "faz9_03_admin_reports_live.png") });
  console.log("    📸 Kaydedildi: faz9_03_admin_reports_live.png");

  await browser.close();
  console.log("\n🎉 [FAZ 9] Yönetici Ekranları Doğrulaması Başarıyla Tamamlandı!");
}

main().catch(err => {
  console.error("❌ Test Başarısız:", err);
  process.exit(1);
});
