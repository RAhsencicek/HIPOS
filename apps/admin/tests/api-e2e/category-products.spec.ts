import { expect, test } from "@playwright/test";

test("kategori ürünleri filtrelenir ve yeni taslak seçilen kategoriyle gönderilir", async ({ page }) => {
  const category = { id: "drinks", name: "İçecekler", productCount: 1, version: 1, isActive: true, sortOrder: 0 };
  const product = {
    id: "11111111-1111-4111-8111-111111111119", name: "Ayran", sku: "AY-1",
    category: { id: category.id, name: category.name }, status: "draft", isActive: true,
    channels: [], image: "", recipeLinked: false, price: { amountMinor: 5000, currency: "TRY" },
    priceSource: "central", updatedAt: "2026-10-27T10:00:00Z", version: 1,
    description: "", allergens: [], optionGroups: [], firmId: "11111111-1111-4111-8111-111111111111",
    branchIds: ["33333333-3333-4333-8333-333333333333"], brandId: null,
  };
  let draftBody: Record<string, unknown> | undefined;
  let savedOptions: Record<string, unknown> | undefined;
  let createdItem: Record<string, unknown> | undefined;
  const groupId = "55555555-5555-4555-8555-555555555555";
  const groups = [{ id: groupId, name: "Ekstralar", isActive: true, sortOrder: 0, version: 1,
    items: [{ id: "66666666-6666-4666-8666-666666666666", name: "Peynir", priceDeltaMinor: 2000,
      quantityEnabled: true, maxQuantity: 3, isActive: true, sortOrder: 0 }] }];
  let filtered = false;
  let secondPageFiltered = false;
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];
    if (path.endsWith("/features/definitions")) body = [];
    else if (path.endsWith("/features")) body = ["catalog.drafts", "catalog.price_drafts", "catalog.publishing"].map(key => ({ key, effectiveForNewWork: true }));
    else if (path.endsWith("/catalog/categories")) body = { scope: {}, items: [category] };
    else if (path.endsWith(`/catalog/products/${product.id}/option-groups`)) {
      if (route.request().method() === "PUT") savedOptions = route.request().postDataJSON();
      body = { productId: product.id, productVersion: 1, items: [] };
    } else if (path.endsWith("/catalog/option-groups")) {
      if (route.request().method() === "POST") {
        const input = route.request().postDataJSON();
        groups.push({ id: input.requestId, name: input.name, isActive: input.isActive, sortOrder: input.sortOrder, version: 1, items: [] });
        body = groups.at(-1);
      } else body = { items: groups };
    } else if (path.includes("/catalog/option-groups/") && path.endsWith("/items") && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      createdItem = input;
      const id = path.split("/").at(-2);
      const group = groups.find(value => value.id === id)!;
      group.items.push({ id: input.requestId, name: input.name, priceDeltaMinor: input.priceDeltaMinor, quantityEnabled: input.quantityEnabled,
        maxQuantity: input.maxQuantity, isActive: input.isActive, sortOrder: input.sortOrder });
      group.version++;
      body = { groupId: id, groupVersion: group.version, item: group.items.at(-1) };
    }
    else if (path.endsWith("/catalog/products") && route.request().method() === "POST") {
      draftBody = route.request().postDataJSON();
      body = product;
    }
    else if (path.endsWith("/catalog/products")) {
      filtered ||= url.searchParams.get("categoryId") === category.id;
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      secondPageFiltered ||= pageNumber === 2 && url.searchParams.get("categoryId") === category.id;
      body = { items: [pageNumber === 2 ? { ...product, name: "Soda" } : product], categories: [{ id: category.id, name: category.name }],
        pageInfo: { page: pageNumber, pageSize: 25, totalItems: 26, totalPages: 2 }, scope: {} };
    } else if (path.endsWith(`/catalog/products/${product.id}`)) body = product;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/admin/catalog/categories");
  const row = page.locator("article").filter({ hasText: "İçecekler" });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "İçecekler ürünlerini gör" }).click();
  await expect(page.getByRole("link", { name: "Ayran", exact: true })).toBeVisible();
  expect(filtered).toBe(true);
  await page.getByRole("button", { name: "Sonraki" }).click();
  await expect(page.getByRole("link", { name: "Soda", exact: true })).toBeVisible();
  expect(secondPageFiltered).toBe(true);

  await page.goBack();
  await row.getByRole("link", { name: "İçecekler kategorisine ürün ekle" }).click();
  const form = page.getByRole("region", { name: "Yeni ürün" });
  await expect(form.getByLabel("Kategori", { exact: true })).toHaveValue("drinks");
  await form.getByLabel("Ürün adı").fill("Limonata");
  await form.getByLabel("Stok kodu").fill("LIM-1");
  await form.getByLabel("Fiyat (TL)").fill("75,50");
  await form.getByLabel("Alerjenler").fill("süt, gluten");
  await form.getByRole("button", { name: "Ürünü kaydet" }).click();
  await expect(page.getByText("Ürün ve fiyat kaydedildi.", { exact: false })).toBeVisible();
  expect(draftBody).toMatchObject({ name: "Limonata", sku: "LIM-1", categoryId: "drinks", categoryName: "İçecekler", amountMinor: 7550, allergens: ["süt", "gluten"] });
  const options = page.getByRole("region", { name: "Ürün seçenekleri" });
  await options.getByLabel("Yeni grup adı").fill("Soslar");
  await options.getByRole("button", { name: "Grup oluştur" }).click();
  const sauceGroup = options.locator(".product-option-group").filter({ hasText: "Soslar" });
  await sauceGroup.getByText("Grup ve seçenekleri düzenle").click();
  await sauceGroup.getByLabel("Seçenek adı").fill("Özel sos");
  await sauceGroup.getByLabel("Fiyat farkı (TL)").fill("-5,50");
  await sauceGroup.getByLabel("Adet seçilebilir").check();
  await sauceGroup.getByLabel("En yüksek adet").fill("2");
  await sauceGroup.getByRole("button", { name: "Seçenek ekle" }).click();
  await expect.poll(() => createdItem).toMatchObject({ name: "Özel sos", priceDeltaMinor: -550, quantityEnabled: true, maxQuantity: 2 });
  await options.getByRole("checkbox", { name: "Ekstralar" }).check();
  await options.getByLabel("En çok seçim").fill("1");
  await options.getByRole("button", { name: "Ürün seçeneklerini kaydet" }).click();
  await expect.poll(() => savedOptions).toMatchObject({ expectedVersion: 1,
    items: [{ groupId, minSelections: 0, maxSelections: 1, sortOrder: 0 }] });
});

test("yayımlanmış ürün fiyatı ve bilgileri gerçek komutlara gönderilir", async ({ page }) => {
  const id = "11111111-1111-4111-8111-111111111119";
  const product = { id, firmId: "11111111-1111-4111-8111-111111111111", brandId: null,
    branchIds: ["33333333-3333-4333-8333-333333333333"], name: "Ayran", sku: "AY-1",
    category: { id: "drinks", name: "İçecekler" }, status: "published", isActive: true, channels: ["pos"],
    image: "", recipeLinked: false, price: { amountMinor: 5000, currency: "TRY" }, priceSource: "central",
    updatedAt: "2026-10-27T10:00:00Z", version: 1, description: "", allergens: ["süt"], optionGroups: [] };
  let priceBody: Record<string, unknown> | undefined;
  let editBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let body: unknown = [];
    if (path.endsWith("/features/definitions")) body = [];
    else if (path.endsWith("/features")) body = ["catalog.drafts", "catalog.price_drafts", "catalog.publishing"].map(key => ({ key, effectiveForNewWork: true }));
    else if (path.endsWith("/catalog/categories")) body = { items: [{ id: "drinks", name: "İçecekler", productCount: 1 }] };
    else if (path.endsWith("/catalog/option-groups")) body = { items: [] };
    else if (path.endsWith(`/catalog/products/${id}/option-groups`)) body = { productId: id, productVersion: product.version, items: [] };
    else if (path.endsWith(`/catalog/products/${id}/price`) && method === "PUT") {
      priceBody = route.request().postDataJSON(); product.price.amountMinor = Number(priceBody!.amountMinor); product.version++;
      body = { product, priceVersion: {} };
    } else if (path.endsWith(`/catalog/products/${id}`) && method === "PUT") {
      editBody = route.request().postDataJSON(); product.name = String(editBody!.name); product.allergens = editBody!.allergens as string[]; product.version++;
      body = product;
    } else if (path.endsWith(`/catalog/products/${id}`)) body = product;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`/admin/catalog/products/${id}`);
  const priceForm = page.getByRole("form", { name: "Ürün fiyatı" });
  await priceForm.getByLabel("Fiyat (TL)").fill("85,00");
  await priceForm.getByRole("button", { name: "Fiyatı güncelle" }).click();
  await expect(page.getByText("Yeni fiyat kaydedildi ve yeni satışlarda geçerli.")).toBeVisible();
  expect(priceBody).toMatchObject({ amountMinor: 8500, expectedVersion: 1 });
  await page.getByRole("button", { name: "Ürünü düzenle" }).click();
  const form = page.getByRole("region", { name: "Ürünü düzenle" });
  await form.getByLabel("Ürün adı").fill("Ev Ayranı");
  await form.getByLabel("Alerjenler").fill("süt, fındık");
  await form.getByRole("button", { name: "Değişiklikleri kaydet" }).click();
  await expect(page.getByText("Ürün bilgileri kaydedildi.")).toBeVisible();
  expect(editBody).toMatchObject({ name: "Ev Ayranı", allergens: ["süt", "fındık"], expectedVersion: 2 });
});
