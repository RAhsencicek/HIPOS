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
      assert.equal((await request(`/api/v1/firms/${firm}/sales/orders?branchId=${moda}`)).data.code,
        "SALES_STORAGE_UNAVAILABLE");
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
      const migratedCategory = await runPg("psql", [
        "-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
        "-d", "hipos_features", "-t", "-A", "-c",
        `SELECT name FROM catalog.categories WHERE firm_id = '${legacyFirm}' AND id = 'legacy'`,
      ]);
      assert.equal(migratedCategory.stdout.trim(), "Eski Kategori");
      await startApi();
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
          ('55555555-5555-4555-8555-555555555501','${single}',NULL,'Tek Şube Pizza','PZZ-001','pizza','Pizzalar','published',ARRAY['pos'],'🍕',false,30000,'TRY','Tek firma ürünü',ARRAY[]::text[],ARRAY[]::text[],ARRAY['${singleBranch}'],'2026-10-05T09:30:00Z',1);
         INSERT INTO catalog.branch_prices (product_id,branch_id,amount_minor)
         VALUES ('${pizzaId}','${besiktas}',34000);`,
      ]);

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
        1,
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
        env: { ...process.env, VITE_FEATURE_PROVIDER: "http", VITE_CATALOG_PROVIDER: "http",
          VITE_API_BASE_URL: uiBase, HIPOS_DEV_API_TARGET: base },
        stdio: ["ignore", "pipe", "pipe"],
      });
      ui.stdout.on("data", (chunk) => { uiOutput += chunk; });
      ui.stderr.on("data", (chunk) => { uiOutput += chunk; });
      await waitForUi(uiBase, ui, () => uiOutput);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`${uiBase}/admin/catalog/categories`);
      await page.getByRole("combobox", { name: "Şube seçimi" }).selectOption("moda");
      await page.getByRole("row").filter({ hasText: "Tatlılar" }).waitFor();
      await page.goto(`${uiBase}/admin/catalog/products`);
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
        (await request(`${featurePath(moda)}/audit`)).data.length,
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
        (await request(`${featurePath(moda)}/audit`)).data.length,
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
      assert.equal(catalogMigrationCount.stdout.trim(), "4");
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

      // Ayrı test POS yüzü → gerçek API/PostgreSQL → yönetici salt okunur ekranı.
      assert.equal((await request(featurePath(moda, "sales.pos_orders"), "PUT", {
        desiredEnabled: true, expectedVersion: 3,
      })).status, 200);
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
      browser = await chromium.launch({ headless: true });
      const posPage = await browser.newPage();
      await posPage.goto(uiBase);
      await posPage.getByLabel("Test şubesi").selectOption("moda");
      await posPage.getByLabel("Yayınlanmış POS ürünü").selectOption(pizzaId);
      await posPage.getByLabel("Adet").fill("2");
      await posPage.getByRole("button", { name: "Sipariş oluştur" }).click();
      await posPage.getByText("Sipariş veritabanına kaydedildi.").waitFor();
      assert.equal((await request(salesList(moda))).data.items.length, 2);
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
      await managerPage.getByRole("heading", { name: "Canlı sipariş görünümü" }).waitFor();
      await managerPage.getByRole("row").filter({ hasText: "Margherita Pizza" }).first().waitFor();
      assert.equal(await managerPage.getByRole("button", { name: "Sipariş oluştur" }).count(), 0);
      await browser.close();
      browser = undefined;
      ui.kill("SIGTERM");
      await new Promise((resolve) => ui.once("exit", resolve));
      ui = undefined;
    } catch (error) {
      const pgOutput = await readFile(log, "utf8").catch(() => "");
      throw new Error(
        `${error.message}\nAPI: ${apiOutput}\nUI: ${uiOutput}\nPostgreSQL: ${pgOutput}`,
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
