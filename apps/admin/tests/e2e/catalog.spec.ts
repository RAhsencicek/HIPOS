import { expect, test } from "@playwright/test";

test("şube kapsamı ürün ve fiyat görünümünü değiştirir", async ({ page }) => {
  await page.goto("/admin/catalog/products");
  await expect(
    page.getByRole("heading", { name: "Ürünler", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("besiktas");
  await expect(page.getByText("5 ürün gösteriliyor")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "San Sebastian Cheesecake" }),
  ).toHaveCount(0);
  const margherita = page.getByRole("row").filter({
    has: page.getByRole("link", { name: "Margherita Pizza", exact: true }),
  });
  await expect(margherita).toContainText("340,00");
  await margherita
    .getByRole("link", { name: "Margherita Pizza", exact: true })
    .click();
  await expect(page.getByText("Şube istisnası")).toBeVisible();
});

test("boş, hata, yetkisiz ve kapalı durumlar birbirine karışmaz", async ({
  page,
}) => {
  await page.goto("/admin/catalog/products");
  const preview = page.getByRole("combobox", {
    name: "Katalog durum önizlemesi",
  });
  await preview.selectOption("empty");
  await expect(page.getByText("Henüz ürün yok")).toBeVisible();
  await preview.selectOption("error");
  await expect(page.getByRole("alert")).toContainText("Veri yüklenemedi");
  await preview.selectOption("unauthorized");
  await expect(page.getByRole("alert")).toContainText("Bu kapsama erişim yok");
  await preview.selectOption("disabled");
  await expect(page.getByRole("alert")).toContainText("Modül kapalı");
});

test("ürün ekleme önizlemesi sahte kayıt başarısı üretmez", async ({
  page,
}) => {
  await page.goto("/admin/catalog/products");
  await expect(page.getByText("6 ürün gösteriliyor")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("moda");
  await expect(
    page.getByRole("button", { name: "Ürün ekleme akışı" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Ürün ekleme akışı" }).click();
  await expect(
    page.getByText("Bu aşamada yeni ürün kaydı oluşturulmaz.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("6 ürün gösteriliyor")).toBeVisible();
  await expect(page.getByText("Ürün başarıyla kaydedildi")).toHaveCount(0);
});

test("kategori sekmeleri sabit liste yerine katalog verisinden gelir", async ({ page }) => {
  await page.goto("/admin/catalog/products");
  await expect(page.getByRole("button", { name: "Tatlılar" })).toBeVisible();
  await page.getByRole("button", { name: "Tatlılar" }).click();
  await expect(page.getByRole("link", { name: "San Sebastian Cheesecake", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Margherita Pizza", exact: true })).toHaveCount(0);
});

test("kategori sayfası seçilen şubeye göre salt okunur özet gösterir", async ({ page }) => {
  await page.goto("/admin/catalog/categories");
  await expect(page.getByRole("heading", { name: "Kategoriler", level: 1 })).toBeVisible();
  await page.getByRole("combobox", { name: "Şube seçimi" }).selectOption("besiktas");
  await expect(page.getByRole("row").filter({ hasText: "Pizzalar" })).toContainText("2");
  await expect(page.getByText("Tatlılar", { exact: true })).toHaveCount(0);
  await expect(page.getByText("kalıcı kayıt yapılmaz", { exact: false })).toBeVisible();
});
