import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const project = fileURLToPath(
  new URL("../Hipos.Api/Hipos.Api.csproj", import.meta.url),
);
const sharedCatalog = JSON.parse(
  await readFile(new URL("../../../contracts/feature-catalog.v1.json", import.meta.url), "utf8"),
);
const multi = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const single = "11111111-1111-4111-8111-111111111111";
const moda = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const besiktas = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const path = (firm, branch) =>
  `/api/v1/firms/${firm}/branches/${branch}/features`;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  "ASP.NET modül sözleşmesi ve sunucu kuralları",
  { timeout: 30000 },
  async () => {
    const base = `http://127.0.0.1:${await freePort()}`;
    const child = spawn(
      "dotnet",
      [
        "run",
        "--project",
        project,
        "--no-launch-profile",
        "--no-restore",
        "--urls",
        base,
      ],
      {
        env: { ...process.env, ASPNETCORE_ENVIRONMENT: "Development" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const request = async (route, actor, method = "GET", body) => {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          ...(actor ? { "X-Demo-Actor": actor } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        data: await response.json(),
        contentType: response.headers.get("content-type"),
        catalogVersion: response.headers.get("x-feature-catalog-version"),
      };
    };

    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) break;
        try {
          if ((await request("/health")).status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Sunucu derlenirken bağlantı henüz açılmamıştır. */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, `Sunucu başlatılamadı: ${output}`);

      const definitionsRoute = "/api/v1/features/definitions";
      const preflight = await fetch(`${base}${definitionsRoute}`, {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "x-demo-actor",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        "http://localhost:5173",
      );
      const unauthenticated = await request(definitionsRoute);
      assert.equal(unauthenticated.status, 401);
      assert.match(unauthenticated.contentType, /application\/problem\+json/);
      const definitions = await request(definitionsRoute, "manager-multi");
      assert.equal(definitions.status, 200);
      assert.equal(definitions.catalogVersion, String(sharedCatalog.catalogVersion));
      assert.deepEqual(definitions.data, sharedCatalog.definitions);
      assert.ok(!("desiredEnabled" in definitions.data[0]));

      const catalogRoute = `/api/v1/firms/${multi}/catalog/products?branchId=${moda}`;
      assert.equal((await request(catalogRoute)).status, 401);
      assert.equal((await request(catalogRoute, "manager-single")).status, 403);
      const unavailableCatalog = await request(catalogRoute, "manager-multi");
      assert.equal(unavailableCatalog.status, 503);
      assert.equal(unavailableCatalog.data.code, "CATALOG_STORAGE_UNAVAILABLE");
      const categoriesRoute = `/api/v1/firms/${multi}/catalog/categories?branchId=${moda}`;
      assert.equal((await request(categoriesRoute)).status, 401);
      assert.equal((await request(categoriesRoute, "manager-single")).status, 403);
      assert.equal((await request(categoriesRoute, "manager-multi")).data.code, "CATALOG_STORAGE_UNAVAILABLE");

      assert.equal(
        (await request(path(single, moda), "manager-multi")).status,
        403,
      );
      assert.equal(
        (await request(path(multi, besiktas), "manager-moda")).status,
        403,
      );
      assert.equal(
        (await request(path(multi, moda), "viewer-multi")).status,
        200,
      );
      assert.equal(
        (
          await request(
            `${path(multi, moda)}/customers.loyalty`,
            "viewer-multi",
            "PUT",
            {
              desiredEnabled: true,
              expectedVersion: 1,
            },
          )
        ).status,
        403,
      );

      const states = (await request(path(multi, moda), "manager-multi")).data;
      const get = (key) => states.find((state) => state.key === key);
      assert.equal(states.length, sharedCatalog.definitions.length);
      assert.equal(get("inventory.items").lifecycle, "setup_required");
      assert.equal(get("integrations.delivery").lifecycle, "provider_pending");
      assert.equal(get("catalog.products").effectiveForNewWork, false);
      assert.equal(
        (
          await request(
            `${path(multi, moda)}/catalog.products/new-work-policy`,
            "manager-multi",
          )
        ).data.allowed,
        false,
      );

      const loyaltyRoute = `${path(multi, moda)}/customers.loyalty`;
      const concurrent = await Promise.all([
        request(loyaltyRoute, "manager-multi", "PUT", {
          desiredEnabled: true,
          expectedVersion: 1,
        }),
        request(loyaltyRoute, "manager-multi", "PUT", {
          desiredEnabled: true,
          expectedVersion: 1,
        }),
      ]);
      assert.deepEqual(
        concurrent.map((result) => result.status).sort(),
        [200, 409],
      );
      assert.equal(
        concurrent.find((result) => result.status === 200).data.version,
        2,
      );
      assert.equal(
        concurrent.find((result) => result.status === 409).data.code,
        "VERSION_CONFLICT",
      );
      assert.equal(
        (await request(path(multi, besiktas), "manager-multi")).data.find(
          (state) => state.key === "customers.loyalty",
        ).desiredEnabled,
        false,
      );
      assert.equal(
        (
          await request(loyaltyRoute, "manager-multi", "PUT", {
            desiredEnabled: true,
            expectedVersion: 2,
          })
        ).data.version,
        2,
      );

      assert.equal(
        (
          await request(
            `${path(multi, moda)}/inventory.recipes`,
            "manager-multi",
            "PUT",
            {
              desiredEnabled: true,
              expectedVersion: 1,
            },
          )
        ).data.code,
        "DEPENDENCY_NOT_READY",
      );
      assert.equal(
        (
          await request(
            `${path(multi, moda)}/catalog.products`,
            "manager-multi",
            "PUT",
            {
              desiredEnabled: false,
              expectedVersion: 1,
            },
          )
        ).data.code,
        "DEPENDENT_ACTIVE",
      );
      const kitchenRoute = `${path(multi, moda)}/kitchen.monitoring`;
      const draining = await request(kitchenRoute, "manager-multi", "PUT", {
        desiredEnabled: false,
        expectedVersion: 1,
      });
      assert.equal(draining.status, 200);
      assert.equal(draining.data.lifecycle, "draining");
      assert.equal(draining.data.inFlightWorkCount, 2);
      assert.equal(
        (await request(`${kitchenRoute}/new-work-policy`, "manager-multi")).data
          .allowed,
        false,
      );
      assert.equal(
        (
          await request(kitchenRoute, "manager-multi", "PUT", {
            desiredEnabled: true,
            expectedVersion: 2,
          })
        ).data.code,
        "FEATURE_DRAINING",
      );
      const completionRoute = `/_prototype/firms/${multi}/branches/${moda}/features/kitchen.monitoring/complete-one-work`;
      const firstCompleted = await request(
        completionRoute,
        "manager-multi",
        "POST",
      );
      assert.equal(firstCompleted.data.lifecycle, "draining");
      assert.equal(firstCompleted.data.inFlightWorkCount, 1);
      const secondCompleted = await request(
        completionRoute,
        "manager-multi",
        "POST",
      );
      assert.equal(secondCompleted.data.lifecycle, "disabled");
      assert.equal(secondCompleted.data.inFlightWorkCount, 0);
      assert.equal(secondCompleted.data.version, 4);
      assert.equal(
        (await request(completionRoute, "manager-multi", "POST")).data.code,
        "NO_IN_FLIGHT_WORK",
      );

      const audit = (
        await request(`${path(multi, moda)}/audit`, "manager-multi")
      ).data;
      assert.equal(audit.length, 2);
      assert.deepEqual(
        audit.map((event) => event.featureKey),
        ["customers.loyalty", "kitchen.monitoring"],
      );
      assert.equal(
        (await request(`${path(multi, besiktas)}/audit`, "manager-multi")).data
          .length,
        0,
      );

      // Masa bağımlılığı özel olarak otomatik kapanır; adisyon izleme bağımsız kalır.
      const singleStates = `${path(single, "33333333-3333-4333-8333-333333333333")}`;
      assert.equal((await request(`${singleStates}/service.waiters`, "manager-single", "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(`${singleStates}/branches.tables`, "manager-single", "PUT", {
        desiredEnabled: false, expectedVersion: 1,
      })).status, 200);
      const afterTablesOff = (await request(singleStates, "manager-single")).data;
      assert.equal(afterTablesOff.find((state) => state.key === "branches.tables").desiredEnabled, false);
      assert.equal(afterTablesOff.find((state) => state.key === "service.waiters").desiredEnabled, false);
      assert.equal(afterTablesOff.find((state) => state.key === "sales.monitoring").desiredEnabled, true);
    } finally {
      child.kill("SIGTERM");
    }
  },
);
