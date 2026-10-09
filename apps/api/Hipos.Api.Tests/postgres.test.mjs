import assert from "node:assert/strict";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { verifyMenuApi, verifyMenuPanel } from "./menu.acceptance.mjs";

const sharedCatalog = JSON.parse(await readFile(new URL("../../../contracts/feature-catalog.v1.json", import.meta.url), "utf8"));

const execFile = promisify(execFileCallback);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const project = fileURLToPath(
  new URL("../Hipos.Api/Hipos.Api.csproj", import.meta.url),
);
const pgBin = "/opt/homebrew/opt/postgresql@18/bin";
const firm = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const moda = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const besiktas = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const single = "11111111-1111-4111-8111-111111111111";
const singleBranch = "33333333-3333-4333-8333-333333333333";
const pizzaId = "66666666-6666-4666-8666-666666666601";
const cakeId = "66666666-6666-4666-8666-666666666606";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(base, child, output) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      /* Sunucu henüz açılmadı. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PostgreSQL API başlatılamadı: ${output()}`);
}

async function waitForUi(base, child, output) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${base}/admin/catalog/products`)).ok) return;
    } catch { /* Vite henüz açılmadı. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Panel başlatılamadı: ${output()}`);
}

test(
  "PostgreSQL modül tercihini yeniden başlatma ve eşzamanlı istekte korur",
  { timeout: 90000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hipos-postgres-test-"));
    const data = join(temporary, "data");
    const log = join(temporary, "postgres.log");
    const pgPort = await freePort();
    const apiPort = await freePort();
    const uiPort = await freePort();
    const base = `http://127.0.0.1:${apiPort}`;
    const uiBase = `http://127.0.0.1:${uiPort}`;
    const connection = `Host=127.0.0.1;Port=${pgPort};Database=hipos_features;Username=${process.env.USER};Pooling=false`;
    const env = {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: "Development",
      HIPOS_FEATURE_STORAGE: "postgres",
      HIPOS_FEATURES_CONNECTION: connection,
    };
    let postgresStarted = false;
    let api;
    let ui;
    let browser;
    let apiOutput = "";
    let uiOutput = "";
    const runPg = (command, args) => execFile(join(pgBin, command), args);
    const startApi = async () => {
      apiOutput = "";
      api = spawn(
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
          cwd: repo,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      api.stdout.on("data", (chunk) => {
        apiOutput += chunk;
      });
      api.stderr.on("data", (chunk) => {
        apiOutput += chunk;
      });
      await waitForHealth(base, api, () => apiOutput);
    };
    const stopApi = async () => {
      if (!api || api.exitCode !== null) return;
      const child = api;
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    };
    const request = async (route, method = "GET", body, actor = "manager-multi") => {
      const response = await fetch(`${base}${route}`, {
        method,
        headers: {
          "X-Demo-Actor": actor,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error(`JSON olmayan API yanıtı (${response.status}): ${raw.slice(0, 1200)}`); }
      return { status: response.status, data };
    };
    const featurePath = (branch, key) =>
      `/api/v1/firms/${firm}/branches/${branch}/features${key ? `/${key}` : ""}`;

    try {
      await runPg("initdb", [
        "-D",
        data,
        "-A",
        "trust",
        "--encoding",
        "UTF8",
        "--no-instructions",
      ]);
      await runPg("pg_ctl", [
        "-D",
        data,
        "-l",
        log,
        "-o",
        `-h 127.0.0.1 -p ${pgPort} -k /tmp`,
        "start",
      ]);
      postgresStarted = true;
      await runPg("createdb", [
        "-h",
        "127.0.0.1",
        "-p",
        String(pgPort),
        "-U",
        process.env.USER,
        "hipos_features",
      ]);
      await execFile(
        "dotnet",
        [
          "tool",
          "run",
          "dotnet-ef",
          "database",
          "update",
          "--project",
          project,
          "--context",
          "FeatureDbContext",
        ],
        {
          cwd: repo,
          env,
        },
      );
      await startApi();
      const catalogPath = (firmId, branchId) =>
        `/api/v1/firms/${firmId}/catalog/products${branchId ? `?branchId=${branchId}` : ""}`;
      const categoryPath = (firmId, branchId) =>
        `/api/v1/firms/${firmId}/catalog/categories${branchId ? `?branchId=${branchId}` : ""}`;
      assert.equal((await request(catalogPath(firm, moda))).data.code, "CATALOG_STORAGE_UNAVAILABLE");
      assert.equal((await request(categoryPath(firm, moda))).data.code, "CATALOG_STORAGE_UNAVAILABLE");
      const cariPath = (firmId, branchId) => `/api/v1/firms/${firmId}/branches/${branchId}/caris`;
      assert.equal((await request(cariPath(single, singleBranch), "GET", undefined, "manager-single")).data.code,
        "CARI_STORAGE_UNAVAILABLE");
      const servicePath = (firmId, branchId) => `/api/v1/firms/${firmId}/branches/${branchId}/service`;
      assert.equal((await request(`${servicePath(single, singleBranch)}/tables`, "GET", undefined, "manager-single")).data.code,
        "SERVICE_STORAGE_UNAVAILABLE");
      const inventoryPath = (firmId, branchId) => `/api/v1/firms/${firmId}/branches/${branchId}/inventory`;
      assert.equal((await request(`${inventoryPath(single, singleBranch)}/ingredients`, "GET", undefined, "manager-single")).data.code,
        "INVENTORY_STORAGE_UNAVAILABLE");
      assert.equal((await request(`/api/v1/firms/${firm}/sales/orders?branchId=${moda}`)).data.code,
        "SALES_STORAGE_UNAVAILABLE");
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).data.code, "PAYMENT_STORAGE_UNAVAILABLE");
      assert.equal(
        (await request(featurePath(moda, "catalog.drafts"), "PUT", {
          desiredEnabled: true, expectedVersion: 1,
        })).data.code,
        "CATALOG_STORAGE_UNAVAILABLE",
      );
      await stopApi();
      // Eski katalog şemasıyla ürün varken yeni kategori migration'ı adları taşımalı.
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "20261006123226_AddCatalogDrafts",
          "--project", project, "--context", "CatalogDbContext"],
        { cwd: repo, env },
      );
      const legacyFirm = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
      await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        `INSERT INTO catalog.products
          (id,firm_id,brand_id,name,sku,category_id,category_name,status,channels,image,recipe_linked,base_price_minor,currency,description,allergens,option_groups,branch_ids,updated_at,version)
         VALUES
          ('99999999-9999-4999-8999-999999999901','${legacyFirm}',NULL,'Eski Ürün','LEG-001','legacy','Eski Kategori','draft',ARRAY[]::text[],'',false,0,'TRY','',ARRAY[]::text[],ARRAY[]::text[],ARRAY['ffffffff-ffff-4fff-8fff-ffffffffffff'],'2026-10-05T09:30:00Z',1),
          ('99999999-9999-4999-8999-999999999902','${legacyFirm}',NULL,'Çelişkili Ürün','LEG-002','legacy','Başka Kategori Adı','draft',ARRAY[]::text[],'',false,0,'TRY','',ARRAY[]::text[],ARRAY[]::text[],ARRAY['ffffffff-ffff-4fff-8fff-ffffffffffff'],'2026-10-05T09:30:00Z',1);`,
      ]);
      await assert.rejects(execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "CatalogDbContext"],
        { cwd: repo, env },
      ));
      const failedMigration = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c", "SELECT to_regclass('catalog.categories')",
      ]);
      assert.equal(failedMigration.stdout.trim(), "");
      await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        "UPDATE catalog.products SET category_name = 'Eski Kategori' WHERE id = '99999999-9999-4999-8999-999999999902'",
      ]);
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "CatalogDbContext"],
        { cwd: repo, env },
      );
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "SalesDbContext"],
        { cwd: repo, env },
      );
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "CariDbContext"],
        { cwd: repo, env },
      );
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "ServiceDbContext"],
        { cwd: repo, env },
      );
      await execFile("dotnet", ["tool", "run", "dotnet-ef", "database", "update", "20261008113750_InitService",
        "--project", project, "--context", "ServiceDbContext"], { cwd: repo, env });
      await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        `INSERT INTO service.waiters (id,firm_id,branch_id,name,is_active,updated_at)
         VALUES ('legacy-waiter-preserved','${single}','${singleBranch}','Önceki Garson',true,'2026-10-08T09:00:00Z');`]);
      await execFile("dotnet", ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "ServiceDbContext"], { cwd: repo, env });
      await execFile(
        "dotnet",
        ["tool", "run", "dotnet-ef", "database", "update", "--project", project, "--context", "InventoryDbContext"],
        { cwd: repo, env },
      );
      const migratedCategory = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT name FROM catalog.categories WHERE firm_id = '${legacyFirm}' AND id = 'legacy'`,
      ]);
      assert.equal(migratedCategory.stdout.trim(), "Eski Kategori");
      await startApi();
      assert.equal((await request(`${servicePath(single, singleBranch)}/tables`, "GET", undefined, "manager-single")).data.tablesEnabled, true);
      const preservedEmployee = (await request(`${servicePath(single, singleBranch)}/employees`, "GET", undefined, "manager-single")).data.items
        .find((row) => row.id === "legacy-waiter-preserved");
      assert.equal(preservedEmployee.name, "Önceki Garson");
      assert.equal(preservedEmployee.department, "service");
      assert.equal(preservedEmployee.jobTitle, "Garson");
      assert.deepEqual((await request(cariPath(single, singleBranch), "GET", undefined, "manager-single")).data.items, []);
      assert.equal((await request(cariPath(single, singleBranch))).status, 403);
      const newCari = await request(cariPath(single, singleBranch), "POST", {
        name: "Test Karma Cari", types: ["customer", "supplier"],
      }, "manager-single");
      assert.equal(newCari.status, 201);
      assert.equal(newCari.data.customerBalanceMinor, 0);
      const cariId = newCari.data.id;
      const movementPath = `${cariPath(single, singleBranch)}/${cariId}/movements`;
      const firstCariMovement = { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11", kind: "customer",
        deltaMinor: 30000, description: "Test alacak", expectedVersion: 1 };
      assert.equal((await request(movementPath, "POST", firstCariMovement, "pos-single")).status, 403);
      assert.equal((await request(movementPath, "POST", firstCariMovement, "manager-single")).status, 201);
      assert.equal((await request(movementPath, "POST", firstCariMovement, "manager-single")).status, 200);
      assert.equal((await request(movementPath, "POST", { ...firstCariMovement, deltaMinor: 20000 }, "manager-single")).data.code,
        "MOVEMENT_ID_CONFLICT");
      assert.equal((await request(movementPath, "POST", { ...firstCariMovement, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12" }, "manager-single")).data.code,
        "VERSION_CONFLICT");
      assert.equal((await request(movementPath, "POST", { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13",
        kind: "supplier", deltaMinor: 50000, description: "Test borç", expectedVersion: 2 }, "manager-single")).status, 201);
      const cariAfter = await request(`${cariPath(single, singleBranch)}/${cariId}`, "GET", undefined, "manager-single");
      assert.equal(cariAfter.data.customerBalanceMinor, 30000);
      assert.equal(cariAfter.data.supplierBalanceMinor, 50000);
      assert.equal(cariAfter.data.version, 3);
      const businessDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul",
        year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const tomorrow = new Date(Date.parse(`${businessDay}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const statementPath = `${cariPath(single, singleBranch)}/${cariId}/statement`;
      const sameDay = await request(`${statementPath}?from=${businessDay}&to=${businessDay}`, "GET", undefined, "manager-single");
      assert.equal(sameDay.status, 200);
      assert.equal(sameDay.data.timeZone, "Europe/Istanbul");
      assert.equal(sameDay.data.openingCustomerBalanceMinor, 0);
      assert.equal(sameDay.data.periodCustomerDeltaMinor, 30000);
      assert.equal(sameDay.data.closingSupplierBalanceMinor, 50000);
      assert.equal(sameDay.data.movements.length, 2);
      const nextDay = await request(`${statementPath}?from=${tomorrow}&to=${tomorrow}`, "GET", undefined, "manager-single");
      assert.equal(nextDay.data.openingCustomerBalanceMinor, 30000);
      assert.equal(nextDay.data.periodCustomerDeltaMinor, 0);
      assert.equal(nextDay.data.closingSupplierBalanceMinor, 50000);
      assert.equal(nextDay.data.movements.length, 0);
      assert.equal((await request(`${statementPath}?from=${tomorrow}&to=${businessDay}`, "GET", undefined, "manager-single")).data.code,
        "INVALID_STATEMENT_RANGE");
      assert.equal((await request(`${statementPath}?from=${businessDay}&to=${businessDay}`)).status, 403);
      assert.equal((await request(`${cariPath(firm, moda)}/${cariId}`)).status, 404);
      assert.equal((await request(`${cariPath(single, singleBranch)}/${cariId}`, "PUT", {
        name: "Test Karma Cari", types: ["supplier"], isActive: true, expectedVersion: 3,
      }, "manager-single")).data.code, "CARI_TYPE_IN_USE");
      const inactiveCari = await request(`${cariPath(single, singleBranch)}/${cariId}`, "PUT", {
        name: "Test Karma Cari Güncel", types: ["customer", "supplier"], isActive: false, expectedVersion: 3,
      }, "manager-single");
      assert.equal(inactiveCari.status, 200);
      assert.equal(inactiveCari.data.isActive, false);
      assert.equal((await request(movementPath, "POST", { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14",
        kind: "customer", deltaMinor: 1000, description: "Pasif kart testi", expectedVersion: 4 }, "manager-single")).data.code,
        "CARI_TYPE_UNAVAILABLE");
      assert.deepEqual((await request(catalogPath(firm, moda))).data.items, []);
      await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        `INSERT INTO catalog.categories (firm_id,id,brand_id,name,is_active,sort_order,version,updated_at)
         VALUES ('${firm}','pizza',NULL,'Pizzalar',true,0,1,'2026-10-05T09:30:00Z'),
                ('${firm}','dessert',NULL,'Tatlılar',true,0,1,'2026-10-05T09:30:00Z'),
                ('${single}','pizza',NULL,'Pizzalar',true,0,1,'2026-10-05T09:30:00Z');
         INSERT INTO catalog.products
          (id,firm_id,brand_id,name,sku,category_id,category_name,status,channels,image,recipe_linked,base_price_minor,currency,description,allergens,option_groups,branch_ids,updated_at,version)
         VALUES
          ('${pizzaId}','${firm}',NULL,'Margherita Pizza','PZZ-001','pizza','Pizzalar','published',ARRAY['pos','qr'],'🍕',true,32000,'TRY','Pizza',ARRAY['Gluten'],ARRAY['Boyut'],ARRAY['${moda}','${besiktas}'],'2026-10-05T09:30:00Z',1),
          ('${cakeId}','${firm}',NULL,'Cheesecake','TTL-012','dessert','Tatlılar','draft',ARRAY['pos'],'🍰',false,22000,'TRY','Tatlı',ARRAY['Süt'],ARRAY[]::text[],ARRAY['${moda}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555501','${single}',NULL,'Tek Şube Pizza','PZZ-001','pizza','Pizzalar','published',ARRAY['pos'],'🍕',false,30000,'TRY','Tek firma ürünü',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555502','${single}',NULL,'Tavuklu Sandviç','SND-001','sandwich','Sandviçler','published',ARRAY['pos'],'🥪',false,26000,'TRY','Demo ürün',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555503','${single}',NULL,'San Sebastian Cheesecake','TTL-012','dessert','Tatlılar','published',ARRAY['pos'],'🍰',false,22000,'TRY','Demo ürün',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555504','${single}',NULL,'Filtre Kahve','ICK-010','drinks','İçecekler','published',ARRAY['pos'],'☕',false,12000,'TRY','Demo ürün',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555505','${single}',NULL,'Ev Yapımı Limonata','ICK-008','drinks','İçecekler','published',ARRAY['pos'],'🍋',false,12500,'TRY','Demo ürün',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1),
          ('55555555-5555-4555-8555-555555555506','${single}',NULL,'Karışık Pizza','PZZ-002','pizza','Pizzalar','published',ARRAY['pos'],'🍕',false,41000,'TRY','Demo ürün',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1);
         INSERT INTO catalog.branch_prices (product_id,branch_id,amount_minor)
         VALUES ('${pizzaId}','${besiktas}',34000);`,
      ]);

      await execFile(process.execPath, [join(repo, "scripts/seed-demo.mjs"), "--inventory"], {
        cwd: repo,
        env: { ...env, HIPOS_DEMO_DATABASE_URL: `postgresql://${process.env.USER}@127.0.0.1:${pgPort}/hipos_features` },
      });
      await execFile(process.execPath, [join(repo, "scripts/seed-demo.mjs"), "--inventory"], {
        cwd: repo,
        env: { ...env, HIPOS_DEMO_DATABASE_URL: `postgresql://${process.env.USER}@127.0.0.1:${pgPort}/hipos_features` },
      });
      const seedCounts = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        "SELECT (SELECT count(*) FROM inventory.ingredients)||','||(SELECT count(*) FROM inventory.recipes)||','||(SELECT count(*) FROM inventory.movements)||','||(SELECT count(*) FROM inventory.counts)"]);
      assert.equal(seedCounts.stdout.trim(), "21,4,39,1");

      const singleInventory = inventoryPath(single, singleBranch);
      const seededIngredients = (await request(`${singleInventory}/ingredients`, "GET", undefined, "manager-single")).data.items;
      assert.equal(seededIngredients.length, 21);
      assert.equal(seededIngredients.find((row) => row.id === "mozzarella").onHand, 800);
      assert.equal(seededIngredients.find((row) => row.id === "mozzarella").warehouseId, "warehouse-kadikoy-main");
      const critical = await request(`${singleInventory}/critical-stock?warehouseId=warehouse-kadikoy-main`, "GET", undefined, "manager-single");
      assert.equal(critical.status, 200);
      assert.equal(critical.data.source, "postgres");
      assert.equal(critical.data.items.find((row) => row.id === "mozzarella").belowThresholdBy, 200);
      assert.equal(critical.data.items.length, 8);
      assert.equal(critical.data.items.find((row) => row.id === "cream").belowThresholdBy, 1000);
      assert.equal((await request(`${singleInventory}/warehouses`, "GET", undefined, "manager-single")).data.items[0].name, "Kadıköy Ana Depo");
      const estimates = await request(`${singleInventory}/production-estimates?warehouseId=warehouse-kadikoy-main`, "GET", undefined, "manager-single");
      const initialPizzaEstimate = estimates.data.items.find((item) => item.productId === "55555555-5555-4555-8555-555555555501");
      assert.equal(initialPizzaEstimate.status, "ready");
      assert.equal(initialPizzaEstimate.theoreticalPortions, 6);
      assert.equal(initialPizzaEstimate.limitingIngredientName, "Mozzarella");
      await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER, "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        "UPDATE inventory.recipe_lines SET unit='ml' WHERE recipe_id='recipe-margherita' AND ingredient_id='flour'"]);
      const mismatchedEstimate = await request(`${singleInventory}/production-estimates?warehouseId=warehouse-kadikoy-main`, "GET", undefined, "manager-single");
      const invalidPizzaEstimate = mismatchedEstimate.data.items.find((item) => item.productId === "55555555-5555-4555-8555-555555555501");
      assert.equal(invalidPizzaEstimate.status, "unit_mismatch");
      assert.equal(invalidPizzaEstimate.theoreticalPortions ?? null, null);
      assert.equal(invalidPizzaEstimate.lines.find((line) => line.ingredientId === "flour").possiblePortions ?? null, null);
      await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER, "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        "UPDATE inventory.recipe_lines SET unit='g' WHERE recipe_id='recipe-margherita' AND ingredient_id='flour'"]);
      const seededRecipes = (await request(`${singleInventory}/recipes`, "GET", undefined, "manager-single")).data.items;
      assert.equal(seededRecipes.length, 4);
      const pizzaProductId = "55555555-5555-4555-8555-555555555501";
      const pizzaRecipePath = `${singleInventory}/recipes/${pizzaProductId}`;
      const pizzaRecipe = await request(pizzaRecipePath, "GET", undefined, "manager-single");
      assert.equal(pizzaRecipe.status, 200);
      assert.deepEqual(pizzaRecipe.data.lines.map((line) => [line.ingredientName, line.quantity, line.unit]), [
        ["Un", 250, "g"], ["Mozzarella", 120, "g"], ["Domates sosu", 80, "g"],
      ]);
      assert.equal((await request(`${inventoryPath(firm, moda)}/ingredients`, "GET", undefined, "manager-single")).status, 403);
      const inventoryFeaturePath = (key) => `/api/v1/firms/${single}/branches/${singleBranch}/features/${key}`;
      const inventoryItemsEnabled = await request(inventoryFeaturePath("inventory.items"), "PUT", { desiredEnabled: true, expectedVersion: 1 }, "manager-single");
      assert.equal(inventoryItemsEnabled.status, 200);
      assert.equal(inventoryItemsEnabled.data.effectiveForNewWork, true);
      const inventoryRecipesEnabled = await request(inventoryFeaturePath("inventory.recipes"), "PUT", { desiredEnabled: true, expectedVersion: 1 }, "manager-single");
      assert.equal(inventoryRecipesEnabled.data.effectiveForNewWork, true);
      const inventoryCountsEnabled = await request(inventoryFeaturePath("inventory.counts"), "PUT", { desiredEnabled: true, expectedVersion: 1 }, "manager-single");
      assert.equal(inventoryCountsEnabled.data.effectiveForNewWork, true);

      const recipeBody = { requestId: "44444444-4444-4444-8444-444444444405", expectedVersion: 1, portion: "1 büyük pizza",
        lines: [{ ingredientId: "flour", quantity: 260 }, { ingredientId: "tomato-sauce", quantity: 80 }, { ingredientId: "mozzarella", quantity: 120 }] };
      const savedRecipe = await request(pizzaRecipePath, "PUT", recipeBody, "manager-single");
      assert.equal(savedRecipe.status, 201);
      assert.equal(savedRecipe.data.version, 2);
      const savedRecipeReplay = await request(pizzaRecipePath, "PUT", recipeBody, "manager-single");
      assert.equal(savedRecipeReplay.status, 200, JSON.stringify(savedRecipeReplay.data));
      assert.equal((await request(pizzaRecipePath, "GET", undefined, "manager-single")).data.version, 2);

      const countListPath = `${singleInventory}/counts`;
      const demoCount = (await request(countListPath, "GET", undefined, "manager-single")).data.items
        .find((row) => row.id === "count-mozzarella-demo");
      assert.equal(demoCount.status, "draft");
      assert.equal(demoCount.lines.length, 21);
      assert.equal(demoCount.lines.find((line) => line.ingredientId === "mozzarella").systemQuantity, 800);
      assert.equal(demoCount.lines.find((line) => line.ingredientId === "mozzarella").physicalQuantity, 700);
      const approval = { requestId: "44444444-4444-4444-8444-444444444406", expectedVersion: demoCount.version };
      const approvedCount = await request(`${countListPath}/${demoCount.id}/approve`, "POST", approval, "manager-single");
      assert.equal(approvedCount.status, 200);
      assert.equal(approvedCount.data.status, "approved");
      assert.equal((await request(`${countListPath}/${demoCount.id}/approve`, "POST", approval, "manager-single")).status, 200);
      assert.equal((await request(`${countListPath}/${demoCount.id}/approve`, "POST", {
        requestId: "44444444-4444-4444-8444-444444444407", expectedVersion: approvedCount.data.version,
      }, "manager-single")).data.code, "COUNT_ALREADY_APPROVED");
      assert.equal((await request(`${singleInventory}/ingredients`, "GET", undefined, "manager-single")).data.items
        .find((row) => row.id === "mozzarella").onHand, 700);
      const adjustmentCount = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT count(*) FROM inventory.movements WHERE count_id='${demoCount.id}' AND ingredient_id='mozzarella' AND delta=-100 AND kind='count_adjustment'`]);
      assert.equal(adjustmentCount.stdout.trim(), "1");

      const newIngredient = { requestId: "44444444-4444-4444-8444-444444444401", name: "Test Malzeme", unit: "g", criticalBelow: 10 };
      const createdIngredient = await request(`${singleInventory}/ingredients`, "POST", newIngredient, "manager-single");
      assert.equal(createdIngredient.status, 201);
      assert.equal((await request(`${singleInventory}/ingredients`, "POST", { ...newIngredient,
        requestId: "44444444-4444-4444-8444-444444444402" }, "manager-single")).data.code, "INGREDIENT_EXISTS");
      const thresholdUpdate = { requestId: "44444444-4444-4444-8444-444444444412", expectedVersion: createdIngredient.data.version,
        unit: "g", criticalBelow: 12 };
      assert.equal((await request(`${singleInventory}/ingredients/${createdIngredient.data.id}`, "PUT", thresholdUpdate, "manager-single")).status, 200);
      assert.equal((await request(`${singleInventory}/ingredients/${createdIngredient.data.id}`, "PUT", { ...thresholdUpdate,
        requestId: "44444444-4444-4444-8444-444444444413", expectedVersion: 2, criticalBelow: -1 }, "manager-single")).data.code,
        "INVALID_INGREDIENT_SETTINGS");
      const inbound = { requestId: "44444444-4444-4444-8444-444444444403", warehouseId: "warehouse-kadikoy-main", ingredientId: createdIngredient.data.id,
        delta: 25, kind: "manual_in", description: "Kabul testi stok girişi" };
      assert.equal((await request(`${singleInventory}/movements`, "POST", inbound, "manager-single")).status, 201);
      assert.equal((await request(`${singleInventory}/movements`, "POST", inbound, "manager-single")).status, 200);
      const movementAudit = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT count(*) FROM inventory.audit WHERE request_id='${inbound.requestId}' AND warehouse_id='warehouse-kadikoy-main' AND action='movement_added'`]);
      assert.equal(movementAudit.stdout.trim(), "1");
      assert.equal((await request(`${singleInventory}/movements`, "POST", { ...inbound, delta: 26 }, "manager-single")).data.code,
        "MOVEMENT_ID_CONFLICT");
      assert.equal((await request(`${singleInventory}/movements`, "POST", { ...inbound,
        requestId: "44444444-4444-4444-8444-444444444404", delta: -26, kind: "manual_out" }, "manager-single")).data.code,
        "NEGATIVE_STOCK");

      const conflictCountCreated = await request(countListPath, "POST", { requestId: "44444444-4444-4444-8444-444444444408" }, "manager-single");
      assert.equal(conflictCountCreated.status, 201);
      let conflictCount = conflictCountCreated.data;
      for (const line of conflictCount.lines) {
        const result = await request(`${countListPath}/${conflictCount.id}/lines/${line.ingredientId}`, "PUT", {
          physicalQuantity: line.systemQuantity, expectedVersion: conflictCount.version,
        }, "manager-single");
        assert.equal(result.status, 200);
        conflictCount = result.data;
      }
      const lockedMovement = await request(`${singleInventory}/movements`, "POST", {
        requestId: "44444444-4444-4444-8444-444444444409", ingredientId: "flour", delta: 1,
        kind: "manual_in", description: "Sayım sonrası kabul hareketi",
      }, "manager-single");
      assert.equal(lockedMovement.status, 409);
      assert.equal(lockedMovement.data.code, "COUNT_IN_PROGRESS");
      await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER, "-d", "hipos_features", "-v", "ON_ERROR_STOP=1", "-c",
        `INSERT INTO inventory.movements(id,firm_id,branch_id,warehouse_id,ingredient_id,delta,unit,kind,description,count_id,created_at,actor)
         VALUES ('44444444-4444-4444-8444-444444444414','${single}','${singleBranch}','warehouse-kadikoy-main','flour',1,'g','manual_in','Out-of-band giriş',NULL,now(),'test'),
                ('44444444-4444-4444-8444-444444444416','${single}','${singleBranch}','warehouse-kadikoy-main','flour',-1,'g','manual_out','Out-of-band ters hareket',NULL,now(),'test')`]);
      assert.equal((await request(`${countListPath}/${conflictCount.id}/approve`, "POST", {
        requestId: "44444444-4444-4444-8444-444444444410", expectedVersion: conflictCount.version,
      }, "manager-single")).data.code, "COUNT_STOCK_CHANGED");
      const conflictAdjustments = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT count(*) FROM inventory.movements WHERE count_id='${conflictCount.id}' AND kind='count_adjustment'`]);
      assert.equal(conflictAdjustments.stdout.trim(), "0");

      const itemsOffWhileCountOpen = await request(inventoryFeaturePath("inventory.items"), "PUT", {
        desiredEnabled: false, expectedVersion: inventoryItemsEnabled.data.version,
      }, "manager-single");
      assert.equal(itemsOffWhileCountOpen.status, 409);
      assert.equal(itemsOffWhileCountOpen.data.code, "INVENTORY_COUNT_OPEN");
      const cancelRequest = { requestId: "44444444-4444-4444-8444-444444444415", expectedVersion: conflictCount.version };
      const cancelled = await request(`${countListPath}/${conflictCount.id}/cancel`, "POST", cancelRequest, "manager-single");
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.data.status, "cancelled");
      assert.equal((await request(`${countListPath}/${conflictCount.id}/cancel`, "POST", cancelRequest, "manager-single")).status, 200);

      const itemsOff = await request(inventoryFeaturePath("inventory.items"), "PUT", {
        desiredEnabled: false, expectedVersion: inventoryItemsEnabled.data.version,
      }, "manager-single");
      assert.equal(itemsOff.status, 200);
      const inventoryStates = (await request(`/api/v1/firms/${single}/branches/${singleBranch}/features`, "GET", undefined, "manager-single")).data;
      assert.equal(inventoryStates.find((row) => row.key === "inventory.recipes").desiredEnabled, false);
      assert.equal(inventoryStates.find((row) => row.key === "inventory.counts").desiredEnabled, false);
      assert.equal((await request(`${singleInventory}/ingredients`, "GET", undefined, "manager-single")).data.items.length, 22);
      assert.equal((await request(`${singleInventory}/movements`, "POST", { ...inbound,
        requestId: "44444444-4444-4444-8444-444444444411" }, "manager-single")).data.code, "FEATURE_DISABLED");

      const modaProducts = await request(catalogPath(firm, moda));
      const modaCategories = await request(categoryPath(firm, moda));
      assert.equal(modaCategories.status, 200);
      assert.deepEqual(modaCategories.data.items.map((item) => [item.id, item.productCount]),
        [["pizza", 1], ["dessert", 1]]);
      assert.deepEqual((await request(categoryPath(firm, besiktas))).data.items.map((item) => [item.id, item.productCount]),
        [["pizza", 1], ["dessert", 0]]);
      assert.equal((await request(categoryPath(firm, moda), "GET", undefined, "manager-single")).status, 403);
      assert.equal((await request(categoryPath(firm), "GET", undefined, "manager-moda")).status, 403);
      assert.equal(modaProducts.status, 200);
      assert.equal(modaProducts.data.pageInfo.totalItems, 2);
      assert.equal(modaProducts.data.scope.branchId, moda);
      const besiktasProducts = await request(catalogPath(firm, besiktas));
      assert.equal(besiktasProducts.data.pageInfo.totalItems, 1);
      assert.deepEqual(besiktasProducts.data.categories.map((category) => category.id), ["pizza", "dessert"]);
      assert.equal(besiktasProducts.data.items[0].price.amountMinor, 34000);
      assert.equal(besiktasProducts.data.items[0].priceSource, "branch_override");
      assert.equal((await request(catalogPath(firm, null))).data.items.length, 2);
      assert.equal(
        (await request(`/api/v1/firms/${firm}/catalog/products?branchId=${moda}&query=pizza&categoryId=pizza&page=1&pageSize=1`)).data.pageInfo.totalItems,
        1,
      );
      assert.equal(
        (await request(`/api/v1/firms/${firm}/catalog/products/${cakeId}?branchId=${besiktas}`)).status,
        404,
      );
      assert.equal(
        (await request(`/api/v1/firms/${firm}/catalog/products/${pizzaId}?branchId=${besiktas}`)).data.price.amountMinor,
        34000,
      );
      assert.equal((await request(catalogPath(single, singleBranch))).status, 403);
      assert.equal(
        (await request(catalogPath(firm, null), "GET", undefined, "manager-moda")).status,
        403,
      );
      assert.equal(
        (await request(catalogPath(single, singleBranch), "GET", undefined, "manager-single")).data.pageInfo.totalItems,
        6,
      );

      const draftId = "77777777-7777-4777-8777-777777777701";
      const draftPath = `/api/v1/firms/${firm}/branches/${moda}/catalog/drafts`;
      const createDraft = {
        draftId, name: "  Yeni Pizza  ", sku: " pzz-777 ",
        categoryId: "Pizza", categoryName: "Pizzalar", description: "Yeni taslak",
      };
      assert.equal((await request(draftPath, "POST", createDraft)).data.code, "FEATURE_DISABLED");
      assert.equal((await request(draftPath, "POST", createDraft, "viewer-multi")).status, 403);
      assert.equal((await request(draftPath, "POST", createDraft, "manager-single")).status, 403);
      const draftEnabled = await request(featurePath(moda, "catalog.drafts"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      });
      assert.equal(draftEnabled.status, 200);
      assert.equal(draftEnabled.data.effectiveForNewWork, true);
      assert.equal((await request(featurePath(besiktas))).data.find((state) => state.key === "catalog.drafts").effectiveForNewWork, false);

      // Gerçek tarayıcı → React sağlayıcıları → .NET API → geçici PostgreSQL.
      ui = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
        cwd: join(repo, "apps/admin"),
        env: { ...process.env, VITE_FEATURE_PROVIDER: "http", VITE_CATALOG_PROVIDER: "http", VITE_CARI_PROVIDER: "http",
          VITE_INVENTORY_PROVIDER: "http", VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const cariPage = await browser.newPage();
      page.setDefaultTimeout(5000);
      cariPage.setDefaultTimeout(5000);
      await cariPage.goto(`${uiBase}/admin/customers/accounts`);
      await expect(cariPage.getByRole("heading", { name: "Cari hesaplar", level: 1 })).toBeVisible();
      await cariPage.getByLabel("Ad / unvan").fill("Panel Cari Testi");
      await cariPage.getByRole("button", { name: "Cari kartı kaydet" }).click();
      await expect(cariPage.getByText("Cari kartı PostgreSQL'e kaydedildi.")).toBeVisible();
      await cariPage.getByLabel("Tutar (₺)").fill("125.50");
      await cariPage.getByLabel("Açıklama").fill("Panel test alacağı");
      await cariPage.getByRole("button", { name: "Hareketi kaydet" }).click();
      await expect(cariPage.getByRole("row").filter({ hasText: "Panel Cari Testi" })).toContainText("125,50");
      await expect(cariPage.locator(".cari-statement")).toContainText("125,50");
      await cariPage.getByLabel("Başlangıç tarihi").fill(tomorrow);
      await cariPage.getByLabel("Bitiş tarihi").fill(tomorrow);
      const statementRow = cariPage.locator(".cari-statement").getByRole("row").filter({ hasText: "Müşteri alacağı" });
      await expect(statementRow).toContainText("125,50");
      await expect(cariPage.locator(".cari-statement")).toContainText("Bu tarihlerde hareket yok");
      await cariPage.getByRole("button", { name: "Cari kartını düzenle" }).click();
      await cariPage.getByLabel("Unvan", { exact: true }).fill("Panel Cari Güncel");
      await cariPage.getByLabel("Aktif").uncheck();
      await cariPage.getByRole("button", { name: "Kart değişikliklerini kaydet" }).click();
      await expect(cariPage.getByRole("row").filter({ hasText: "Panel Cari Güncel" })).toContainText("Pasif");
      await cariPage.reload();
      await expect(cariPage.getByText("Panel Cari Güncel").first()).toBeVisible();
      await expect(cariPage.getByRole("row").filter({ hasText: "Panel Cari Güncel" })).toContainText("125,50");
      await cariPage.close();
      await page.goto(`${uiBase}/admin/catalog/categories`);
      await page.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await page.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await page.getByRole("row").filter({ hasText: "Tatlılar" }).waitFor();
      await page.goto(`${uiBase}/admin/catalog/products`);
      await page.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await page.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await expect(page.getByRole("button", { name: "Yeni taslak" })).toBeEnabled();
      await page.getByRole("button", { name: "Yeni taslak" }).click();
      await page.getByLabel("Ürün adı").fill("Tarayıcı Taslağı");
      await page.getByLabel("Stok kodu").fill("WEB-001");
      await page.getByLabel("Kategori kodu").fill("pizza");
      await page.getByLabel("Kategori adı").fill("Pizzalar");
      await page.getByLabel("Açıklama").fill("Tarayıcıdan kayıt");
      await page.getByRole("button", { name: "Taslağı kaydet" }).click();
      await page.getByText("Taslak veritabanına kaydedildi.").waitFor();
      await page.getByRole("link", { name: "Tarayıcı Taslağı", exact: true }).click();
      await page.getByRole("button", { name: "Taslağı düzenle" }).click();
      await page.getByLabel("Ürün adı").fill("Tarayıcı Taslağı XL");
      await page.getByRole("button", { name: "Taslağı güncelle" }).click();
      await page.getByText("Taslak değişikliği veritabanına kaydedildi.").waitFor();
      const browserDraft = (await request(`${catalogPath(firm, moda)}&query=Tarayıcı`)).data.items[0];
      assert.equal(browserDraft.name, "Tarayıcı Taslağı XL");
      await page.getByRole("button", { name: "Taslağı düzenle" }).click();
      const outsideUpdate = await request(
        `/api/v1/firms/${firm}/branches/${moda}/catalog/drafts/${browserDraft.id}`, "PUT",
        { name: "Harici Güncelleme", sku: "WEB-001", categoryId: "pizza",
          categoryName: "Pizzalar", description: "Başka oturum", expectedVersion: browserDraft.version },
      );
      assert.equal(outsideUpdate.status, 200);
      await page.getByLabel("Ürün adı").fill("Çakışan Değişiklik");
      await page.getByRole("button", { name: "Taslağı güncelle" }).click();
      await page.getByRole("alert").getByText("başka bir yerde değiştirildi", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Güncel taslağı yükle" }).click();
      await page.getByRole("heading", { name: "Harici Güncelleme", level: 1 }).waitFor();
      assert.equal((await request(`/api/v1/firms/${firm}/catalog/products/${browserDraft.id}?branchId=${moda}`)).data.name, "Harici Güncelleme");
      const inventoryFeatureStates = await request(inventoryFeaturePath(""), "GET", undefined, "manager-single");
      const currentItemsFeature = inventoryFeatureStates.data.find((state) => state.key === "inventory.items");
      if (!currentItemsFeature.desiredEnabled) {
        assert.equal((await request(inventoryFeaturePath("inventory.items"), "PUT", {
          desiredEnabled: true, expectedVersion: currentItemsFeature.version,
        }, "manager-single")).status, 200);
      }
      await page.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("single");
      await page.goto(`${uiBase}/admin`);
      await expect(page.getByRole("heading", { name: "Kritik stoklar" })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Mozzarella" })).toBeVisible();
      await page.goto(`${uiBase}/admin/inventory/warehouse-stock`);
      await expect(page.getByRole("heading", { name: "Depo stokları", level: 1 })).toBeVisible();
      await expect(page.getByLabel("Fiziksel depo")).toContainText("Kadıköy Ana Depo");
      await page.goto(`${uiBase}/admin/inventory/ingredients`);
      await page.getByLabel("Hammadde adı").fill("Tarayıcı Panel Malzemesi");
      await page.getByLabel("Kritik eşik", { exact: true }).fill("5");
      await page.getByRole("button", { name: "PostgreSQL'e kaydet" }).click();
      await expect(page.getByText("Hammadde kartı PostgreSQL'e kaydedildi.")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Tarayıcı Panel Malzemesi" })).toContainText("Kritik");
      await page.locator("form.cari-form").nth(1).locator("select").first().selectOption({ label: "Tarayıcı Panel Malzemesi · 0 g" });
      await page.getByLabel("Miktar", { exact: true }).fill("14");
      await page.getByLabel("Açıklama", { exact: true }).fill("Panelden manuel stok girişi");
      await page.getByRole("button", { name: "Hareketi kaydet" }).click();
      await expect(page.getByText("Stok hareketi kalıcı deftere eklendi; bakiye hareket toplamından yeniden hesaplandı.")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Tarayıcı Panel Malzemesi" })).toContainText("14 g");
      await page.goto(`${uiBase}/admin/inventory/recipes`);
      await expect(page.getByText(/Teorik üretim kapasitesi:/).first()).toBeVisible();
      await expect(page.getByText(/fire, bozulma/).first()).toBeVisible();
      await browser.close();
      browser = undefined;
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;

      const created = await request(draftPath, "POST", createDraft);
      assert.equal(created.status, 201);
      assert.equal(created.data.status, "draft");
      assert.equal(created.data.version, 1);
      assert.equal(created.data.name, "Yeni Pizza");
      assert.equal(created.data.sku, "PZZ-777");
      assert.deepEqual(created.data.branchIds, [moda]);
      assert.equal((await request(draftPath, "POST", createDraft)).status, 200);
      assert.equal((await request(draftPath, "POST", { ...createDraft, name: "Başka" })).data.code, "DRAFT_ID_CONFLICT");
      assert.equal((await request(draftPath, "POST", { ...createDraft, draftId: "77777777-7777-4777-8777-777777777704" })).data.code, "DUPLICATE_DRAFT_OR_SKU");
      assert.equal((await request(draftPath, "POST", { ...createDraft, draftId: "77777777-7777-4777-8777-777777777705", name: " " })).status, 400);
      assert.equal((await request(`${catalogPath(firm, moda)}&query=Yeni`)).data.pageInfo.totalItems, 1);
      assert.equal((await request(`/api/v1/firms/${firm}/catalog/products/${draftId}?branchId=${besiktas}`)).status, 404);

      const updatePath = `${draftPath}/${draftId}`;
      const updateDraft = {
        name: "Yeni Pizza XL", sku: "PZZ-777", categoryId: "pizza",
        categoryName: "Pizzalar", description: "Güncel taslak", expectedVersion: 1,
      };
      assert.equal((await request(featurePath(besiktas, "catalog.drafts"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(`/api/v1/firms/${firm}/branches/${besiktas}/catalog/drafts/${draftId}`, "PUT", updateDraft)).status, 404);
      assert.equal((await request(featurePath(besiktas, "catalog.drafts"), "PUT", {
        desiredEnabled: false, expectedVersion: 2,
      })).status, 200);
      const updated = await request(updatePath, "PUT", updateDraft);
      assert.equal(updated.status, 200);
      assert.equal(updated.data.version, 2);
      assert.equal(updated.data.name, "Yeni Pizza XL");
      assert.equal((await request(updatePath, "PUT", updateDraft)).data.code, "VERSION_CONFLICT");
      assert.equal((await request(`/api/v1/firms/${firm}/catalog/products/${draftId}?branchId=${moda}`)).data.description, "Güncel taslak");
      const racingDraftId = "77777777-7777-4777-8777-777777777703";
      const [draftDisabled, racingCreate] = await Promise.all([
        request(featurePath(moda, "catalog.drafts"), "PUT", {
          desiredEnabled: false, expectedVersion: 2,
        }),
        request(draftPath, "POST", { ...createDraft, draftId: racingDraftId, sku: "PZZ-778" }),
      ]);
      assert.equal(draftDisabled.status, 200);
      assert.equal(draftDisabled.data.effectiveForNewWork, false);
      assert.ok([201, 409].includes(racingCreate.status));
      if (racingCreate.status === 409) assert.equal(racingCreate.data.code, "FEATURE_DISABLED");
      assert.equal(
        (await request(`/api/v1/firms/${firm}/catalog/products/${racingDraftId}?branchId=${moda}`)).status,
        racingCreate.status === 201 ? 200 : 404,
      );
      assert.equal((await request(draftPath, "POST", { ...createDraft, draftId: "77777777-7777-4777-8777-777777777702" })).data.code, "FEATURE_DISABLED");
      assert.equal((await request(draftPath, "POST", createDraft)).data.code, "DRAFT_ID_CONFLICT");
      assert.equal((await request(`/api/v1/firms/${firm}/catalog/products/${draftId}?branchId=${moda}`)).status, 200);

      const before = (await request(featurePath(moda))).data;
      assert.equal(before.length, sharedCatalog.definitions.length);
      assert.equal(
        before.find((state) => state.key === "customers.loyalty")
          .desiredEnabled,
        false,
      );
      const opened = await request(
        featurePath(moda, "customers.loyalty"),
        "PUT",
        {
          desiredEnabled: true,
          expectedVersion: 1,
        },
      );
      assert.equal(opened.status, 200);
      assert.equal(opened.data.version, 2);
      assert.equal(
        (await request(featurePath(besiktas))).data.find(
          (state) => state.key === "customers.loyalty",
        ).desiredEnabled,
        false,
      );

      const concurrent = await Promise.all([
        request(featurePath(moda, "finance.expenses"), "PUT", {
          desiredEnabled: true,
          expectedVersion: 1,
        }),
        request(featurePath(moda, "finance.expenses"), "PUT", {
          desiredEnabled: true,
          expectedVersion: 1,
        }),
      ]);
      assert.deepEqual(
        concurrent.map((result) => result.status).sort(),
        [200, 409],
      );
      assert.equal(
        (
          await request(featurePath(moda, "inventory.recipes"), "PUT", {
            desiredEnabled: true,
            expectedVersion: 1,
          })
        ).data.code,
        "DEPENDENCY_NOT_READY",
      );
      assert.equal(
        (
          await request(featurePath(moda, "catalog.products"), "PUT", {
            desiredEnabled: false,
            expectedVersion: 1,
          })
        ).data.code,
        "DEPENDENT_ACTIVE",
      );
      assert.equal(
        (await request(`${featurePath(moda)}/audit`)).data.filter((entry) => entry.actor !== "system:service-ready").length,
        4,
      );

      await stopApi();
      await startApi();
      assert.equal((await request(catalogPath(firm, besiktas))).data.items[0].price.amountMinor, 34000);
      assert.equal((await request(`/api/v1/firms/${firm}/catalog/products/${draftId}?branchId=${moda}`)).data.version, 2);
      const afterRestart = (await request(featurePath(moda))).data;
      assert.equal(
        afterRestart.find((state) => state.key === "customers.loyalty")
          .desiredEnabled,
        true,
      );
      assert.equal(
        afterRestart.find((state) => state.key === "customers.loyalty").version,
        2,
      );
      assert.equal(
        (await request(`${featurePath(moda)}/audit`)).data.filter((entry) => entry.actor !== "system:service-ready").length,
        4,
      );
      const migrationCount = await runPg("psql", [
        "-h",
        "127.0.0.1",
        "-p",
        String(pgPort),
        "-U",
        process.env.USER,
        "-d",
        "hipos_features",
        "-t",
        "-A",
        "-c",
        'SELECT count(*) FROM public."__EFMigrationsHistory"',
      ]);
      assert.equal(migrationCount.stdout.trim(), "1");
      const catalogMigrationCount = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        'SELECT count(*) FROM catalog."__EFMigrationsHistory"',
      ]);
      assert.equal(catalogMigrationCount.stdout.trim(), "6");
      const salesMigrationCount = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        'SELECT count(*) FROM sales."__EFMigrationsHistory"',
      ]);
      assert.equal(salesMigrationCount.stdout.trim(), "2");
      const auditCount = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT count(*) FROM catalog.draft_audit WHERE draft_id = '${draftId}'`,
      ]);
      assert.equal(auditCount.stdout.trim(), "2");

      // Kategori komutları firma geneline aittir; modül kapalı olsa da yönetim kaydı silinmez.
      const categoriesRoot = categoryPath(firm);
      const newCategory = { id: "drinks", name: "İçecekler" };
      assert.equal((await request(categoriesRoot, "POST", newCategory, "manager-moda")).status, 403);
      assert.equal((await request(categoriesRoot, "POST", newCategory, "viewer-multi")).status, 403);
      assert.equal((await request(categoriesRoot, "POST", newCategory, "manager-single")).status, 403);
      assert.equal((await request(categoriesRoot, "POST", { id: " ", name: "İçecekler" })).status, 400);
      const categoryCreated = await request(categoriesRoot, "POST", newCategory);
      assert.equal(categoryCreated.status, 201);
      assert.equal(categoryCreated.data.version, 1);
      assert.equal((await request(categoriesRoot, "POST", newCategory)).status, 200);
      assert.equal((await request(categoriesRoot, "POST", { ...newCategory, name: "Başka" })).data.code, "CATEGORY_EXISTS");
      assert.equal((await request(categoryPath(firm, besiktas))).data.items.find((item) => item.id === "drinks").productCount, 0);

      const renamePath = `${categoriesRoot}/pizza`;
      assert.equal((await request(renamePath, "PUT", { name: "Yetkisiz", expectedVersion: 1 }, "manager-moda")).status, 403);
      assert.equal((await request(renamePath, "PUT", { name: "Yeni", expectedVersion: 0 })).status, 400);
      const competingRenames = await Promise.all([
        request(renamePath, "PUT", { name: "Pizza ve Pide", expectedVersion: 1 }),
        request(renamePath, "PUT", { name: "Yeni Pizzalar", expectedVersion: 1 }),
      ]);
      assert.deepEqual(competingRenames.map((item) => item.status).sort(), [200, 409]);
      const winningName = competingRenames.find((item) => item.status === 200).data.name;
      assert.equal(competingRenames.find((item) => item.status === 409).data.code, "VERSION_CONFLICT");
      assert.equal((await request(renamePath, "PUT", { name: "Geç", expectedVersion: 1 })).data.code, "VERSION_CONFLICT");
      assert.equal((await request(categoryPath(firm))).data.items.find((item) => item.id === "pizza").name, winningName);
      const renamedDraft = await request(`/api/v1/firms/${firm}/catalog/products/${draftId}?branchId=${moda}`);
      assert.equal(renamedDraft.data.category.name, winningName);
      assert.equal(renamedDraft.data.version, 3);
      assert.equal((await request(featurePath(moda, "catalog.drafts"), "PUT", {
        desiredEnabled: true, expectedVersion: 3,
      })).status, 200);
      assert.equal((await request(updatePath, "PUT", { ...updateDraft, expectedVersion: 2 })).data.code,
        "VERSION_CONFLICT");
      assert.equal((await request(updatePath, "PUT", { ...updateDraft, expectedVersion: 3 })).data.code,
        "CATEGORY_NAME_MISMATCH");
      const categoryAudit = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT action || ':' || actor || ':' || version FROM catalog.category_audit
         WHERE firm_id = '${firm}' ORDER BY id`,
      ]);
      assert.deepEqual(categoryAudit.stdout.trim().split("\n"), [
        "created:manager-multi:1", "renamed:manager-multi:2",
      ]);
      const renamedDraftAudit = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT action || ':' || version FROM catalog.draft_audit WHERE draft_id = '${draftId}' ORDER BY id`,
      ]);
      assert.deepEqual(renamedDraftAudit.stdout.trim().split("\n"), [
        "created:1", "updated:2", "category_renamed:3",
      ]);

      const salesList = (branchId) =>
        `/api/v1/firms/${firm}/sales/orders${branchId ? `?branchId=${branchId}` : ""}`;
      const posOrders = (branchId) => `/api/v1/firms/${firm}/branches/${branchId}/sales/orders`;
      const orderId = "88888888-8888-4888-8888-888888888801";
      const orderBody = { orderId, items: [{ productId: pizzaId, quantity: 2 }] };
      assert.deepEqual((await request(salesList(moda))).data.items, []);
      assert.equal((await request(posOrders(moda), "POST", orderBody, "pos-moda")).data.code, "FEATURE_DISABLED");
      assert.equal((await request(posOrders(moda), "POST", orderBody)).status, 403);
      assert.equal((await request(posOrders(besiktas), "POST", orderBody, "pos-moda")).status, 403);
      assert.equal((await request(salesList(moda), "GET", undefined, "pos-moda")).status, 403);
      const salesEnabled = await request(featurePath(moda, "sales.pos_orders"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      });
      assert.equal(salesEnabled.status, 200);
      assert.equal(salesEnabled.data.effectiveForNewWork, true);
      assert.equal((await request(posOrders(moda), "POST", {
        ...orderBody, orderId: "88888888-8888-4888-8888-888888888802",
        items: [{ productId: cakeId, quantity: 1 }],
      }, "pos-moda")).data.code, "PRODUCT_NOT_SELLABLE");
      const placedOrder = await request(posOrders(moda), "POST", orderBody, "pos-moda");
      assert.equal(placedOrder.status, 201);
      assert.equal(placedOrder.data.status, "open");
      assert.equal(placedOrder.data.paymentStatus, "unpaid");
      assert.equal(placedOrder.data.totalMinor, 64000);
      assert.equal(placedOrder.data.items[0].unitPriceMinor, 32000);
      assert.equal((await request(posOrders(moda), "POST", orderBody, "pos-moda")).status, 200);
      assert.equal((await request(posOrders(moda), "POST", {
        ...orderBody, items: [{ productId: pizzaId, quantity: 3 }],
      }, "pos-moda")).data.code, "ORDER_ID_CONFLICT");
      const modaService = servicePath(firm, moda);
      const personnelEnabled = (await request(featurePath(moda))).data.find((row) => row.key === "staff.records");
      assert.equal(personnelEnabled.desiredEnabled, true);
      assert.equal(personnelEnabled.effectiveForNewWork, true);
      const employeeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
      const chefBody = { requestId: employeeId, name: "Demo Şef", department: "kitchen", jobTitle: "Baş Şef", phone: "0532 111 22 33" };
      const chef = await request(`${modaService}/employees`, "POST", chefBody);
      assert.equal(chef.status, 201);
      assert.equal(chef.data.department, "kitchen");
      assert.equal(chef.data.jobTitle, "Baş Şef");
      assert.equal(chef.data.version, 1);
      assert.equal((await request(`${modaService}/employees`, "POST", chefBody)).status, 200);
      assert.equal((await request(`${modaService}/employees`, "POST", { ...chefBody, jobTitle: "Şef" })).data.code,
        "EMPLOYEE_REQUEST_CONFLICT");
      const changedChef = await request(`${modaService}/employees/${employeeId}`, "PUT", {
        expectedVersion: 1, name: "Demo Şef", department: "kitchen", jobTitle: "Pastacı Şef", phone: "0532 111 22 33", isActive: true,
      });
      assert.equal(changedChef.status, 200);
      assert.equal(changedChef.data.version, 2);
      const inactiveChef = await request(`${modaService}/employees/${employeeId}`, "PUT", {
        expectedVersion: 2, name: "Demo Şef", department: "kitchen", jobTitle: "Pastacı Şef", phone: "0532 111 22 33", isActive: false,
      });
      assert.equal(inactiveChef.data.isActive, false);
      assert.equal((await request(`${modaService}/employees`)).data.items.find((row) => row.id === employeeId).isActive, false);
      assert.equal((await request(`${modaService}/employees/${employeeId}`, "PUT", {
        expectedVersion: 2, name: "Demo Şef", department: "kitchen", jobTitle: "Pastacı Şef", phone: "0532 111 22 33", isActive: true,
      })).data.code, "VERSION_CONFLICT");
      const activeChef = await request(`${modaService}/employees/${employeeId}`, "PUT", {
        expectedVersion: 3, name: "Demo Şef", department: "kitchen", jobTitle: "Pastacı Şef", phone: "0532 111 22 33", isActive: true,
      });
      assert.equal(activeChef.data.isActive, true);
      assert.equal(activeChef.data.version, 4);
      const employeeAudit = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT count(*) FROM service.audit WHERE firm_id='${firm}' AND branch_id='${moda}' AND entity_id='${employeeId}' AND action LIKE 'employee_%'`]);
      assert.equal(employeeAudit.stdout.trim(), "4");
      assert.equal((await request(`${modaService}/tables`, "GET", undefined, "manager-single")).status, 403);
      const table = await request(`${modaService}/tables`, "POST", { number: 12, name: "Masa 12" });
      assert.equal(table.status, 201);
      assert.equal((await request(`${modaService}/tables`, "POST", { number: 12, name: "Tekrar" })).data.code, "TABLE_EXISTS");
      assert.equal((await request(`${modaService}/waiters`, "POST", { name: "Demo Garson" })).data.code, "FEATURE_DISABLED");
      const waiterEnabled = await request(featurePath(moda, "service.waiters"), "PUT", { desiredEnabled: true, expectedVersion: 1 });
      assert.equal(waiterEnabled.status, 200);
      assert.equal(waiterEnabled.data.effectiveForNewWork, true);
      const waiter = await request(`${modaService}/waiters`, "POST", { name: "Demo Garson" });
      assert.equal(waiter.status, 201);
      const assignment = { requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", tableId: table.data.id,
        orderId, waiterId: waiter.data.id };
      assert.equal((await request(`${modaService}/assignments`, "POST", assignment, "pos-besiktas")).status, 403);
      assert.equal((await request(`${modaService}/assignments`, "POST", assignment, "pos-moda")).status, 201);
      assert.equal((await request(`${modaService}/assignments`, "POST", assignment, "pos-moda")).status, 200);
      const linkedEmployee = (await request(`${modaService}/employees`)).data.items.find((row) => row.id === waiter.data.id);
      assert.equal((await request(`${modaService}/employees/${waiter.data.id}`, "PUT", {
        expectedVersion: linkedEmployee.version, name: linkedEmployee.name, department: "kitchen", jobTitle: "Şef", phone: null, isActive: false,
      })).data.code, "EMPLOYEE_HAS_OPEN_ASSIGNMENT");
      const tableDetail = await request(`${modaService}/tables`);
      assert.equal(tableDetail.data.items[0].assignment.waiterName, "Demo Garson");
      assert.equal(tableDetail.data.items[0].assignment.items[0].productName, "Margherita Pizza");
      assert.equal(tableDetail.data.items[0].assignment.items[0].quantity, 2);
      assert.equal((await request(`${modaService}/tables/${table.data.id}`, "DELETE")).data.code, "TABLE_HAS_OPEN_CHECK");
      const nextTable = await request(`${modaService}/tables`, "POST", { name: null });
      assert.equal(nextTable.status, 201);
      assert.equal(nextTable.data.number, 13);
      assert.equal((await request(`${modaService}/tables/${table.data.id}`, "DELETE")).data.code, "ONLY_LAST_TABLE_CAN_BE_REMOVED");
      const removedTable = await request(`${modaService}/tables/${nextTable.data.id}`, "DELETE");
      assert.equal(removedTable.status, 200);
      assert.equal(removedTable.data.isActive, false);
      // Gerçek React ekranı aynı servis bağına dayanmalı; masa sayısı fixture'dan gelmemeli.
      uiOutput = "";
      ui = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
        cwd: join(repo, "apps/admin"),
        env: { ...process.env, VITE_FEATURE_PROVIDER: "http", VITE_SERVICE_PROVIDER: "http",
          VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      browser = await chromium.launch({ headless: true });
      const servicePage = await browser.newPage();
      await servicePage.goto(`${uiBase}/admin/branches/tables`);
      await servicePage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await servicePage.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await expect(servicePage.getByText("1/1 masada açık bağ")).toBeVisible();
      await servicePage.getByRole("button", { name: "Masa 12, açık adisyon var" }).click();
      await expect(servicePage.locator(".service-detail")).toContainText("Demo Garson");
      await expect(servicePage.locator(".service-detail")).toContainText("2 × Margherita Pizza");
      await servicePage.getByRole("button", { name: /Demo Garson/ }).click();
      await expect(servicePage.locator(".service-table.waiter-match")).toHaveCount(1);
      await expect(servicePage.locator(".service-waiter-chip[aria-pressed='true']")).toContainText("Demo Garson");
      await servicePage.getByRole("button", { name: "Masa ekle" }).click();
      await expect(servicePage.getByRole("button", { name: "Masa 13, açık adisyon yok" })).toBeVisible();
      await expect(servicePage.getByRole("status").filter({ hasText: "Masa 13 eklendi" })).toBeVisible();
      await servicePage.getByRole("button", { name: "Masa sil" }).click();
      await expect(servicePage.getByRole("button", { name: "Masa 13, açık adisyon yok" })).toHaveCount(0);
      await expect(servicePage.getByRole("button", { name: "Masa sil" })).toBeDisabled();
      await expect(servicePage.getByText("Masa 12 silinemez.", { exact: false })).toBeVisible();
      await servicePage.getByRole("link", { name: "Personel yönetimine git" }).click();
      await expect(servicePage.getByRole("heading", { name: "Personel", level: 1 })).toBeVisible();
      await expect(servicePage.locator(".personnel-chef-group")).toContainText("Demo Şef");
      await servicePage.getByLabel("Ad soyad").fill("UI Mutfakçı");
      await servicePage.locator(".personnel-form select").selectOption("kitchen");
      await servicePage.getByLabel("Görev / unvan").fill("Hazırlık personeli");
      await servicePage.getByRole("button", { name: "Personel kaydet" }).click();
      await expect(servicePage.locator(".personnel-group-kitchen").filter({ hasText: "Mutfak Ekibi" })).toContainText("UI Mutfakçı");
      await expect(servicePage.locator(".personnel-chef-group")).not.toContainText("UI Mutfakçı");
      await servicePage.getByRole("link", { name: "Masa planına dön" }).click();
      await expect(servicePage.getByRole("heading", { name: "Masa planı", level: 1 })).toBeVisible();
      assert.equal((await request(`${modaService}/assignments`, "POST", {
        ...assignment, requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef",
      }, "pos-moda")).data.code, "TABLE_OCCUPIED");
      const tablesOff = await request(featurePath(moda, "branches.tables"), "PUT", { desiredEnabled: false, expectedVersion: 2 });
      assert.equal(tablesOff.status, 200);
      const afterTablesOff = (await request(featurePath(moda))).data;
      assert.equal(afterTablesOff.find((row) => row.key === "service.waiters").desiredEnabled, false);
      assert.equal(afterTablesOff.find((row) => row.key === "staff.records").desiredEnabled, true);
      assert.equal(afterTablesOff.find((row) => row.key === "sales.pos_orders").effectiveForNewWork, true);
      await servicePage.reload();
      await servicePage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await servicePage.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await expect(servicePage.getByText("Masa servisi kapalı. Geçmiş masa kayıtları", { exact: false })).toBeVisible();
      await expect(servicePage.getByText("Garson servisi kapalı. Yeni garson kartı", { exact: false })).toBeVisible();
      assert.equal(await servicePage.getByRole("button", { name: "Masa kartı ekle" }).count(), 0);
      assert.equal(await servicePage.getByRole("button", { name: "Kişi kartı ekle" }).count(), 0);
      await servicePage.getByRole("button", { name: "Masa 12, açık adisyon var" }).click();
      await expect(servicePage.locator(".service-detail")).toContainText("Masa servisi kapalı · geçmiş bağ");
      await expect(servicePage.locator(".service-detail")).toContainText("Demo Garson");
      await servicePage.getByRole("link", { name: "Şube Listesi" }).click();
      await expect(servicePage.getByRole("heading", { name: "Şube listesi", level: 1 })).toBeVisible();
      assert.equal(await servicePage.locator(".service-table-plan").count(), 0);
      assert.equal(await servicePage.getByText("Bu özellik bu şubede kapalı").count(), 0);
      await servicePage.getByRole("link", { name: "Masa Planı", exact: true }).click();
      await expect(servicePage.getByRole("heading", { name: "Masa planı", level: 1 })).toBeVisible();
      assert.equal((await request(`${modaService}/tables`, "POST", { number: 13, name: "Kapalı" })).data.code, "FEATURE_DISABLED");
      assert.equal((await request(`${modaService}/assignments`, "POST", {
        ...assignment, requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeed", orderId: "88888888-8888-4888-8888-888888888805",
      }, "pos-moda")).data.code, "FEATURE_DISABLED");
      assert.equal((await request(`${modaService}/assignments/${assignment.requestId}/close`, "POST", { expectedVersion: 1 }, "pos-moda")).status, 200);
      assert.equal((await request(`${modaService}/tables`)).data.items[0].assignment ?? null, null);
      const staffOff = await request(featurePath(moda, "staff.records"), "PUT", {
        desiredEnabled: false, expectedVersion: personnelEnabled.version,
      });
      assert.equal(staffOff.status, 200);
      assert.equal((await request(`${modaService}/employees`)).status, 200);
      assert.equal((await request(`${modaService}/employees`, "POST", {
        requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02", name: "Kapalı Personel", department: "service", jobTitle: "Garson", phone: null,
      })).data.code, "FEATURE_DISABLED");
      await servicePage.reload();
      await servicePage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await servicePage.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await servicePage.getByRole("button", { name: "Masa 12, açık adisyon yok" }).click();
      await expect(servicePage.locator(".service-detail")).toContainText("Bu masada açık adisyon yok.");
      await browser.close();
      browser = undefined;
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;
      assert.equal((await request(`${posOrders(moda)}/${orderId}`)).data.status, "open");
      assert.equal((await request(salesList(moda))).data.items.length, 1);
      assert.deepEqual((await request(salesList(besiktas))).data.items, []);
      assert.equal((await request(salesList(), "GET", undefined, "manager-moda")).status, 403);
      assert.equal((await request(salesList(moda), "GET", undefined, "manager-single")).status, 403);

      const besiktasOrder = await request(posOrders(besiktas), "POST", {
        orderId: "88888888-8888-4888-8888-888888888803",
        items: [{ productId: pizzaId, quantity: 1 }],
      }, "pos-besiktas");
      assert.equal(besiktasOrder.data.code, "FEATURE_DISABLED");
      assert.equal((await request(featurePath(besiktas, "sales.pos_orders"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      const pricedOrder = await request(posOrders(besiktas), "POST", {
        orderId: "88888888-8888-4888-8888-888888888803",
        items: [{ productId: pizzaId, quantity: 1 }],
      }, "pos-besiktas");
      assert.equal(pricedOrder.status, 201);
      assert.equal(pricedOrder.data.items[0].unitPriceMinor, 34000);
      assert.equal((await request(salesList())).data.items.length, 2);
      assert.equal((await request(featurePath(moda, "sales.pos_orders"), "PUT", {
        desiredEnabled: false, expectedVersion: 2,
      })).status, 200);
      assert.equal((await request(posOrders(moda), "POST", {
        ...orderBody, orderId: "88888888-8888-4888-8888-888888888804",
      }, "pos-moda")).data.code, "FEATURE_DISABLED");
      assert.equal((await request(salesList(moda))).data.items.length, 1);
      const orderAudit = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT action || ':' || actor || ':' || version FROM sales.order_audit
         WHERE order_id = '${orderId}' ORDER BY id`,
      ]);
      assert.equal(orderAudit.stdout.trim(), "created:pos-moda:1");
      await stopApi();
      await startApi();
      assert.equal((await request(salesList(moda))).data.items[0].totalMinor, 64000);

      // Simüle ödeme: kısmi başarı, belirsiz sonuç, çözüm, iptal ve tamamlama.
      const paymentsPath = `${posOrders(moda)}/${orderId}/payment-attempts`;
      const firstAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
      const unknownAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
      const pendingAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
      const finalAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
      const paymentBody = (attemptId, amountMinor, simulatedOutcome, expectedOrderVersion) => ({
        attemptId, amountMinor, method: "card", simulatedOutcome, expectedOrderVersion,
      });
      assert.equal((await request(paymentsPath, "POST", paymentBody(firstAttempt, 20000, "succeeded", 1), "pos-moda")).data.code, "FEATURE_DISABLED");
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(paymentsPath, "POST", paymentBody(firstAttempt, 20000, "succeeded", 1))).status, 403);
      assert.equal((await request(paymentsPath, "POST", paymentBody(firstAttempt, 20000, "succeeded", 1), "pos-besiktas")).status, 403);
      const partial = await request(paymentsPath, "POST", paymentBody(firstAttempt, 20000, "succeeded", 1), "pos-moda");
      assert.equal(partial.status, 201);
      assert.equal(partial.data.attempt.simulated, true);
      assert.equal(partial.data.order.paymentStatus, "partially_paid");
      assert.equal(partial.data.order.paidMinor, 20000);
      assert.equal(partial.data.order.remainingMinor, 44000);
      assert.equal(partial.data.order.status, "open");
      assert.equal((await request(paymentsPath, "POST", paymentBody(firstAttempt, 20000, "succeeded", 1), "pos-moda")).status, 200);
      assert.equal((await request(`${posOrders(besiktas)}/${orderId}/payment-attempts`, "POST",
        paymentBody(firstAttempt, 20000, "succeeded", 1), "pos-besiktas")).data.code, "PAYMENT_NOT_FOUND");
      assert.equal((await request(paymentsPath, "POST", paymentBody(firstAttempt, 21000, "succeeded", 1), "pos-moda")).data.code, "PAYMENT_ID_CONFLICT");
      assert.equal((await request(paymentsPath, "POST", paymentBody(unknownAttempt, 44000, "unknown", 1), "pos-moda")).data.code, "VERSION_CONFLICT");
      const unknown = await request(paymentsPath, "POST", paymentBody(unknownAttempt, 44000, "unknown", 2), "pos-moda");
      assert.equal(unknown.status, 201);
      assert.equal(unknown.data.order.paymentStatus, "unknown");
      assert.equal(unknown.data.order.paidMinor, 20000);
      assert.equal((await request(paymentsPath, "POST", paymentBody(pendingAttempt, 44000, "succeeded", 3), "pos-moda")).data.code, "PAYMENT_UNRESOLVED");
      const unknownResolve = `${paymentsPath}/${unknownAttempt}/resolve`;
      assert.equal((await request(unknownResolve, "POST", { outcome: "succeeded", expectedOrderVersion: 2 }, "pos-moda")).data.code, "VERSION_CONFLICT");
      const failedUnknown = await request(unknownResolve, "POST", { outcome: "failed", expectedOrderVersion: 3 }, "pos-moda");
      assert.equal(failedUnknown.status, 200);
      assert.equal(failedUnknown.data.order.paymentStatus, "partially_paid");
      assert.equal((await request(unknownResolve, "POST", { outcome: "failed", expectedOrderVersion: 3 }, "pos-moda")).status, 200);
      assert.equal((await request(unknownResolve, "POST", { outcome: "succeeded", expectedOrderVersion: 4 }, "pos-moda")).data.code, "PAYMENT_ALREADY_FINAL");
      const pending = await request(paymentsPath, "POST", paymentBody(pendingAttempt, 44000, "pending", 4), "pos-moda");
      assert.equal(pending.status, 201);
      assert.equal(pending.data.order.paymentStatus, "pending");
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: false, expectedVersion: 2,
      })).status, 200);
      assert.equal((await request(paymentsPath, "POST", paymentBody(finalAttempt, 44000, "succeeded", 5), "pos-moda")).data.code,
        "FEATURE_DISABLED");
      assert.equal((await request(`${paymentsPath}/${pendingAttempt}/resolve`, "POST", {
        outcome: "cancelled", expectedOrderVersion: 5,
      }, "pos-moda")).data.order.paymentStatus, "partially_paid");
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: true, expectedVersion: 3,
      })).status, 200);
      const full = await request(paymentsPath, "POST", paymentBody(finalAttempt, 44000, "succeeded", 6), "pos-moda");
      assert.equal(full.status, 201);
      assert.equal(full.data.order.paymentStatus, "paid");
      assert.equal(full.data.order.paidMinor, 64000);
      assert.equal(full.data.order.remainingMinor, 0);
      assert.equal(full.data.order.status, "open");
      assert.equal((await request(paymentsPath, "POST", paymentBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5", 1, "succeeded", 7), "pos-moda")).data.code, "AMOUNT_EXCEEDS_REMAINING");
      assert.equal((await request(paymentsPath)).data.length, 4);
      assert.equal((await request(paymentsPath, "GET", undefined, "manager-single")).status, 403);
      assert.equal((await request(salesList(moda))).data.items[0].paymentStatus, "paid");
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: false, expectedVersion: 4,
      })).status, 200);
      assert.equal((await request(paymentsPath)).data.length, 4);
      const paymentAudit = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT action || ':' || status FROM sales.payment_attempt_audit
         WHERE order_id = '${orderId}' ORDER BY id`,
      ]);
      assert.deepEqual(paymentAudit.stdout.trim().split("\n"), [
        "started:succeeded", "started:unknown", "resolved:failed",
        "started:pending", "resolved:cancelled", "started:succeeded",
      ]);

      // Gerçek taslak → sürümlü fiyat → yayın → test POS satışı.
      const publishedProductId = "77777777-7777-4777-8777-777777777709";
      const publishedPriceId = "99999999-9999-4999-8999-999999999909";
      const nextPriceId = "99999999-9999-4999-8999-999999999910";
      const publicationId = "99999999-9999-4999-8999-999999999911";
      const pricePath = `${draftPath}/${publishedProductId}/price`;
      const publishPath = `${draftPath}/${publishedProductId}/publish`;
      const draftForPublish = {
        draftId: publishedProductId, name: "Yayınlanan Pizza", sku: "PZZ-909",
        categoryId: "pizza", categoryName: winningName, description: "İlk yayın testi",
      };
      assert.equal((await request(draftPath, "POST", draftForPublish)).status, 201);
      assert.equal((await request(pricePath, "PUT", {
        priceVersionId: publishedPriceId, amountMinor: 32550, expectedVersion: 1,
      })).data.code, "FEATURE_DISABLED");
      assert.equal((await request(featurePath(moda, "catalog.price_drafts"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(featurePath(moda, "catalog.publishing"), "PUT", {
        desiredEnabled: true, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(publishPath, "POST", {
        publicationId, expectedVersion: 1,
      })).data.code, "PRICE_REQUIRED");
      assert.equal((await request(pricePath, "PUT", {
        priceVersionId: publishedPriceId, amountMinor: 32550, expectedVersion: 1,
      }, "manager-single")).status, 403);
      const firstPrice = await request(pricePath, "PUT", {
        priceVersionId: publishedPriceId, amountMinor: 32550, expectedVersion: 1,
      });
      assert.equal(firstPrice.status, 201);
      assert.equal(firstPrice.data.priceVersion.number, 1);
      assert.equal(firstPrice.data.product.version, 2);
      assert.equal((await request(pricePath, "PUT", {
        priceVersionId: publishedPriceId, amountMinor: 32550, expectedVersion: 1,
      })).status, 200);
      assert.equal((await request(pricePath, "PUT", {
        priceVersionId: nextPriceId, amountMinor: 33000, expectedVersion: 1,
      })).data.code, "VERSION_CONFLICT");
      const secondPrice = await request(pricePath, "PUT", {
        priceVersionId: nextPriceId, amountMinor: 33000, expectedVersion: 2,
      });
      assert.equal(secondPrice.status, 201);
      assert.equal(secondPrice.data.priceVersion.number, 2);
      assert.equal((await request(publishPath, "POST", {
        publicationId, expectedVersion: 2,
      })).data.code, "VERSION_CONFLICT");
      const publication = await request(publishPath, "POST", {
        publicationId, expectedVersion: 3,
      });
      assert.equal(publication.status, 201);
      assert.equal(publication.data.product.status, "published");
      assert.equal(publication.data.product.price.amountMinor, 33000);
      assert.deepEqual(publication.data.product.channels, ["pos"]);
      assert.equal(publication.data.publication.priceVersionId, nextPriceId);
      assert.equal((await request(publishPath, "POST", {
        publicationId, expectedVersion: 3,
      })).status, 200);
      assert.equal((await request(publishPath, "POST", {
        publicationId: "99999999-9999-4999-8999-999999999912", expectedVersion: 3,
      })).data.code, "DRAFT_NOT_FOUND");
      const priceHistoryPath = `/api/v1/firms/${firm}/branches/${moda}/catalog/products/${publishedProductId}/price-versions`;
      const publishHistoryPath = `/api/v1/firms/${firm}/branches/${moda}/catalog/products/${publishedProductId}/publications`;
      assert.deepEqual((await request(priceHistoryPath)).data.map((item) => item.amountMinor), [32550, 33000]);
      assert.equal((await request(publishHistoryPath)).data.length, 1);
      assert.equal((await request(publishHistoryPath, "GET", undefined, "manager-single")).status, 403);
      assert.equal((await request(`/api/v1/firms/${firm}/branches/${besiktas}/catalog/products/${publishedProductId}/publications`)).status, 404);
      const publishAudit = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT action || ':' || version FROM catalog.draft_audit
         WHERE draft_id = '${publishedProductId}' ORDER BY id`,
      ]);
      assert.deepEqual(publishAudit.stdout.trim().split("\n"),
        ["created:1", "price_set:2", "price_set:3", "published:4"]);
      const unpublishedId = "77777777-7777-4777-8777-777777777710";
      assert.equal((await request(draftPath, "POST", {
        draftId: unpublishedId, name: "Bekleyen Pizza", sku: "PZZ-910",
        categoryId: "pizza", categoryName: winningName, description: "Kapalı yayın testi",
      })).status, 201);
      assert.equal((await request(`${draftPath}/${unpublishedId}/price`, "PUT", {
        priceVersionId: "99999999-9999-4999-8999-999999999913", amountMinor: 28000, expectedVersion: 1,
      })).status, 201);
      assert.equal((await request(featurePath(moda, "catalog.publishing"), "PUT", {
        desiredEnabled: false, expectedVersion: 2,
      })).status, 200);
      assert.equal((await request(`${draftPath}/${unpublishedId}/publish`, "POST", {
        publicationId: "99999999-9999-4999-8999-999999999914", expectedVersion: 2,
      })).data.code, "FEATURE_DISABLED");
      assert.equal((await request(publishHistoryPath)).data.length, 1);
      assert.equal((await request(priceHistoryPath)).data.length, 2);

      // Yönetim paneli → fiyat → yayın → ayrı test POS → salt okunur sipariş görünümü.
      assert.equal((await request(featurePath(moda, "catalog.publishing"), "PUT", {
        desiredEnabled: true, expectedVersion: 3,
      })).status, 200);
      assert.equal((await request(featurePath(moda, "sales.pos_orders"), "PUT", {
        desiredEnabled: true, expectedVersion: 3,
      })).status, 200);
      assert.equal((await request(featurePath(moda, "payments.simulator"), "PUT", {
        desiredEnabled: true, expectedVersion: 5,
      })).status, 200);
      uiOutput = "";
      ui = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
        cwd: join(repo, "apps/admin"),
        env: { ...process.env, VITE_FEATURE_PROVIDER: "http", VITE_CATALOG_PROVIDER: "http",
          VITE_SALES_PROVIDER: "http", VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      browser = await chromium.launch({ headless: true });
      const catalogPage = await browser.newPage();
      await catalogPage.goto(`${uiBase}/admin/catalog/products`);
      await catalogPage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await catalogPage.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await catalogPage.getByRole("button", { name: "Yeni taslak" }).click();
      await catalogPage.getByLabel("Ürün adı").fill("Panelden Pizza");
      await catalogPage.getByLabel("Stok kodu").fill("PZZ-911");
      await catalogPage.getByLabel("Kategori kodu").fill("pizza");
      await catalogPage.getByLabel("Kategori adı").fill(winningName);
      await catalogPage.getByRole("button", { name: "Taslağı kaydet" }).click();
      await catalogPage.getByText("Taslak veritabanına kaydedildi.").waitFor();
      await catalogPage.getByRole("link", { name: "Panelden Pizza", exact: true }).click();
      await catalogPage.getByLabel("Fiyat (TL)").waitFor();
      const panelDraftId = new URL(catalogPage.url()).pathname.split("/").at(-1);
      assert.equal((await request(`${draftPath}/${panelDraftId}`, "PUT", {
        name: "Panelden Pizza", sku: "PZZ-911", categoryId: "pizza",
        categoryName: winningName, description: "Harici düzenleme", expectedVersion: 1,
      })).status, 200);
      await catalogPage.getByLabel("Fiyat (TL)").fill("349,90");
      await catalogPage.getByRole("button", { name: "Fiyat sürümü kaydet" }).click();
      await catalogPage.getByRole("alert").getByText("başka bir işlemle değişti", { exact: false }).waitFor();
      assert.equal(await catalogPage.getByText("Fiyat sürümü veritabanına kaydedildi.").count(), 0);
      await catalogPage.getByRole("button", { name: "Güncel taslağı yükle" }).click();
      await catalogPage.getByLabel("Fiyat (TL)").fill("349,90");
      await catalogPage.getByRole("button", { name: "Fiyat sürümü kaydet" }).click();
      await catalogPage.getByText("Fiyat sürümü veritabanına kaydedildi.").waitFor();
      await catalogPage.getByText("Fiyat sürümü 1").waitFor();
      await catalogPage.getByRole("button", { name: "POS'a yayınla" }).click();
      await catalogPage.getByText("Ürün POS kanalında yayınlandı; kayıt veritabanında doğrulandı.").waitFor();
      await catalogPage.getByText("POS yayını 1").waitFor();
      const panelProduct = (await request(`${catalogPath(firm, moda)}&query=Panelden`)).data.items[0];
      assert.equal(panelProduct.status, "published");
      assert.equal(panelProduct.price.amountMinor, 34990);
      await catalogPage.close();
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;
      assert.equal((await request(featurePath(moda, "catalog.publishing"), "PUT", {
        desiredEnabled: false, expectedVersion: 4,
      })).status, 200);
      assert.equal((await request(`/api/v1/firms/${firm}/branches/${moda}/catalog/products/${panelProduct.id}/publications`)).data.length, 1);

      uiOutput = "";
      ui = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
        cwd: join(repo, "apps/pos"),
        env: { ...process.env, VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      const posPage = await browser.newPage();
      await posPage.goto(uiBase);
      await posPage.getByLabel("Test şubesi").selectOption("moda");
      await posPage.getByLabel("Yayınlanmış POS ürünü").selectOption(panelProduct.id);
      await posPage.getByLabel("Adet").fill("2");
      await posPage.getByRole("button", { name: "Sipariş oluştur" }).click();
      await posPage.getByText("Sipariş veritabanına kaydedildi.").waitFor();
      assert.equal((await request(salesList(moda))).data.items.length, 2);
      assert.equal((await request(salesList(moda))).data.items[0].totalMinor, 69980);
      await posPage.getByRole("button", { name: "Simüle ödeme girişimi oluştur" }).click();
      await posPage.getByText("Simülatör sonucu: başarılı. Gerçek tahsilat yapılmadı.").waitFor();
      assert.equal((await request(salesList(moda))).data.items[0].paymentStatus, "paid");
      assert.equal((await request(salesList(moda))).data.items[0].paidMinor, 69980);
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;

      uiOutput = "";
      ui = spawn(process.execPath, [join(repo, "node_modules/vite/bin/vite.js"),
        "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], {
        cwd: join(repo, "apps/admin"),
        env: { ...process.env, VITE_FEATURE_PROVIDER: "http", VITE_CATALOG_PROVIDER: "http",
          VITE_SALES_PROVIDER: "http", VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      const managerPage = await browser.newPage();
      await managerPage.goto(`${uiBase}/admin/sales`);
      await managerPage.getByRole("combobox", { name: "İşletme senaryosu" }).selectOption("multi");
      await managerPage.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await managerPage.getByRole("heading", { name: "Canlı sipariş görünümü" }).waitFor();
      const paidRow = managerPage.getByRole("row").filter({ hasText: "Panelden Pizza" }).first();
      await paidRow.waitFor();
      await paidRow.getByText("Ödendi · simüle").waitFor();
      assert.equal(await managerPage.getByRole("button", { name: "Sipariş oluştur" }).count(), 0);
      // Masa/garson kapalıyken yeni self-servis sipariş akışı etkilenmez.
      assert.equal((await request(posOrders(moda), "POST", {
        ...orderBody, orderId: "88888888-8888-4888-8888-888888888805",
      }, "pos-moda")).status, 201);
      assert.equal((await request(salesList(moda))).data.items.length, 3);
      await verifyMenuApi({ request, firm, branch: moda, otherBranch: besiktas, pizzaId, cakeId,
        sql: async query => (await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
          "-d", "hipos_features", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", query])).stdout });
      const menuSeedEnv = { ...env, HIPOS_DEMO_DATABASE_URL: `postgresql://${process.env.USER}@127.0.0.1:${pgPort}/hipos_features` };
      await execFile(process.execPath, [join(repo, "scripts/seed-demo.mjs")], { cwd: repo, env: menuSeedEnv });
      for (let repetition = 0; repetition < 2; repetition++)
        await execFile(process.execPath, [join(repo, "scripts/seed-menus.mjs")], { cwd: repo, env: menuSeedEnv });
      const menuSeeds = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c", `SELECT count(*) FROM catalog.menus WHERE firm_id='${single}'`]);
      assert.equal(menuSeeds.stdout.trim(), "2");
      await verifyMenuPanel({ browser, uiBase, request, single, singleBranch });
      await browser.close();
      browser = undefined;
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;
    } catch (error) {
      const pgOutput = await readFile(log, "utf8").catch(() => "");
      throw new Error(
        `${error.message}\nAPI (son bölüm): ${apiOutput.slice(-12000)}\nUI: ${uiOutput}\nPostgreSQL (son bölüm): ${pgOutput.slice(-4000)}`,
      );
    } finally {
      await browser?.close();
      if (ui && ui.exitCode === null) ui.kill("SIGTERM");
      await stopApi();
      if (postgresStarted)
        await runPg("pg_ctl", ["-D", data, "-m", "fast", "stop"]).catch(
          () => {},
        );
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
