import { expect, test } from "@playwright/test";

test("modül tercihi yalnız seçilen şubeyi etkiler ve kalıcı işlem gibi sunulmaz", async ({
  page,
}) => {
  await page.goto("/admin/settings/modules");
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("moda");
  const toggle = page.getByRole("switch", {
    name: "Sadakat ve Kuponlar tercihini aç",
  });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Kapsam: yalnız Moda Şubesi",
  );
  await page.getByRole("button", { name: "Önizlemede aç" }).click();
  await expect(
    page.getByText("Gerçek işletme ayarı değişmedi", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Sadakat ve Kuponlar tercihini kapat" }),
  ).toBeChecked();
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("besiktas");
  await expect(
    page.getByRole("switch", { name: "Sadakat ve Kuponlar tercihini aç" }),
  ).not.toBeChecked();
});

test("kapalı modülde geçmiş ürün okunur, yeni iş önizlemesi kapatılır", async ({
  page,
}) => {
  await page.goto("/admin/settings/modules");
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("moda");
  await page
    .getByRole("switch", { name: "Fiyat Yönetimi tercihini kapat" })
    .click();
  await page.getByRole("button", { name: "Önizlemede kapat" }).click();
  await page
    .getByRole("switch", { name: "Ürün ve Menü tercihini kapat" })
    .click();
  await page.getByRole("button", { name: "Önizlemede kapat" }).click();
  await page.getByRole("button", { name: "Ürünler ve Menü" }).click();
  await page.getByRole("link", { name: "Ürünler", exact: true }).click();
  await expect(page.getByText("Bu özellik bu şubede kapalı")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Margherita Pizza", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ürün ekleme akışı" }),
  ).toBeDisabled();
});

test("devam eden iş ve yetkisiz kapsam açıkça gösterilir", async ({ page }) => {
  await page.goto("/admin/kitchen?featureState=unauthorized");
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("atasehir");
  await expect(page.getByRole("alert")).toContainText(
    "Bu şubenin verilerine erişim yok",
  );
  await page.goto("/admin/kitchen");
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("atasehir");
  await expect(
    page.getByText("Yeni işler kapalı; devam eden işler tamamlanıyor"),
  ).toBeVisible();
});
