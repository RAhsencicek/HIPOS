import { describe, expect, it } from "vitest";
import { scenarios } from "../../data/catalog";
import { MockFeatureProvider } from "./MockFeatureProvider";

const multi = scenarios.find((scenario) => scenario.id === "multi")!;
const branch = (id: string) => ({
  firmId: multi.firmId,
  branchId: multi.branches.find((item) => item.id === id)!.apiId,
});
const moda = branch("moda");
const atasehir = branch("atasehir");
const state = async (
  provider: MockFeatureProvider,
  scope: typeof moda,
  key: string,
) => (await provider.listBranchStates(scope)).find((item) => item.key === key)!;

describe("MockFeatureProvider", () => {
  it("tanım ve şube durumunu ayırır; bütün yaşam döngülerini örnekler", async () => {
    const provider = new MockFeatureProvider("normal", 0);
    const definitions = await provider.listDefinitions();
    expect(definitions[0]).toHaveProperty("dependencies");
    expect(definitions[0]).not.toHaveProperty("desiredEnabled");
    expect((await state(provider, moda, "catalog.products")).lifecycle).toBe(
      "ready",
    );
    expect((await state(provider, moda, "customers.loyalty")).lifecycle).toBe(
      "disabled",
    );
    expect((await state(provider, moda, "inventory.items")).lifecycle).toBe(
      "setup_required",
    );
    expect(
      (await state(provider, moda, "integrations.delivery")).lifecycle,
    ).toBe("provider_pending");
    expect(
      (await state(provider, atasehir, "kitchen.monitoring")).lifecycle,
    ).toBe("draining");
    expect(
      (await state(provider, moda, "catalog.products")).effectiveForNewWork,
    ).toBe(false);
  });

  it("açma tercihini yalnız hedef şubede ve sürüm artışıyla değiştirir", async () => {
    const provider = new MockFeatureProvider("normal", 0);
    const before = await state(provider, moda, "customers.loyalty");
    const otherBefore = await state(provider, atasehir, "customers.loyalty");
    const next = await provider.setDesiredEnabled({
      ...moda,
      key: before.key,
      desiredEnabled: true,
      expectedVersion: before.version,
    });
    expect(next).toMatchObject({
      desiredEnabled: true,
      lifecycle: "ready",
      version: before.version + 1,
      effectiveForNewWork: false,
    });
    expect(await state(provider, atasehir, before.key)).toEqual(otherBefore);
    await expect(
      provider.setDesiredEnabled({
        ...moda,
        key: before.key,
        desiredEnabled: false,
        expectedVersion: before.version,
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  });

  it("bağımlılık, bağlı özellik ve devam eden iş kurallarını uygular", async () => {
    const provider = new MockFeatureProvider("normal", 0);
    const dependent = await state(provider, moda, "inventory.recipes");
    await expect(
      provider.setDesiredEnabled({
        ...moda,
        key: dependent.key,
        desiredEnabled: true,
        expectedVersion: dependent.version,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENCY_NOT_READY" });
    const products = await state(provider, moda, "catalog.products");
    await expect(
      provider.setDesiredEnabled({
        ...moda,
        key: products.key,
        desiredEnabled: false,
        expectedVersion: products.version,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENT_ACTIVE" });
    const kitchen = await state(provider, moda, "kitchen.monitoring");
    const draining = await provider.setDesiredEnabled({
      ...moda,
      key: kitchen.key,
      desiredEnabled: false,
      expectedVersion: kitchen.version,
    });
    expect(draining).toMatchObject({
      lifecycle: "draining",
      desiredEnabled: false,
      inFlightWorkCount: 2,
    });
    await expect(
      provider.setDesiredEnabled({
        ...moda,
        key: kitchen.key,
        desiredEnabled: true,
        expectedVersion: draining.version,
      }),
    ).rejects.toMatchObject({ code: "FEATURE_DRAINING" });
  });

  it("firma/şube çapraz erişimini ve yetkisiz görünümü reddeder", async () => {
    const provider = new MockFeatureProvider("normal", 0);
    const wrong = { firmId: scenarios[0].firmId, branchId: moda.branchId };
    await expect(provider.listBranchStates(wrong)).rejects.toMatchObject({
      code: "UNAUTHORIZED_SCOPE",
      status: 403,
    });
    await expect(
      new MockFeatureProvider("unauthorized", 0).listBranchStates(moda),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_SCOPE", status: 403 });
  });

  it("dönen durum kopyaları sağlayıcının verisini değiştirmez", async () => {
    const provider = new MockFeatureProvider("normal", 0);
    const original = await state(provider, moda, "integrations.delivery");
    original.blockers[0].message = "değiştirildi";
    original.version = 999;
    const fresh = await state(provider, moda, "integrations.delivery");
    expect(fresh.version).toBe(1);
    expect(fresh.blockers[0].message).not.toBe("değiştirildi");
  });
});
