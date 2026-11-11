import { chromium } from "playwright";

async function run() {
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  // Track 500s
  const badRequests = [];
  page.on("response", res => {
    if (res.status() >= 400) {
      badRequests.push({ status: res.status(), url: res.url() });
    }
  });

  console.log("Navigating to https://hipos.hayatisleri.com.tr/cashier...");
  await page.goto("https://hipos.hayatisleri.com.tr/cashier", { waitUntil: "networkidle" });

  // Check for PIN buttons
  for (const digit of ["1", "2", "3", "4"]) {
    await page.locator(`button:text-is("${digit}")`).first().click();
    await page.waitForTimeout(100);
  }

  // Wait for cashier screen to appear
  await page.waitForTimeout(2000);
  console.log("PIN entered. Page title:", await page.title());
  
  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_production_cashier_success.png" });
  console.log("Screenshot saved: live_production_cashier_success.png");

  // Check waiter screen
  console.log("Navigating to https://hipos.hayatisleri.com.tr/waiter...");
  await page.goto("https://hipos.hayatisleri.com.tr/waiter", { waitUntil: "networkidle" });
  // Waiter PIN: 2222
  for (const digit of ["2", "2", "2", "2"]) {
    await page.locator(`button:text-is("${digit}")`).first().click();
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_production_waiter_success.png" });
  console.log("Screenshot saved: live_production_waiter_success.png");

  // Check KDS kitchen screen
  console.log("Navigating to https://hipos.hayatisleri.com.tr/kitchen...");
  await page.goto("https://hipos.hayatisleri.com.tr/kitchen", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_production_kitchen_success.png" });
  console.log("Screenshot saved: live_production_kitchen_success.png");

  // Check Admin screen
  console.log("Navigating to https://hipos.hayatisleri.com.tr/admin/...");
  await page.goto("https://hipos.hayatisleri.com.tr/admin/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/Users/mac/.gemini/antigravity/brain/496613d7-1109-48b1-8f26-c6c659b26926/live_production_admin_success.png" });
  console.log("Screenshot saved: live_production_admin_success.png");

  console.log("\nBad HTTP requests during test (status >= 400):", badRequests.filter(r => !r.url.includes("favicon")));
  await browser.close();
}

run().catch(console.error);
