import { expect, test } from "@playwright/test";

test("panel .NET sunucusuna bağlanır; tercih yenilemede kalır ve diğer şubeye taşmaz", async ({
  page,
}) => {
  await page.goto("/admin/settings/modules");
  await page.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
  await expect(
    page.getByText("Yerel .NET sunucu prototipine bağlı", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("moda");
  await page
    .getByRole("switch", { name: "Sadakat ve Kuponlar tercihini aç" })
    .click();
  await page.getByRole("button", { name: "Önizlemede aç" }).click();
  await expect(
    page.getByRole("switch", { name: "Sadakat ve Kuponlar tercihini kapat" }),
  ).toBeChecked();

  await page.reload();
  await page.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
  await page
    .getByRole("combobox", { name: "Şube seçimi" })
    .selectOption("moda");
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

test("iki yönetici ekranında eski sürüm reddedilir ve ikinci ekran güncellenir", async ({
  page,
}) => {
  const otherPage = await page.context().newPage();
  try {
    for (const currentPage of [page, otherPage]) {
      await currentPage.goto("/admin/settings/modules");
      await currentPage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await currentPage
        .getByRole("combobox", { name: "Şube seçimi" })
        .selectOption("moda");
      await expect(
        currentPage.getByRole("switch", {
          name: "Gider Yönetimi tercihini aç",
        }),
      ).toBeVisible();
    }
    await page
      .getByRole("switch", { name: "Gider Yönetimi tercihini aç" })
      .click();
    await page.getByRole("button", { name: "Önizlemede aç" }).click();
    await expect(
      page.getByRole("switch", { name: "Gider Yönetimi tercihini kapat" }),
    ).toBeChecked();

    await otherPage
      .getByRole("switch", { name: "Gider Yönetimi tercihini aç" })
      .click();
    await otherPage.getByRole("button", { name: "Önizlemede aç" }).click();
    await expect(otherPage.getByRole("alert")).toContainText(
      "Ayar başka bir işlemle değişti",
    );
    await expect(
      otherPage.getByRole("switch", { name: "Gider Yönetimi tercihini kapat" }),
    ).toBeChecked();
  } finally {
    await otherPage.close();
  }
});
