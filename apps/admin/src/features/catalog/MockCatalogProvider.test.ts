import { describe, expect, it } from "vitest";
import { catalogIds, catalogRecords } from "./catalog.fixtures";
import { MockCatalogProvider } from "./MockCatalogProvider";
import type { CatalogScope } from "./contracts";

const multiAll = { firmId: catalogIds.multiFirm, branchId: null };
const besiktas = {
  firmId: catalogIds.multiFirm,
  branchId: catalogIds.besiktas,
};
const moda = { firmId: catalogIds.multiFirm, branchId: catalogIds.moda };
const list = (scope: CatalogScope = multiAll) => ({
  scope,
  page: 1,
  pageSize: 25,
});

describe("MockCatalogProvider", () => {
  it("API biçiminde merkez ürün listesini döndürür", async () => {
    const response = await new MockCatalogProvider("normal", 0).listProducts(
      list(),
    );
    expect(response.scope).toEqual(multiAll);
    expect(response.pageInfo).toEqual({
      page: 1,
      pageSize: 25,
      totalItems: 6,
      totalPages: 1,
    });
    expect(response.items[0]).toMatchObject({
      firmId: catalogIds.multiFirm,
      brandId: catalogIds.brand,
      price: { amountMinor: 32000, currency: "TRY" },
      priceSource: "central",
    });
    expect(response.items.every((item) => item.id.includes("-"))).toBe(true);
  });

  it("şubeye görünmeyen ürünü gizler ve sunucu örneği şube fiyatını döndürür", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    const response = await provider.listProducts(list(besiktas));
    expect(response.pageInfo.totalItems).toBe(5);
    expect(
      response.items.some((item) => item.name === "San Sebastian Cheesecake"),
    ).toBe(false);
    expect(
      response.items.find((item) => item.name === "Margherita Pizza")?.price,
    ).toEqual({ amountMinor: 34000, currency: "TRY" });
    expect(
      response.items.find((item) => item.name === "Margherita Pizza")
        ?.priceSource,
    ).toBe("branch_override");

    const modaResponse = await provider.listProducts(list(moda));
    expect(
      modaResponse.items.find((item) => item.name === "Margherita Pizza")?.price
        .amountMinor,
    ).toBe(32000);
    await expect(
      provider.getProduct({
        scope: besiktas,
        productId: catalogRecords.at(-1)!.id,
      }),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });

  it("kategori özetini şube kapsamına göre sayar", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    const besiktasCategories = await provider.listCategories(besiktas);
    expect(besiktasCategories.items.some((item) => item.name === "Tatlılar")).toBe(false);
    expect(besiktasCategories.items.find((item) => item.id === "pizza")?.productCount).toBe(2);
    await expect(provider.listCategories({ firmId: catalogIds.singleFirm, branchId: catalogIds.moda }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED_SCOPE" });
  });

  it("firma/şube çapraz erişimini reddeder", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    await expect(
      provider.listProducts(
        list({ firmId: catalogIds.singleFirm, branchId: catalogIds.moda }),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_SCOPE", status: 403 });
    await expect(
      provider.getProduct({ scope: multiAll, productId: catalogRecords[0].id }),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND", status: 404 });
  });

  it("arama, kategori ve sayfalamayı sözleşmeyle uyumlu döndürür", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    const response = await provider.listProducts({
      ...list(),
      query: "pizza",
      categoryId: "pizza",
      pageSize: 1,
    });
    expect(response.pageInfo).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(response.items).toHaveLength(1);
  });

  it.each([
    ["empty", null],
    ["error", "MOCK_FAILURE"],
    ["unauthorized", "UNAUTHORIZED_SCOPE"],
    ["disabled", "FEATURE_DISABLED"],
    ["setup_required", "FEATURE_SETUP_REQUIRED"],
    ["provider_pending", "PROVIDER_PENDING"],
  ] as const)("%s önizleme durumunu açıkça döndürür", async (mode, code) => {
    const provider = new MockCatalogProvider(mode, 0);
    if (code === null) {
      expect((await provider.listProducts(list())).items).toEqual([]);
    } else {
      await expect(provider.listProducts(list())).rejects.toMatchObject({
        code,
      });
    }
  });

  it("kalıcı kayıt komutu sunmaz ve okuma fixture'ını değiştirmez", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    const before = JSON.stringify(catalogRecords);
    expect("createProduct" in provider).toBe(false);
    const response = await provider.listProducts(list());
    response.items[0].price.amountMinor = 1;
    expect(
      (await provider.listProducts(list())).items[0].price.amountMinor,
    ).toBe(32000);
    await provider.getProduct({
      scope: multiAll,
      productId: catalogRecords[6].id,
    });
    expect(JSON.stringify(catalogRecords)).toBe(before);
  });

  it("mock modunda taslak kaydetmeyi reddeder ve fixture'ı değiştirmez", async () => {
    const provider = new MockCatalogProvider("normal", 0);
    const before = JSON.stringify(catalogRecords);
    const command = { scope: moda, draftId: "77777777-7777-4777-8777-777777777703", name: "Pizza", sku: "P-1", categoryId: "pizza", categoryName: "Pizzalar", description: "" };
    await expect(provider.createDraft(command)).rejects.toMatchObject({ code: "DRAFT_NOT_AVAILABLE" });
    await expect(provider.updateDraft({ ...command, expectedVersion: 1 })).rejects.toMatchObject({ code: "DRAFT_NOT_AVAILABLE" });
    await expect(provider.setDraftPrice({ scope: moda, draftId: command.draftId, priceVersionId: "price", amountMinor: 10000, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "DRAFT_NOT_AVAILABLE" });
    await expect(provider.publishDraft({ scope: moda, draftId: command.draftId, publicationId: "publication", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "DRAFT_NOT_AVAILABLE" });
    expect(JSON.stringify(catalogRecords)).toBe(before);
  });
});
