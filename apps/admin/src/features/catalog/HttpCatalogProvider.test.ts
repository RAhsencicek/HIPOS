import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpCatalogProvider } from "./HttpCatalogProvider";

const scope = {
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  branchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
};

afterEach(() => vi.unstubAllGlobals());

describe("HttpCatalogProvider", () => {
  it("şube, arama, kategori ve sayfa kapsamını API'ye taşır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpCatalogProvider("http://127.0.0.1:5180").listProducts({
      scope, query: "pizza", categoryId: "pizza", page: 2, pageSize: 10,
    });
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/api/v1/firms/${scope.firmId}/catalog/products`);
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      page: "2", pageSize: "10", branchId: scope.branchId,
      query: "pizza", categoryId: "pizza",
    });
    expect(options.headers["X-Demo-Actor"]).toBe("manager-multi");
  });

  it("404 ve erişim hatalarını sahte boş listeye çevirmez", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "PRODUCT_NOT_FOUND", detail: "Ürün bu kapsamda bulunamadı." }),
      { status: 404, headers: { "Content-Type": "application/problem+json" } },
    )));
    await expect(new HttpCatalogProvider().getProduct({ scope, productId: "missing" }))
      .rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND", status: 404 });
  });

  it("API kapalıysa bağlantı hatasını açıkça verir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(new HttpCatalogProvider().listProducts({ scope, page: 1, pageSize: 25 }))
      .rejects.toMatchObject({ code: "LOAD_FAILED", status: 503 });
  });

  it("kategori okumasında firma ve şube kapsamını API'ye taşır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope, items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpCatalogProvider().listCategories(scope);
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/api/v1/firms/${scope.firmId}/catalog/categories`);
    expect(parsed.searchParams.get("branchId")).toBe(scope.branchId);
  });

  it("taslak oluşturmayı doğru şube kapsamı ve sabit kimlikle API'ye gönderir", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "draft" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const command = { scope, draftId: "77777777-7777-4777-8777-777777777703", name: "Yeni pizza", sku: "P-1", categoryId: "pizza", categoryName: "Pizzalar", description: "Test" };
    await new HttpCatalogProvider().createDraft(command);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe(`/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/catalog/drafts`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ draftId: command.draftId, name: command.name, sku: command.sku, categoryId: command.categoryId, categoryName: command.categoryName, description: command.description });
  });

  it("taslak güncellemede beklenen sürümü gönderir ve çatışmayı başarıya çevirmez", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "VERSION_CONFLICT", detail: "Taslak değişti." }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpCatalogProvider().updateDraft({ scope, draftId: "draft-1", expectedVersion: 2, name: "Pizza", sku: "P-1", categoryId: "pizza", categoryName: "Pizzalar", description: "" }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe(`/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/catalog/drafts/draft-1`);
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body).expectedVersion).toBe(2);
  });

  it("şube seçilmeden taslak yazma isteği göndermez", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpCatalogProvider().createDraft({ scope: { ...scope, branchId: null }, draftId: "draft", name: "Pizza", sku: "P-1", categoryId: "pizza", categoryName: "Pizzalar", description: "" }))
      .rejects.toMatchObject({ code: "INVALID_DRAFT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fiyat, yayın ve geçmiş uçlarını şube kapsamında çağırır", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new HttpCatalogProvider();
    const draftId = "77777777-7777-4777-8777-777777777709";
    await provider.setDraftPrice({ scope, draftId, priceVersionId: "price-id", amountMinor: 32550, expectedVersion: 2 });
    await provider.publishDraft({ scope, draftId, publicationId: "publication-id", expectedVersion: 3 });
    await provider.listPriceVersions({ scope, productId: draftId });
    await provider.listPublications({ scope, productId: draftId });
    const prefix = `/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/catalog`;
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(`${prefix}/drafts/${draftId}/price`);
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ priceVersionId: "price-id", amountMinor: 32550, expectedVersion: 2 });
    expect(new URL(fetchMock.mock.calls[1][0]).pathname).toBe(`${prefix}/drafts/${draftId}/publish`);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ publicationId: "publication-id", expectedVersion: 3 });
    expect(new URL(fetchMock.mock.calls[2][0]).pathname).toBe(`${prefix}/products/${draftId}/price-versions`);
    expect(new URL(fetchMock.mock.calls[3][0]).pathname).toBe(`${prefix}/products/${draftId}/publications`);
  });

  it("fiyat/yayın hatasını başarıya çevirmeden iletir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "VERSION_CONFLICT", detail: "Taslak değişti." }), { status: 409 },
    )));
    await expect(new HttpCatalogProvider().publishDraft({ scope, draftId: "draft", publicationId: "id", expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });
});
