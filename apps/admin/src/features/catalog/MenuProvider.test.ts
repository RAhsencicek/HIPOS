import { afterEach, expect, it, vi } from "vitest";
import { HttpMenuProvider, sampleMenus } from "./MenuProvider";

const scope = { firmId: "11111111-1111-4111-8111-111111111111", branchId: "33333333-3333-4333-8333-333333333333" };
afterEach(() => vi.unstubAllGlobals());

it("menü örnekleri başka firma veya şubenin kapsamına taşmaz", () => {
  expect(sampleMenus(scope).items.length).toBe(1);
  expect(sampleMenus({ ...scope, firmId: "other" }).items).toEqual([]);
  expect(sampleMenus({ ...scope, branchId: "other" }).products).toEqual([]);
});

it("HTTP menü kaydı firma/şube ve istek kimliğini korur", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "menu-1" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const input = { requestId: "request-1", expectedVersion: 2, name: "Ana Menü", description: "", sections: [] };
  await new HttpMenuProvider("http://local").save(scope, "menu-1", input);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`http://local/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/catalog/menus/menu-1`);
  expect(options.method).toBe("PUT");
  expect(JSON.parse(options.body)).toEqual(input);
  expect(options.headers["X-Demo-Actor"]).toBe("manager-single");
});

it("bağlantı hatasında menü kaydını başarılı veya örnek veri olarak göstermez", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await expect(new HttpMenuProvider("http://local").load(scope)).rejects.toMatchObject({ code: "LOAD_FAILED" });
});
