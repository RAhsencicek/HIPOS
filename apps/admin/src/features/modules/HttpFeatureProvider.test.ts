import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpFeatureProvider } from "./HttpFeatureProvider";

const scope = {
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  branchId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
};

afterEach(() => vi.unstubAllGlobals());

describe("HttpFeatureProvider", () => {
  it("şube kapsamı ve beklenen sürümü API komutuna taşır", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          key: "customers.loyalty",
          ...scope,
          desiredEnabled: true,
          effectiveForNewWork: false,
          lifecycle: "ready",
          blockers: [],
          inFlightWorkCount: 0,
          version: 2,
          updatedAt: "2026-10-05T09:30:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new HttpFeatureProvider(
      "http://127.0.0.1:5180",
    ).setDesiredEnabled({
      ...scope,
      key: "customers.loyalty",
      desiredEnabled: true,
      expectedVersion: 1,
    });
    expect(result.version).toBe(2);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://127.0.0.1:5180/api/v1/firms/${scope.firmId}/branches/${scope.branchId}/features/customers.loyalty`,
    );
    expect(options.headers["X-Demo-Actor"]).toBe("manager-multi");
    expect(JSON.parse(options.body)).toEqual({
      desiredEnabled: true,
      expectedVersion: 1,
    });
  });

  it("sunucunun sürüm çakışmasını genel ağ hatasına dönüştürmez", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "VERSION_CONFLICT",
            detail: "Güncel durumu yeniden yükleyin.",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );
    await expect(
      new HttpFeatureProvider().setDesiredEnabled({
        ...scope,
        key: "customers.loyalty",
        desiredEnabled: true,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("sunucuya ulaşılamadığını açık hata olarak verir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("connection refused")),
    );
    await expect(
      new HttpFeatureProvider().listBranchStates(scope),
    ).rejects.toMatchObject({ code: "LOAD_FAILED", status: 503 });
  });
});
