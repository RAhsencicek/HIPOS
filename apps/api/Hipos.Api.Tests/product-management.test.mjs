import assert from "node:assert/strict";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const projectDir = fileURLToPath(new URL("../Hipos.Api/", import.meta.url));
const firm = "11111111-1111-4111-8111-111111111111";
const branch = "33333333-3333-4333-8333-333333333333";

test("fiyatlı ürün kaydı, POS yayını ve yayımlanan fiyat değişikliği kalıcıdır", { timeout: 180000 }, async () => {
  const dbName = `hipos_product_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const buildDir = join(tmpdir(), `hipos-product-test-${randomUUID()}`);
  const connection = `Host=127.0.0.1;Port=5433;Database=${dbName};Username=hipos;Password=hipos-dev-only`;
  const env = { ...process.env, HIPOS_FEATURE_STORAGE: "postgres", HIPOS_FEATURES_CONNECTION: connection,
    ASPNETCORE_ENVIRONMENT: "Development", Logging__LogLevel__Default: "Warning" };
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const branchRoot = `/api/v1/firms/${firm}/branches/${branch}`;
  let api;
  let createdDb = false;
  let output = "";
  try {
    await execFile("docker", ["exec", "hipos-db-1", "createdb", "-U", "hipos", dbName]);
    createdDb = true;
    await execFile("dotnet", ["build", "--no-restore", "-c", "Release"], { cwd: projectDir, env });
    for (const context of ["FeatureDbContext", "CatalogDbContext"])
      await execFile("dotnet", ["ef", "database", "update", "--no-build", "--configuration", "Release", "--context", context], { cwd: projectDir, env })
        .catch(error => { throw new Error(`${context}: ${error.stdout ?? ""} ${error.stderr ?? ""}`); });
    await execFile("dotnet", ["ef", "database", "update", "20261015114911_SalesChecksNullableBackfill", "--no-build", "--configuration", "Release", "--context", "SalesDbContext"], { cwd: projectDir, env });
    for (const context of ["ServiceDbContext", "SalesDbContext"])
      await execFile("dotnet", ["ef", "database", "update", "--no-build", "--configuration", "Release", "--context", context], { cwd: projectDir, env });
    await execFile("dotnet", ["build", "--no-restore", "-c", "Release", "-o", buildDir], { cwd: projectDir, env });
    api = spawn("dotnet", [join(buildDir, "Hipos.Api.dll")], {
      cwd: projectDir, env: { ...env, ASPNETCORE_URLS: base }, windowsHide: true,
    });
    api.stdout.on("data", chunk => { output += chunk; });
    api.stderr.on("data", chunk => { output += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (api.exitCode !== null) break;
      try { if ((await fetch(`${base}/health`)).ok) { ready = true; break; } } catch { /* başlatılıyor */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `API başlamadı: ${output}`);
    async function request(path, method = "GET", body, actor = "manager-single") {
      const response = await fetch(`${base}${path}`, { method, headers: { "X-Demo-Actor": actor,
        ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    }
    const features = (await request(`${branchRoot}/features`)).data;
    for (const key of ["catalog.drafts", "catalog.price_drafts", "catalog.publishing", "sales.checks", "sales.pos_orders"]) {
      const state = features.find(item => item.key === key);
      const enabled = await request(`${branchRoot}/features/${key}`, "PUT", { desiredEnabled: true, expectedVersion: state.version });
      assert.equal(enabled.status, 200, JSON.stringify(enabled.data));
      assert.equal(enabled.data.effectiveForNewWork, true, key);
    }
    const categoryPath = `/api/v1/firms/${firm}/catalog/categories?branchId=${branch}`;
    assert.equal((await request(categoryPath, "POST", { id: "icecekler", name: "İçecekler" })).status, 201);
    const command = { draftId: randomUUID(), priceVersionId: randomUUID(), name: "Limonata", sku: "TEST-LIM",
      categoryId: "icecekler", categoryName: "İçecekler", description: "", amountMinor: 7550, allergens: ["süt", "gluten"] };
    const productPath = `${branchRoot}/catalog/products`;
    assert.equal((await request(productPath, "POST", { ...command, draftId: randomUUID(), priceVersionId: randomUUID(), amountMinor: 0 })).status, 400);
    const created = await request(productPath, "POST", command);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.price.amountMinor, 7550);
    assert.deepEqual(created.data.allergens, ["süt", "gluten"]);
    assert.equal(created.data.status, "draft");
    assert.equal((await request(productPath, "POST", command)).status, 200);
    assert.equal((await request(productPath, "POST", { ...command, amountMinor: 9000 })).status, 409);
    const publicationId = randomUUID();
    const published = await request(`${branchRoot}/catalog/drafts/${command.draftId}/publish`, "POST", { publicationId, expectedVersion: 1 });
    assert.equal(published.status, 201, JSON.stringify(published.data));
    const orderId = randomUUID();
    const order = await request(`${branchRoot}/sales/orders`, "POST", { orderId, items: [{ productId: command.draftId, quantity: 1 }] }, "pos-single");
    assert.equal(order.status, 201, JSON.stringify(order.data));
    assert.equal(order.data.items[0].unitPriceMinor, 7550);
    const checkRequest = { requestId: randomUUID(), firstOrderId: randomUUID(), items: [{ productId: command.draftId, quantity: 1 }], customerId: null, tableId: null, waiterId: null };
    const firstCheck = await request(`${branchRoot}/sales/checks`, "POST", checkRequest, "pos-single");
    assert.equal(firstCheck.status, 201, JSON.stringify(firstCheck.data));
    const repeatedCheck = await request(`${branchRoot}/sales/checks`, "POST", checkRequest, "pos-single");
    assert.equal(repeatedCheck.status, 200, JSON.stringify(repeatedCheck.data));
    assert.equal(repeatedCheck.data.id, firstCheck.data.id);
    const unfinished = await request(`${branchRoot}/sales/checks?unassignedOpen=true`, "GET", undefined, "pos-single");
    assert.equal(unfinished.status, 200, JSON.stringify(unfinished.data));
    assert.equal(unfinished.data.items.filter(check => check.id === firstCheck.data.id).length, 1);
    assert.ok(unfinished.data.items.every(check => check.status === "open" && check.tableId == null));
    const priceChange = { priceVersionId: randomUUID(), amountMinor: 9000, expectedVersion: published.data.product.version };
    const changed = await request(`${productPath}/${command.draftId}/price`, "PUT", priceChange);
    assert.equal(changed.status, 201, JSON.stringify(changed.data));
    assert.equal(changed.data.product.price.amountMinor, 9000);
    const oldOrder = await request(`${branchRoot}/sales/orders/${orderId}`, "GET", undefined, "pos-single");
    assert.equal(oldOrder.data.items[0].unitPriceMinor, 7550);
    const newOrder = await request(`${branchRoot}/sales/orders`, "POST", { orderId: randomUUID(), items: [{ productId: command.draftId, quantity: 1 }] }, "pos-single");
    assert.equal(newOrder.status, 201, JSON.stringify(newOrder.data));
    assert.equal(newOrder.data.items[0].unitPriceMinor, 9000);
    assert.equal((await request(`${productPath}/${command.draftId}/price`, "PUT", priceChange)).status, 200);
    assert.equal((await request(`${productPath}/${command.draftId}/price`, "PUT", { ...priceChange, amountMinor: 9100 })).status, 409);
    const history = (await request(`${productPath}/${command.draftId}/publications`)).data;
    assert.deepEqual(history.map(item => item.amountMinor), [7550, 9000]);
    const edit = { requestId: randomUUID(), name: "Taze Limonata", sku: "TEST-LIM", categoryId: "icecekler",
      categoryName: "İçecekler", description: "Güncellendi", allergens: ["süt"], expectedVersion: changed.data.product.version };
    const edited = await request(`${productPath}/${command.draftId}`, "PUT", edit);
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    assert.equal(edited.data.name, "Taze Limonata");
    assert.deepEqual(edited.data.allergens, ["süt"]);
    assert.equal((await request(`${productPath}/${command.draftId}`, "PUT", edit)).status, 200);
    assert.equal((await request(`${productPath}/${command.draftId}`, "PUT", { ...edit, name: "Farklı" })).data.code, "REQUEST_ID_CONFLICT");
    assert.equal((await request(`${branchRoot}/sales/orders/${orderId}`, "GET", undefined, "pos-single")).data.items[0].productName, "Limonata");
    const orderAfterEdit = await request(`${branchRoot}/sales/orders`, "POST", { orderId: randomUUID(), items: [{ productId: command.draftId, quantity: 1 }] }, "pos-single");
    assert.equal(orderAfterEdit.data.items[0].productName, "Taze Limonata");
    const stale = await request(`${productPath}/${command.draftId}/price`, "PUT", { priceVersionId: randomUUID(), amountMinor: 9500, expectedVersion: priceChange.expectedVersion });
    assert.equal(stale.data.code, "VERSION_CONFLICT");
    const invalid = await request(`${productPath}/${command.draftId}/price`, "PUT", { priceVersionId: randomUUID(), amountMinor: -1, expectedVersion: changed.data.product.version });
    assert.equal(invalid.status, 400);
    const competing = await Promise.all([9400, 9600].map(amountMinor => request(`${productPath}/${command.draftId}/price`, "PUT", {
      priceVersionId: randomUUID(), amountMinor, expectedVersion: edited.data.version,
    })));
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    const dbState = await execFile("docker", ["exec", "hipos-db-1", "psql", "-U", "hipos", "-d", dbName, "-t", "-A", "-c",
      `SELECT (SELECT unit_price_minor FROM sales.order_lines WHERE order_id='${orderId}') || ',' ||
              (SELECT count(*) FROM catalog.price_versions WHERE product_id='${command.draftId}') || ',' ||
              (SELECT count(*) FROM catalog.publications WHERE product_id='${command.draftId}') || ',' ||
              (SELECT count(*) FROM catalog.product_edit_audit WHERE product_id='${command.draftId}')`]);
    assert.equal(dbState.stdout.trim(), "7550,3,4,1");

    const another = { ...command, draftId: randomUUID(), priceVersionId: randomUUID(), name: "Kahve", sku: "TEST-COFFEE" };
    assert.equal((await request(productPath, "POST", another)).status, 201);
    const groupId = randomUUID();
    const groupPath = `/api/v1/firms/${firm}/catalog/option-groups`;
    assert.equal((await request(groupPath, "POST", { requestId: groupId, name: "Ekstralar", isActive: true, sortOrder: 0 })).status, 201);
    assert.equal((await request(`${groupPath}/${groupId}/items`, "POST", { requestId: randomUUID(), name: "Süt",
      priceDeltaMinor: 500, quantityEnabled: true, maxQuantity: 2, isActive: true, sortOrder: 0, expectedVersion: 1 })).status, 201);
    const groups = await request(`/api/v1/firms/${firm}/catalog/products/${another.draftId}/option-groups`, "PUT", {
      requestId: randomUUID(), expectedVersion: 1, items: [{ groupId, minSelections: 0, maxSelections: null, sortOrder: 0 }],
    });
    assert.equal(groups.status, 200, JSON.stringify(groups.data));
    assert.equal(groups.data.productVersion, 2);
    const scopedOptionsPath = `${branchRoot}/catalog/products/${another.draftId}/option-groups`;
    const scopedOptions = await request(scopedOptionsPath, "GET", undefined, "pos-single");
    assert.equal(scopedOptions.status, 200, JSON.stringify(scopedOptions.data));
    assert.equal(scopedOptions.data.items[0].groupId, groupId);
    assert.equal(scopedOptions.data.items[0].items[0].priceDeltaMinor, 500);
    assert.equal((await request(scopedOptionsPath, "GET", undefined, "pos-moda")).status, 403);
    assert.equal((await request(`${branchRoot}/catalog/products/${randomUUID()}/option-groups`, "GET", undefined, "pos-single")).status, 404);
    const draftPath = `${branchRoot}/catalog/drafts/${another.draftId}`;
    const updated = await request(draftPath, "PUT", { name: another.name, sku: another.sku, categoryId: another.categoryId,
      categoryName: another.categoryName, description: "Süt seçilebilir", allergens: ["süt"], expectedVersion: 2 });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.deepEqual(updated.data.allergens, ["süt"]);
    const activation = await request(`${productPath}/${another.draftId}/activation`, "POST", {
      requestId: randomUUID(), expectedVersion: updated.data.version, isActive: false,
    });
    assert.equal(activation.status, 200, JSON.stringify(activation.data));
    const afterActivation = await request(draftPath, "PUT", { name: another.name, sku: another.sku, categoryId: another.categoryId,
      categoryName: another.categoryName, description: "Güncellendi", expectedVersion: activation.data.version });
    assert.equal(afterActivation.status, 200, JSON.stringify(afterActivation.data));
    const imageId = randomUUID();
    const imagePath = `${productPath}/${another.draftId}/images`;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    async function uploadImage(id, version, bytes = png, actor = "manager-single") {
      const response = await fetch(`${base}${imagePath}?requestId=${id}&expectedVersion=${version}`, { method: "PUT",
        headers: { "X-Demo-Actor": actor, "Content-Type": "image/png" }, body: bytes });
      return { status: response.status, data: await response.json() };
    }
    assert.equal((await uploadImage(randomUUID(), afterActivation.data.version, Buffer.from("not an image"))).status, 400);
    assert.equal((await uploadImage(randomUUID(), afterActivation.data.version, png, "pos-single")).status, 403);
    const uploaded = await uploadImage(imageId, afterActivation.data.version);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.data));
    assert.equal(uploaded.data.version, afterActivation.data.version + 1);
    assert.equal((await uploadImage(imageId, afterActivation.data.version)).data.repeated, true);
    assert.equal((await uploadImage(imageId, afterActivation.data.version, Buffer.concat([png, Buffer.from([1])]))).data.code, "REQUEST_ID_CONFLICT");
    assert.equal((await uploadImage(randomUUID(), afterActivation.data.version)).data.code, "VERSION_CONFLICT");
    assert.equal((await uploadImage(randomUUID(), uploaded.data.version, Buffer.alloc(2 * 1024 * 1024 + 1))).status, 413);
    const imageResponse = await fetch(`${base}${imagePath}/${imageId}`, { headers: { "X-Demo-Actor": "pos-single" } });
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
    assert.equal((await fetch(`${base}${imagePath}/${imageId}`, { headers: { "X-Demo-Actor": "pos-moda" } })).status, 403);
    const imageProduct = await request(`/api/v1/firms/${firm}/catalog/products/${another.draftId}?branchId=${branch}`);
    assert.equal(imageProduct.data.image, `upload:${imageId}`);
    const draftAfterImage = await request(draftPath, "PUT", { name: another.name, sku: another.sku, categoryId: another.categoryId,
      categoryName: another.categoryName, description: "Görselle güncellendi", expectedVersion: uploaded.data.version });
    assert.equal(draftAfterImage.status, 200, JSON.stringify(draftAfterImage.data));
  } finally {
    if (api && api.exitCode === null) { api.kill(); await new Promise(resolve => api.once("exit", resolve)); }
    if (createdDb) await execFile("docker", ["exec", "hipos-db-1", "dropdb", "-U", "hipos", "--if-exists", "--force", dbName]);
    const resolvedBuildDir = resolve(buildDir);
    if (dirname(resolvedBuildDir) === resolve(tmpdir()) && basename(resolvedBuildDir).startsWith("hipos-product-test-"))
      await rm(resolvedBuildDir, { recursive: true, force: true });
  }
});
