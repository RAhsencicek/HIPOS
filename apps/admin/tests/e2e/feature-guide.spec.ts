import { expect, test } from "@playwright/test";

test("cari alt ekranları ve gelecek işleri ayrı gösterir; demo hareketleri görünür", async ({ page }) => {
  await page.goto("/admin/customers");
  const current = page.getByRole("region", { name: "Bu alanda neler var?" });
  const future = page.getByRole("region", { name: "Gelecekte neler olacak?" });
  await expect(current.getByRole("link", { name: /Cari Hesaplar/ })).toBeVisible();
  await expect(future.getByRole("link", { name: /Sadakat Puanları/ })).toBeVisible();
  await expect(page.locator('.nav-children a[href="/admin/customers/loyalty"]')).toHaveCSS("color", "rgb(180, 35, 50)");

  await current.getByRole("link", { name: /Cari Hesaplar/ }).click();
  await expect(page.getByRole("heading", { name: "Cari hesaplar", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("Beta Ofis").first()).toBeVisible();
  await expect(page.getByText("ABC Gıda").first()).toBeVisible();
  await expect(page.getByText("2.000,00").first()).toBeVisible();
  await expect(page.getByText("9.500,00").first()).toBeVisible();
  await expect(page.getByText("Cari kartları ve hareketleri kurgusal demo verisidir.", { exact: false })).toBeVisible();
});

test("reçete ve sayım örnekleri aynı hammaddeye bağlanır", async ({ page }) => {
  await page.goto("/admin/inventory");
  const current = page.getByRole("region", { name: "Bu alanda neler var?" });
  await expect(current.getByRole("link", { name: /Reçeteler/ })).toBeVisible();
  await expect(current.getByRole("link", { name: /Stok Sayımları/ })).toBeVisible();
  await current.getByRole("link", { name: /Reçeteler/ }).click();
  await expect(page.getByRole("heading", { name: "Margherita Pizza" })).toBeVisible();
  await expect(page.getByText("Mozzarella")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Mozzarella" }).getByText("120 g")).toBeVisible();

  await page.goto("/admin/inventory/counts");
  await expect(page.getByText("800 g", { exact: true })).toBeVisible();
  await expect(page.getByText("700 g", { exact: true })).toBeVisible();
  await expect(page.getByText("-100 g", { exact: true })).toBeVisible();
  await expect(page.getByText("stok miktarı değişmedi", { exact: false })).toBeVisible();
});

test("ürün ayrıntısında demo reçetenin hammadde miktarları okunur", async ({ page }) => {
  await page.goto("/admin/catalog/products/55555555-5555-4555-8555-555555555501");
  const recipe = page.locator(".demo-product-recipe");
  await expect(recipe).toContainText("Veritabanına bağlı değil");
  await expect(recipe).toContainText("Un");
  await expect(recipe).toContainText("250 g");
  await expect(recipe).toContainText("Domates sosu");
  await expect(recipe).toContainText("80 g");
  await expect(recipe).toContainText("Mozzarella");
  await expect(recipe).toContainText("120 g");
});

test("planlanan alt ekran açık durum ve kırmızı menü bağlantısı taşır", async ({ page }) => {
  await page.goto("/admin/settings/users");
  await expect(page.getByRole("heading", { name: "Kullanıcılar ve Yetkiler", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("Gelecek planı").first()).toBeVisible();
  await expect(page.locator('.nav-children a[href="/admin/settings/users"]')).toHaveCSS("color", "rgb(180, 35, 50)");
});
