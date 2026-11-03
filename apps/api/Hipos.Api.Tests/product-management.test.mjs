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
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch {
          throw new Error(`JSON parse failed on ${method} ${path} [${response.status}]: ${text}`);
        }
      }
      return { status: response.status, data };
    }
    const features = (await request(`${branchRoot}/features`)).data;
    for (const key of ["catalog.drafts", "catalog.price_drafts", "catalog.publishing", "sales.checks", "sales.pos_orders", "payments.simulator", "staff.records", "branches.tables", "service.waiters"]) {
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
    const waiterOrders = await request(`/api/v1/firms/${firm}/sales/orders?branchId=${branch}`, "GET", undefined, "pos-single");
    assert.equal(waiterOrders.status, 200, JSON.stringify(waiterOrders.data));
    assert.ok(waiterOrders.data.items.some(item => item.id === orderId));
    assert.equal((await request(`/api/v1/firms/${firm}/sales/orders?branchId=${branch}`, "GET", undefined, "pos-moda")).status, 403);
    assert.equal((await request(`/api/v1/firms/${firm}/sales/orders`, "GET", undefined, "pos-single")).status, 403);
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
    const testCheck = await request(`${branchRoot}/sales/checks`, "POST", { requestId: randomUUID(), firstOrderId: randomUUID(), items: [{ productId: command.draftId, quantity: 2 }] }, "pos-single");
    assert.equal(testCheck.status, 201, JSON.stringify(testCheck.data));
    const checkUrl = `${branchRoot}/sales/checks/${testCheck.data.id}`;
    const secondOrder = await request(`${checkUrl}/orders`, "POST", { orderId: randomUUID(), items: [{ productId: command.draftId, quantity: 1 }] }, "pos-single");
    assert.equal(secondOrder.status, 201, JSON.stringify(secondOrder.data));
    const initialCheck = secondOrder.data;
    const firstLine = initialCheck.orders.find(item => item.items[0].quantity === 2).items[0];
    const voided = await request(`${checkUrl}/adjustments`, "POST", { requestId: randomUUID(), expectedVersion: initialCheck.version, action: "void", orderLineId: firstLine.id, quantity: 1, reason: "Test iptali" }, "pos-single");
    assert.equal(voided.status, 201, JSON.stringify(voided.data));
    assert.deepEqual(voided.data.check.orders.map(item => item.remainingMinor).sort((a, b) => a - b), [7550, 7550]);
    const discounted = await request(`${checkUrl}/adjustments`, "POST", { requestId: randomUUID(), expectedVersion: voided.data.check.version, action: "discount", valueType: "fixed", value: 101, quantity: 0, reason: "Test indirimi" }, "pos-single");
    assert.equal(discounted.status, 201, JSON.stringify(discounted.data));
    assert.deepEqual(discounted.data.check.orders.map(item => item.remainingMinor).sort((a, b) => a - b), [7499, 7500]);
    for (const item of discounted.data.check.orders) {
      const payment = await request(`${checkUrl}/payment-attempts`, "POST", { orderId: item.id, attemptId: randomUUID(), amountMinor: item.remainingMinor, method: "cash", simulatedOutcome: "succeeded", expectedOrderVersion: item.version }, "pos-single");
      assert.equal(payment.status, 201, JSON.stringify(payment.data));
    }
    const completed = await request(checkUrl, "GET", undefined, "pos-single");
    assert.equal(completed.data.remainingMinor, 0);
    assert.equal(completed.data.status, "closed");
    const service = `${branchRoot}/service`;
    const waiter = await request(`${service}/waiters`, "POST", { name: "Test garson" });
    assert.equal(waiter.status, 201, JSON.stringify(waiter.data));
    const targetTable = await request(`${service}/tables`, "POST", { name: "Hedef" });
    const sourceTable = await request(`${service}/tables`, "POST", { name: "Kaynak" });
    assert.equal(targetTable.status, 201, JSON.stringify(targetTable.data));
    assert.equal(sourceTable.status, 201, JSON.stringify(sourceTable.data));
    const targetOrderId = randomUUID(), sourceOrderId = randomUUID();
    for (const [table, id] of [[targetTable.data.id, targetOrderId], [sourceTable.data.id, sourceOrderId]]) {
      const placed = await request(`${service}/tables/${table}/orders`, "POST", { orderId: id, waiterId: waiter.data.id, items: [{ productId: command.draftId, quantity: 2 }] }, "pos-single");
      assert.equal(placed.status, 201, JSON.stringify(placed.data));
    }
    const targetCheckUrl = `${branchRoot}/sales/checks/${targetOrderId}`, sourceCheckUrl = `${branchRoot}/sales/checks/${sourceOrderId}`;
    const sourceCheck = (await request(sourceCheckUrl)).data;
    const compRequest = { requestId: randomUUID(), expectedVersion: sourceCheck.version, action: "comp", orderLineId: sourceCheck.orders[0].items[0].id, quantity: 1, reason: "İkram" };
    const comp = await request(`${sourceCheckUrl}/adjustments`, "POST", compRequest, "pos-single");
    assert.equal(comp.status, 201, JSON.stringify(comp.data));
    const targetCheck = (await request(targetCheckUrl)).data;
    const discount = await request(`${targetCheckUrl}/adjustments`, "POST", { requestId: randomUUID(), expectedVersion: targetCheck.version, action: "discount", valueType: "fixed", value: 100, quantity: 0, reason: "İndirim" }, "pos-single");
    assert.equal(discount.status, 201, JSON.stringify(discount.data));
    const tables = (await request(`${service}/tables`)).data.items;
    const versions = Object.fromEntries(tables.filter(table => [targetTable.data.id, sourceTable.data.id].includes(table.id)).map(table => [table.id, table.assignment.version]));
    const mergeBody = { requestId: randomUUID(), sourceTableIds: [sourceTable.data.id], expectedVersions: versions };
    const merged = await request(`${service}/tables/${targetTable.data.id}/merge`, "POST", mergeBody, "pos-single");
    assert.equal(merged.status, 200, JSON.stringify(merged.data));
    const afterMerge = (await request(targetCheckUrl)).data;
    assert.equal(afterMerge.totalMinor, 4 * 7550 - 7550 - 100);
    assert.equal(afterMerge.adjustments.length, 2);
    assert.equal(afterMerge.adjustments.find(item => item.action === "comp").originalCheckId, sourceOrderId);
    assert.equal((await request(`${service}/tables/${targetTable.data.id}/merge`, "POST", mergeBody, "pos-single")).status, 200);
    assert.equal((await request(`${sourceCheckUrl}/adjustments`, "POST", compRequest, "pos-single")).status, 200);
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
      const text = await response.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch {
          throw new Error(`JSON parse failed on uploadImage [${response.status}]: ${text}`);
        }
      }
      return { status: response.status, data };
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

    const deletedCategory = await request(`/api/v1/firms/${firm}/catalog/categories/icecekler?branchId=${branch}&expectedVersion=1`, "DELETE");
    assert.equal(deletedCategory.status, 204, JSON.stringify(deletedCategory.data));
    const uncategorized = await request(`${productPath}/${another.draftId}?branchId=${branch}`);
    assert.equal(uncategorized.status, 200, JSON.stringify(uncategorized.data));
    assert.deepEqual(uncategorized.data.category, { id: "", name: "Kategorisiz" });
    const categoriesAfterDelete = await request(categoryPath);
    assert.equal(categoriesAfterDelete.data.items.some(category => category.id === "icecekler"), false);
    const deletedCategoryAudit = await execFile("docker", ["exec", "hipos-db-1", "psql", "-U", "hipos", "-d", dbName, "-t", "-A", "-c",
      `SELECT (SELECT count(*) FROM catalog.drafts WHERE id='${another.draftId}' AND category_id='') || ',' ||
              (SELECT count(*) FROM catalog.products WHERE id='${another.draftId}' AND category_id='' AND category_name='Kategorisiz') || ',' ||
              (SELECT count(*) FROM catalog.category_audit WHERE category_id='icecekler' AND action='deleted')`]);
    assert.equal(deletedCategoryAudit.stdout.trim(), "1,1,1");
  } finally {
    if (api && api.exitCode === null) { api.kill(); await new Promise(resolve => api.once("exit", resolve)); }
    if (createdDb) await execFile("docker", ["exec", "hipos-db-1", "dropdb", "-U", "hipos", "--if-exists", "--force", dbName]);
    const resolvedBuildDir = resolve(buildDir);
    if (dirname(resolvedBuildDir) === resolve(tmpdir()) && basename(resolvedBuildDir).startsWith("hipos-product-test-"))
      await rm(resolvedBuildDir, { recursive: true, force: true });
  }
});

test("ürün kanalı, herkese açık menü, planlanan fiyat ve kategori silme kalıcıdır", { timeout: 180000 }, async () => {
  const dbName = `hipos_category_delete_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const buildDir = join(tmpdir(), `hipos-category-delete-${randomUUID()}`);
  const connection = `Host=127.0.0.1;Port=5433;Database=${dbName};Username=hipos;Password=hipos-dev-only`;
  const env = { ...process.env, HIPOS_FEATURE_STORAGE: "postgres", HIPOS_FEATURES_CONNECTION: connection,
    HIPOS_PUBLIC_MENU__TOKEN: "test-qr-menu", HIPOS_PUBLIC_MENU__FIRM_ID: firm, HIPOS_PUBLIC_MENU__BRANCH_ID: branch,
    HIPOS_PUBLIC_MENU__RESTAURANT_NAME: "Test Restoran", HIPOS_PUBLIC_MENU__BRANCH_NAME: "Test Şubesi",
    ASPNETCORE_ENVIRONMENT: "Development", Logging__LogLevel__Default: "Warning" };
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const productId = randomUUID();
  let api;
  let createdDb = false;
  let output = "";
  try {
    await execFile("docker", ["exec", "hipos-db-1", "createdb", "-U", "hipos", dbName]);
    createdDb = true;
    await execFile("dotnet", ["build", "--no-restore", "-c", "Release"], { cwd: projectDir, env });
    for (const context of ["FeatureDbContext", "CatalogDbContext"])
      await execFile("dotnet", ["ef", "database", "update", "--no-build", "--configuration", "Release", "--context", context], { cwd: projectDir, env });
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
    const headers = { "X-Demo-Actor": "manager-single", "Content-Type": "application/json" };
    const categoryPath = `/api/v1/firms/${firm}/catalog/categories`;
    const createdCategory = await fetch(`${base}${categoryPath}?branchId=${branch}`, {
      method: "POST", headers, body: JSON.stringify({ id: "silinen-kategori", name: "Silinen Kategori" }),
    });
    assert.equal(createdCategory.status, 201, await createdCategory.text());
    await execFile("docker", ["exec", "hipos-db-1", "psql", "-U", "hipos", "-d", dbName, "-v", "ON_ERROR_STOP=1", "-c",
      `INSERT INTO catalog.products (id, firm_id, name, sku, category_id, category_name, status, is_active, channels, image, recipe_linked, base_price_minor, currency, description, allergens, option_groups, branch_ids, updated_at, version)
       VALUES ('${productId}', '${firm}', 'Test ürün', 'DELETE-TEST', 'silinen-kategori', 'Silinen Kategori', 'published', true, ARRAY['pos'], '', false, 1000, 'TRY', '', ARRAY[]::text[], ARRAY[]::text[], ARRAY['${branch}'], now(), 1)`]);
    const menuOne = randomUUID(), menuTwo = randomUUID(), emptyMenu = randomUUID(), inactiveMenu = randomUUID(), visibleId = randomUUID(), hiddenId = randomUUID(), inactiveId = randomUUID(), imageId = randomUUID(), hiddenImageId = randomUUID();
    await execFile("docker", ["exec", "hipos-db-1", "psql", "-U", "hipos", "-d", dbName, "-v", "ON_ERROR_STOP=1", "-c",
      `INSERT INTO catalog.products (id, firm_id, name, sku, category_id, category_name, status, is_active, channels, desired_channels, image, recipe_linked, base_price_minor, currency, description, allergens, option_groups, branch_ids, updated_at, version) VALUES
       ('${visibleId}', '${firm}', 'Görünür Ürün', 'QR-VISIBLE', 'silinen-kategori', 'Silinen Kategori', 'published', true, ARRAY['pos'], ARRAY['qr'], 'upload:${imageId}', false, 2400, 'TRY', 'Taze hazırlanır', ARRAY['Süt'], ARRAY[]::text[], ARRAY['${branch}'], now(), 1),
       ('${hiddenId}', '${firm}', 'Gizli Ürün', 'QR-HIDDEN', 'silinen-kategori', 'Silinen Kategori', 'published', true, ARRAY['pos'], ARRAY['pos'], 'upload:${hiddenImageId}', false, 1000, 'TRY', '', ARRAY[]::text[], ARRAY[]::text[], ARRAY['${branch}'], now(), 1),
       ('${inactiveId}', '${firm}', 'Pasif Ürün', 'QR-INACTIVE', 'silinen-kategori', 'Silinen Kategori', 'published', false, ARRAY['pos'], ARRAY['qr'], '', false, 1000, 'TRY', '', ARRAY[]::text[], ARRAY[]::text[], ARRAY['${branch}'], now(), 1);
       INSERT INTO catalog.product_images (request_id, product_id, firm_id, branch_id, content_type, content, fingerprint, expected_version, version, actor, created_at) VALUES ('${imageId}', '${visibleId}', '${firm}', '${branch}', 'image/png', decode('89504e470d0a1a0a','hex'), 'test', 1, 1, 'test', now()), ('${hiddenImageId}', '${hiddenId}', '${firm}', '${branch}', 'image/png', decode('89504e470d0a1a0a','hex'), 'test', 1, 1, 'test', now());
       INSERT INTO catalog.menus (id,firm_id,branch_id,name,description,is_active,version,created_at,updated_at) VALUES ('${menuOne}','${firm}','${branch}','Ana Menü','',true,1,now(),now()), ('${menuTwo}','${firm}','${branch}','İçecekler','',true,1,now(),now()), ('${emptyMenu}','${firm}','${branch}','Boş Menü','',true,1,now(),now()), ('${inactiveMenu}','${firm}','${branch}','Pasif Menü','',false,1,now(),now());
       INSERT INTO catalog.menu_sections (menu_id,section_id,name,sort_order) VALUES ('${menuOne}','first','Yemekler',0), ('${menuTwo}','second','İçecekler',0), ('${inactiveMenu}','third','Gizli',0);
       INSERT INTO catalog.menu_items (menu_id,section_id,product_id,sort_order) VALUES ('${menuOne}','first','${productId}',0), ('${menuOne}','first','${hiddenId}',1), ('${menuOne}','first','${inactiveId}',2), ('${menuTwo}','second','${visibleId}',0), ('${inactiveMenu}','third','${visibleId}',0);`]);
    assert.equal((await fetch(`${base}/api/v1/public/menus/bad-token`)).status, 404);
    const publicResponse = await fetch(`${base}/api/v1/public/menus/test-qr-menu`);
    assert.equal(publicResponse.status, 200, await publicResponse.clone().text());
    const publicMenu = await publicResponse.json();
    assert.equal(publicMenu.restaurantName, "Test Restoran");
    assert.deepEqual(publicMenu.menus.map(menu => menu.name), ["Ana Menü", "Boş Menü", "İçecekler"]);
    assert.deepEqual(publicMenu.menus.flatMap(menu => menu.sections.flatMap(section => section.products.map(product => product.name))), ["Test ürün", "Görünür Ürün"]);
    assert.deepEqual(publicMenu.menus[1].sections, []);
    const qrProduct = publicMenu.menus[2].sections[0].products[0];
    assert.equal(qrProduct.description, "Taze hazırlanır");
    assert.deepEqual(qrProduct.allergens, ["Süt"]);
    assert.equal(qrProduct.price.amountMinor, 2400);
    assert.equal("sku" in qrProduct, false);
    const publicImage = await fetch(`${base}${qrProduct.imageUrl}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/api/v1/public/menus/bad-token/products/${visibleId}/images/${imageId}`)).status, 404);
    assert.equal((await fetch(`${base}/api/v1/public/menus/test-qr-menu/products/${hiddenId}/images/${hiddenImageId}`)).status, 404);
    const featuresPath = `${base}/api/v1/firms/${firm}/branches/${branch}/features`;
    const featureResponse = await fetch(featuresPath, { headers });
    const features = await featureResponse.json();
    for (const key of ["catalog.drafts", "catalog.price_drafts", "catalog.publishing", "sales.checks", "sales.pos_orders"]) {
      const feature = features.find(item => item.key === key);
      if (!feature.desiredEnabled) {
        const enabled = await fetch(`${featuresPath}/${key}`, { method: "PUT", headers, body: JSON.stringify({ desiredEnabled: true, expectedVersion: feature.version }) });
        assert.equal(enabled.status, 200, await enabled.text());
      }
    }
    const channelPath = `${base}/api/v1/firms/${firm}/branches/${branch}/catalog/products/${productId}/channels`;
    const channelCommand = { requestId: randomUUID(), expectedVersion: 1, desiredChannels: ["qr"] };
    const setChannels = () => fetch(channelPath, { method: "PUT", headers, body: JSON.stringify(channelCommand) });
    const channelResult = await setChannels();
    assert.equal(channelResult.status, 200, await channelResult.clone().text());
    assert.deepEqual((await channelResult.json()).desiredChannels, ["qr"]);
    const replay = await setChannels();
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json()).version, 2);
    const denied = await fetch(channelPath, { method: "PUT", headers: { ...headers, "X-Demo-Actor": "pos-single" }, body: JSON.stringify(channelCommand) });
    assert.equal(denied.status, 403);
    const order = await fetch(`${base}/api/v1/firms/${firm}/branches/${branch}/sales/orders`, { method: "POST", headers: { ...headers, "X-Demo-Actor": "pos-single" }, body: JSON.stringify({ orderId: randomUUID(), items: [{ productId, quantity: 1 }] }) });
    assert.equal(order.status, 409, await order.clone().text());
    assert.equal((await order.json()).code, "PRODUCT_NOT_SELLABLE");
    const restore = await fetch(channelPath, { method: "PUT", headers, body: JSON.stringify({ requestId: randomUUID(), expectedVersion: 2, desiredChannels: ["pos", "qr"] }) });
    assert.equal(restore.status, 200, await restore.clone().text());
    const enabledOrder = await fetch(`${base}/api/v1/firms/${firm}/branches/${branch}/sales/orders`, { method: "POST", headers: { ...headers, "X-Demo-Actor": "pos-single" }, body: JSON.stringify({ orderId: randomUUID(), items: [{ productId, quantity: 1 }] }) });
    assert.equal(enabledOrder.status, 201, await enabledOrder.text());
    const scheduledPath = `${base}/api/v1/firms/${firm}/branches/${branch}/catalog/scheduled-prices`;
    const scheduleId = randomUUID();
    const scheduleCommand = { requestId: scheduleId, productId, amountMinor: 1700, effectiveAt: new Date(Date.now() + 6000).toISOString(), expectedVersion: 3 };
    const schedule = await fetch(scheduledPath, { method: "POST", headers, body: JSON.stringify(scheduleCommand) });
    assert.equal(schedule.status, 200, await schedule.clone().text());
    const replaySchedule = await fetch(scheduledPath, { method: "POST", headers, body: JSON.stringify(scheduleCommand) });
    assert.equal(replaySchedule.status, 200, await replaySchedule.clone().text());
    const differentSchedule = await fetch(scheduledPath, { method: "POST", headers, body: JSON.stringify({ ...scheduleCommand, amountMinor: 1800 }) });
    assert.equal(differentSchedule.status, 409);
    const forbiddenSchedule = await fetch(scheduledPath, { method: "POST", headers: { ...headers, "X-Demo-Actor": "pos-single" }, body: JSON.stringify(scheduleCommand) });
    assert.equal(forbiddenSchedule.status, 403);
    const manualPrice = await fetch(`${base}/api/v1/firms/${firm}/branches/${branch}/catalog/products/${productId}/price`, { method: "PUT", headers, body: JSON.stringify({ priceVersionId: randomUUID(), amountMinor: 1200, expectedVersion: 3 }) });
    assert.equal(manualPrice.status, 201, await manualPrice.clone().text());
    let planStatus = "pending";
    for (let i = 0; i < 30 && planStatus === "pending"; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const plans = await fetch(scheduledPath, { headers });
      const plan = (await plans.json()).find(item => item.id === scheduleId);
      planStatus = plan.status === "processing" ? "pending" : plan.status;
    }
    assert.equal(planStatus, "applied");
    const currentPrice = await fetch(`${base}/api/v1/firms/${firm}/catalog/products/${productId}?branchId=${branch}`, { headers });
    assert.equal((await currentPrice.json()).price.amountMinor, 1700);
    const sequenceIds = [randomUUID(), randomUUID()];
    const baseTime = Date.now() + 4000;
    for (const [index, id] of sequenceIds.entries()) {
      const sequence = await fetch(scheduledPath, { method: "POST", headers, body: JSON.stringify({ requestId: id, productId, amountMinor: 1800 + index * 100, effectiveAt: new Date(baseTime + index * 2000).toISOString(), expectedVersion: 5 }) });
      assert.equal(sequence.status, 200, await sequence.clone().text());
    }
    let appliedCount = 0;
    for (let i = 0; i < 35 && appliedCount < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const plans = await fetch(scheduledPath, { headers });
      appliedCount = (await plans.json()).filter(item => sequenceIds.includes(item.id) && item.status === "applied").length;
    }
    assert.equal(appliedCount, 2);
    const finalPrice = await fetch(`${base}/api/v1/firms/${firm}/catalog/products/${productId}?branchId=${branch}`, { headers });
    assert.equal((await finalPrice.json()).price.amountMinor, 1900);
    const cancelId = randomUUID();
    const cancelPlan = await fetch(scheduledPath, { method: "POST", headers, body: JSON.stringify({ requestId: cancelId, productId, amountMinor: 2200, effectiveAt: new Date(Date.now() + 60000).toISOString(), expectedVersion: 7 }) });
    assert.equal(cancelPlan.status, 200, await cancelPlan.clone().text());
    const cancelled = await fetch(`${scheduledPath}/${cancelId}/cancel`, { method: "POST", headers });
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    const plansAfterCancel = await fetch(scheduledPath, { headers });
    assert.equal((await plansAfterCancel.json()).find(item => item.id === cancelId).status, "cancelled");
    const secondCategory = await fetch(`${base}${categoryPath}?branchId=${branch}`, { method: "POST", headers, body: JSON.stringify({ id: "z-test", name: "Z Test" }) });
    assert.equal(secondCategory.status, 201);
    const activePath = `${base}${categoryPath}/silinen-kategori/active?branchId=${branch}`;
    const inactive = await fetch(activePath, { method: "PUT", headers, body: JSON.stringify({ isActive: false, expectedVersion: 1 }) });
    assert.equal(inactive.status, 200, await inactive.clone().text());
    assert.equal((await inactive.json()).isActive, false);
    const inactiveCreate = await fetch(`${base}/api/v1/firms/${firm}/branches/${branch}/catalog/products`, { method: "POST", headers,
      body: JSON.stringify({ draftId: randomUUID(), priceVersionId: randomUUID(), name: "Pasif kategori testi", sku: "INACTIVE-TEST", categoryId: "silinen-kategori", categoryName: "Silinen Kategori", description: "", amountMinor: 1000 }) });
    assert.equal(inactiveCreate.status, 409);
    assert.equal((await inactiveCreate.json()).code, "CATEGORY_INACTIVE");
    const stale = await fetch(activePath, { method: "PUT", headers, body: JSON.stringify({ isActive: true, expectedVersion: 1 }) });
    assert.equal(stale.status, 409);
    const afterInactive = await fetch(`${base}/api/v1/firms/${firm}/catalog/products/${productId}?branchId=${branch}`, { headers });
    assert.equal((await afterInactive.json()).isActive, true);
    const activeAgain = await fetch(activePath, { method: "PUT", headers, body: JSON.stringify({ isActive: true, expectedVersion: 2 }) });
    assert.equal(activeAgain.status, 200);
    let categoriesResponse = await fetch(`${base}${categoryPath}?branchId=${branch}`, { headers });
    let categories = (await categoriesResponse.json()).items;
    const targetIndex = categories.findIndex(item => item.id === "silinen-kategori");
    const neighbor = categories[targetIndex + 1];
    assert.ok(neighbor);
    const move = await fetch(`${base}${categoryPath}/silinen-kategori/position?branchId=${branch}`, { method: "PUT", headers,
      body: JSON.stringify({ neighborId: neighbor.id, expectedVersion: categories[targetIndex].version, neighborVersion: neighbor.version }) });
    assert.equal(move.status, 204, await move.text());
    categoriesResponse = await fetch(`${base}${categoryPath}?branchId=${branch}`, { headers });
    categories = (await categoriesResponse.json()).items;
    assert.equal(categories.findIndex(item => item.id === "silinen-kategori"), targetIndex + 1);
    const currentVersion = categories.find(item => item.id === "silinen-kategori").version;
    const deleted = await fetch(`${base}${categoryPath}/silinen-kategori?branchId=${branch}&expectedVersion=${currentVersion}`, { method: "DELETE", headers });
    assert.equal(deleted.status, 204, await deleted.text());
    const product = await fetch(`${base}/api/v1/firms/${firm}/catalog/products/${productId}?branchId=${branch}`, { headers });
    assert.equal(product.status, 200, await product.clone().text());
    const details = await product.json();
    assert.deepEqual(details.category, { id: "", name: "Kategorisiz" });
    const databaseState = await execFile("docker", ["exec", "hipos-db-1", "psql", "-U", "hipos", "-d", dbName, "-t", "-A", "-c",
      `SELECT category_id || ',' || category_name || ',' || version FROM catalog.products WHERE id='${productId}'`]);
    assert.equal(databaseState.stdout.trim(), ",Kategorisiz,8");
  } finally {
    if (api && api.exitCode === null) { api.kill(); await new Promise(resolve => api.once("exit", resolve)); }
    if (createdDb) await execFile("docker", ["exec", "hipos-db-1", "dropdb", "-U", "hipos", "--if-exists", "--force", dbName]);
    const resolvedBuildDir = resolve(buildDir);
    if (dirname(resolvedBuildDir) === resolve(tmpdir()) && basename(resolvedBuildDir).startsWith("hipos-category-delete-"))
      await rm(resolvedBuildDir, { recursive: true, force: true });
  }
});
