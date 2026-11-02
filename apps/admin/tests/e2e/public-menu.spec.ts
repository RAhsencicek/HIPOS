import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("müşteri menüsü tüm aktif menü bölümlerini mobil düzende gösterir", async ({ page }) => {
  await page.route("**/api/v1/public/menus/test-menu", route => route.fulfill({ json: {
    restaurantName: "Test Restoran", branchName: "Test Şubesi", logoUrl: null,
    menus: [
      { id: "m1", name: "Ana Menü", description: "", sections: [{ sectionId: "yemek", name: "Yemekler", products: [{ id: "p1", name: "Çorba", description: "Günlük hazırlanır", allergens: ["Süt"], price: { amountMinor: 12500, currency: "TRY" }, imageUrl: "/menu-food.svg" }] }] },
      { id: "m2", name: "İçecekler", description: "", sections: [{ sectionId: "sicak", name: "Sıcak İçecekler", products: [{ id: "p2", name: "Çay", description: "", allergens: [], price: { amountMinor: 3000, currency: "TRY" }, imageUrl: null }] }] },
      { id: "m3", name: "Boş Menü", description: "", sections: [] },
    ],
  } }));
  await page.route("**/menu-food.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>' }));
  await page.goto("/menu/test-menu?masa=12");
  await expect(page.getByRole("heading", { name: "Test Restoran" })).toBeVisible();
  await expect.poll(() => page.locator(".qr-brand-logo img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Masa 12")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ana Menü — Menü" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yemekler — Ana Menü" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sıcak İçecekler — İçecekler" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ana Menü — Menü" }).locator("img")).toHaveAttribute("src", /\/menu-food\.svg$/);
  await expect(page.getByRole("button", { name: "Yemekler — Ana Menü" }).locator("img")).toHaveAttribute("src", /\/menu-food\.svg$/);
  await expect(page.getByText("Günlük hazırlanır")).toHaveCount(0);
  await page.getByRole("button", { name: "Yemekler — Ana Menü" }).click();
  await expect(page.getByText("Günlük hazırlanır")).toBeVisible();
  await expect(page.getByText(/125,00/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Çay" })).toHaveCount(0);
  await page.getByRole("button", { name: "Menü ve kategoriler" }).click();
  await page.getByRole("button", { name: "İçecekler — Menü" }).click();
  await expect(page.getByRole("heading", { name: "Çay" })).toBeVisible();
  await expect(page.getByLabel("Ürün görseli yok").first()).toBeVisible();
  await page.getByRole("button", { name: "Menü ve kategoriler" }).click();
  await page.getByRole("button", { name: "Boş Menü — Menü" }).click();
  await expect(page.getByText("Bu menüde şu anda gösterilebilecek ürün bulunmuyor.")).toBeVisible();
  await page.getByRole("button", { name: "Menü ve kategoriler" }).click();
  await expect(page.getByText("Yönetim Paneli")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Menüde ara").fill("çay");
  await expect(page.getByRole("heading", { name: "Çay" })).toBeVisible();
  await page.getByLabel("Aramayı temizle").click();
  await expect(page.getByRole("button", { name: "Ana Menü — Menü" })).toBeVisible();
});

test("müşteri menüsü bağlantı hatasını ve boş menüyü ayırır", async ({ page }) => {
  await page.route("**/api/v1/public/menus/missing", route => route.fulfill({ status: 404 }));
  await page.goto("/menu/missing");
  await expect(page.getByText("Bu menü bağlantısı bulunamadı.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tekrar dene" })).toBeVisible();
  await page.route("**/api/v1/public/menus/empty", route => route.fulfill({ json: { restaurantName: "Test Restoran", branchName: "Test Şubesi", logoUrl: null, menus: [] } }));
  await page.goto("/menu/empty");
  await expect(page.getByRole("heading", { name: "Menü henüz hazır değil" })).toBeVisible();
});

test("menü yüklenirken durum gösterilir", async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/public/menus/slow", async route => {
    await gate;
    await route.fulfill({ json: { restaurantName: "Test Restoran", branchName: "Test Şubesi", logoUrl: null, menus: [] } });
  });
  await page.goto("/menu/slow");
  await expect(page.getByRole("heading", { name: "Menü hazırlanıyor" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Menü henüz hazır değil" })).toBeVisible();
});

test("müşteri rotası eklendikten sonra yönetim rotası açılır", async ({ page }) => {
  await page.goto("/admin/catalog/products");
  await expect(page.getByRole("heading", { name: "Ürünler", exact: true })).toBeVisible();
});
