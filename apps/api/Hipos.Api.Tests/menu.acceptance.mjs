import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

export async function verifyMenuApi({ request, firm, branch, otherBranch, pizzaId, cakeId, sql }) {
  const root = `/api/v1/firms/${firm}/branches/${branch}`;
  const menus = `${root}/catalog/menus`;
  const features = `${root}/features`;
  async function setEnabled(desiredEnabled) {
    const state = (await request(features)).data.find(x => x.key === "catalog.menus");
    const result = await request(`${features}/catalog.menus`, "PUT", { desiredEnabled, expectedVersion: state.version });
    assert.equal(result.status, 200);
  }
  const id = randomUUID();
  const body = { requestId: id, expectedVersion: 0, name: "Kabul Testi Menüsü", description: "Kalıcı menü testi",
    sections: [{ sectionId: "pizza-custom", name: "Öne Çıkanlar", productIds: [pizzaId] }, { sectionId: "dessert-custom", name: "Tatlılar", productIds: [cakeId] }] };
  assert.equal((await request(menus)).data.source, "postgres");
  assert.equal((await request(menus, "POST", body)).data.code, "FEATURE_DISABLED");
  await setEnabled(true);
  assert.equal((await request(menus, "POST", body, "viewer-multi")).status, 403);
  assert.equal((await request(menus, "POST", body, "manager-single")).status, 403);
  assert.equal((await request(menus, "POST", { ...body, sections: [{ sectionId: "pizza", name: "Pizzalar", productIds: [pizzaId, pizzaId] }] })).status, 400);
  assert.equal((await request(menus, "POST", { ...body, sections: [
    { sectionId: "first", name: "İlk başlık", productIds: [pizzaId] },
    { sectionId: "second", name: "İkinci başlık", productIds: [pizzaId] }] })).data.code, "DUPLICATE_MENU_ITEM");
  assert.equal((await request(menus, "POST", { ...body, requestId: randomUUID(), sections: [{ sectionId: "drinks", name: "Kahvaltı Favorileri", productIds: [pizzaId] }] })).status, 200,
    "Ürün katalog kategorisinden bağımsız özel menü başlığına eklenebilir");
  const crossCategoryMenu = (await request(menus)).data.items.find(x => x.name === body.name);
  assert.equal(crossCategoryMenu.sections[0].name, "Kahvaltı Favorileri");
  assert.equal((await request(`${menus}/${crossCategoryMenu.id}`, "PUT", { ...body, requestId: randomUUID(), expectedVersion: 1,
    sections: [{ sectionId: "pizza-custom", name: "Öne Çıkanlar", productIds: [pizzaId] }] })).status, 200);
  assert.equal((await request(menus, "POST", { ...body, requestId: randomUUID(), name: "Yabancı Ürün", sections: [
    { sectionId: "foreign", name: "Yabancı", productIds: ["55555555-5555-4555-8555-555555555501"] }] })).data.code, "INVALID_MENU_PRODUCT");
  assert.equal((await request(menus, "POST", body)).status, 200);
  assert.equal((await request(menus, "POST", body)).data.replayed, true);
  assert.equal((await request(menus, "POST", { ...body, name: "Farklı menü" })).data.code, "REQUEST_ID_CONFLICT");
  const createAudit = await sql(`SELECT count(*) FROM catalog.menu_audit WHERE menu_id='${id}'`);
  assert.equal(createAudit.trim(), "1");
  assert.equal((await request(`${menus}/${id}/activation`, "POST", { requestId: randomUUID(), expectedVersion: 1, isActive: true })).data.code, "MENU_NOT_READY");
  const update = { ...body, requestId: randomUUID(), expectedVersion: 1, sections: [{ sectionId: "pizza-custom", name: "Öne Çıkanlar", productIds: [pizzaId] }] };
  assert.equal((await request(`${menus}/${id}`, "PUT", update)).status, 200);
  assert.equal((await request(`${menus}/${id}`, "PUT", update)).data.replayed, true);
  assert.equal((await request(`${menus}/${id}`, "PUT", { ...update, requestId: randomUUID() })).data.code, "VERSION_CONFLICT");
  const activation = { requestId: randomUUID(), expectedVersion: 2, isActive: true };
  assert.equal((await request(`${menus}/${id}/activation`, "POST", activation)).status, 200);
  assert.equal((await request(`${menus}/${id}/activation`, "POST", activation)).data.replayed, true);
  assert.equal((await request(`${menus}/${id}`, "PUT", { ...update, requestId: randomUUID(), expectedVersion: 3, sections: [] })).data.code, "MENU_NOT_READY");
  const secondId = randomUUID();
  assert.equal((await request(menus, "POST", { ...update, requestId: secondId, expectedVersion: 0, name: "İkinci Menü" })).status, 200);
  assert.equal((await request(`${menus}/${secondId}/activation`, "POST", { requestId: randomUUID(), expectedVersion: 1, isActive: true })).status, 200);
  let list = (await request(menus)).data.items;
  assert.equal(list.filter(x => x.isActive).length, 1);
  assert.equal(list.find(x => x.id === id).isActive, false);
  assert.equal(list.find(x => x.id === id).version, 4);
  const racing = await Promise.all(["A", "B"].map(suffix => request(`${menus}/${id}`, "PUT",
    { ...update, requestId: randomUUID(), expectedVersion: 4, name: `Yarış Menüsü ${suffix}` })));
  assert.deepEqual(racing.map(x => x.status).sort(), [200, 409]);
  list = (await request(menus)).data.items;
  assert.deepEqual(list.find(x => x.id === id).sections, update.sections);
  assert.equal((await request(`/api/v1/firms/${firm}/branches/${otherBranch}/catalog/menus`)).data.items.some(x => x.id === id), false);
  await setEnabled(false);
  assert.equal((await request(menus)).status, 200);
  assert.equal((await request(`${menus}/${id}`, "PUT", { ...update, requestId: randomUUID(), expectedVersion: 5 })).data.code, "FEATURE_DISABLED");
  assert.equal((await request(`${menus}/${secondId}/activation`, "POST", { requestId: randomUUID(), expectedVersion: 2, isActive: false })).data.code, "FEATURE_DISABLED");
  await setEnabled(true);
}

export async function verifyMenuPanel({ browser, uiBase, request, single, singleBranch }) {
  const featureRoot = `/api/v1/firms/${single}/branches/${singleBranch}/features`;
  const menuState = (await request(featureRoot, "GET", undefined, "manager-single")).data.find(x => x.key === "catalog.menus");
  assert.equal((await request(`${featureRoot}/catalog.menus`, "PUT", { desiredEnabled: true, expectedVersion: menuState.version }, "manager-single")).status, 200);
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  await page.goto(`${uiBase}/admin/catalog/menus`);
  await expect(page.getByRole("heading", { name: "Menüler", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yeni menü", exact: true }).click();
  await page.getByLabel("Menü adı", { exact: true }).fill("Panel Kabul Menüsü");
  await page.getByLabel("Açıklama", { exact: true }).fill("Menü düzenleme uçtan uca testi");
  await page.getByLabel("Özel bölüm adı").fill("Günün Favorileri");
  await page.getByRole("button", { name: "Özel başlık ekle" }).click();
  await page.getByRole("button", { name: /Ürün seç/ }).click();
  await page.getByLabel("Ürün kataloğunda ara").fill("Pizza");
  await page.getByRole("checkbox", { name: /Karışık Pizza/ }).check();
  await page.getByLabel("Ürün kataloğunda ara").fill("Cheesecake");
  await page.getByRole("checkbox", { name: /San Sebastian Cheesecake/ }).check();
  await page.getByRole("button", { name: "Seçimi tamamla" }).click();
  await page.getByRole("button", { name: "San Sebastian Cheesecake ürününü yukarı taşı" }).click();
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText("Menü kaydedildi. Değişiklikler kalıcı olarak saklanıyor.")).toBeVisible();
  const menuUrl = page.url();
  await page.reload();
  await expect(page.getByLabel("Menü adı", { exact: true })).toHaveValue("Panel Kabul Menüsü");
  const preview = page.getByRole("complementary", { name: "Menü önizlemesi" });
  await expect(preview.getByRole("heading", { name: "Günün Favorileri" })).toBeVisible();
  await expect(preview.locator(".menu-preview-product span")).toHaveText(["San Sebastian Cheesecake", "Karışık Pizza"]);
  await page.getByRole("button", { name: "San Sebastian Cheesecake ürününü bu bölümden çıkar" }).click();
  await page.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText("Menü kaydedildi. Değişiklikler kalıcı olarak saklanıyor.")).toBeVisible();
  await page.getByRole("button", { name: "Şubede yayına al", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Şubede yayına al", exact: true }).click();
  await expect(page.getByText("Menü bu şubede yayına alındı.")).toBeVisible();
  await page.getByRole("button", { name: "Menülere dön" }).click();
  await expect(page.getByRole("heading", { name: "Panel Kabul Menüsü", exact: true, level: 2 })).toBeVisible();
  const menus = (await request(`/api/v1/firms/${single}/branches/${singleBranch}/catalog/menus`, "GET", undefined, "manager-single")).data;
  assert.equal(menus.items.find(x => x.id === new URL(menuUrl).searchParams.get("menu")).isActive, true);
  assert.equal(menus.products.some(x => x.name === "Tek Şube Pizza"), true);
  assert.deepEqual(menus.items.find(x => x.name === "Panel Kabul Menüsü").sections.map(x => x.name), ["Günün Favorileri"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Menüler", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.close();
}
