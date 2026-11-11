#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile as execFileCb, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFile = promisify(execFileCb);

const CLOUD_API_URL = process.env.HIPOS_API_URL ?? "http://127.0.0.1:5180";
const ADMIN_URL = process.env.HIPOS_ADMIN_URL ?? "http://127.0.0.1:5173";
const POS_URL = process.env.HIPOS_POS_URL ?? "http://127.0.0.1:5176";
const PLATFORM_KEY = process.env.HIPOS_PLATFORM_ADMIN_KEY ?? "faz10-platform-admin-key-2026";
const JWT_SECRET = process.env.HIPOS_JWT_SECRET ?? "faz10-local-dev-super-strong-secret-key-2026-at-least-48-chars!";
const SYNC_TOKEN = process.env.HIPOS_CLOUD_SYNC_TOKEN ?? "faz13-local-sync-token-2026";
const PG_HOST = process.env.HIPOS_PG_HOST ?? "127.0.0.1";
const PG_PORT = process.env.HIPOS_PG_PORT ?? "5433";
const PG_USER = process.env.HIPOS_PG_USER ?? "hipos";
const PG_PASSWORD = process.env.HIPOS_PG_PASSWORD ?? "hipos-dev-only";
const API_DLL = "apps/api/Hipos.Api/bin/Debug/net10.0/Hipos.Api.dll";
const API_CSPROJ = "apps/api/Hipos.Api/Hipos.Api.csproj";

const ALL_DB_CONTEXTS = [
  "FeatureDbContext",
  "CatalogDbContext",
  "SalesDbContext",
  "CariDbContext",
  "ServiceDbContext",
  "InventoryDbContext",
  "CashDbContext",
  "ExpenseDbContext",
  "AuthDbContext",
  "KitchenDbContext",
  "OverviewDbContext",
  "PrintingDbContext",
  "SyncDbContext",
];

async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

async function waitUntil(fn, timeoutMs = 15_000, description = "condition") {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastErr = err;
    }
    await delay(200);
  }
  throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms${lastErr ? `: ${lastErr.message}` : ""}`);
}

async function waitForHealth(baseUrl, timeoutMs = 25_000) {
  await waitUntil(async () => {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  }, timeoutMs, `${baseUrl}/health`);
}

function createMockPrinterServer(fixedPort = 0) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const server = net.createServer((socket) => {
      socket.on("data", (data) => chunks.push(Buffer.from(data)));
    });
    server.on("error", reject);
    server.listen(fixedPort, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        getBuffer: () => Buffer.concat(chunks),
        getText: () => Buffer.concat(chunks).toString("latin1"),
        getBytes: () => chunks.reduce((acc, c) => acc + c.length, 0),
        reset: () => { chunks.length = 0; },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function reserveUnusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createToggleCloudProxy(upstreamBaseUrl) {
  let online = false;
  const server = http.createServer(async (req, res) => {
    if (!online) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "CLOUD_UNREACHABLE", message: "Simulated internet outage" }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuf = Buffer.concat(chunks);
    try {
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) {
        const lk = k.toLowerCase();
        if (lk === "host" || lk === "content-length" || lk === "transfer-encoding" || lk === "connection" || lk === "keep-alive" || lk === "expect") {
          continue;
        }
        headers[k] = v;
      }
      const upstreamRes = await fetch(`${upstreamBaseUrl}${req.url}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : bodyBuf,
      });
      const respBuf = Buffer.from(await upstreamRes.arrayBuffer());
      const outHeaders = {};
      upstreamRes.headers.forEach((v, k) => {
        if (k.toLowerCase() !== "transfer-encoding") outHeaders[k] = v;
      });
      res.writeHead(upstreamRes.status, outHeaders);
      res.end(respBuf);
    } catch (err) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(err instanceof Error ? `${err.message}: ${err.cause?.message ?? ""}` : "Bad gateway");
    }
  });
  return {
    listen: () => new Promise((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    }),
    setOnline: (value) => { online = value; },
    isOnline: () => online,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function createAndPublishProduct(apiUrl, token, firmId, branchId, { name, sku, categoryId, categoryName, amountMinor }) {
  const draftId = randomUUID();
  const draftRes = await apiJson(
    `${apiUrl}/api/v1/firms/${firmId}/branches/${branchId}/catalog/drafts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        draftId,
        name,
        sku,
        categoryId,
        categoryName,
        description: `${name} aciklama`,
      }),
    },
  );
  assert.ok(draftRes.status === 200 || draftRes.status === 201, `Draft failed (${name}): ${JSON.stringify(draftRes.body)}`);

  const priceRes = await apiJson(
    `${apiUrl}/api/v1/firms/${firmId}/branches/${branchId}/catalog/drafts/${draftId}/price`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        priceVersionId: randomUUID(),
        amountMinor,
        expectedVersion: draftRes.body.version,
      }),
    },
  );
  assert.ok(priceRes.status === 200 || priceRes.status === 201, `Price failed (${name}): ${JSON.stringify(priceRes.body)}`);

  const pubRes = await apiJson(
    `${apiUrl}/api/v1/firms/${firmId}/branches/${branchId}/catalog/drafts/${draftId}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        publicationId: randomUUID(),
        expectedVersion: priceRes.body.product.version,
      }),
    },
  );
  assert.ok(pubRes.status === 200 || pubRes.status === 201, `Publish failed (${name}): ${JSON.stringify(pubRes.body)}`);
  return draftId;
}

async function setupActiveMenu(apiUrl, token, firmId, branchId, menuName, products) {
  const menuReqId = randomUUID();
  const createMenu = await apiJson(
    `${apiUrl}/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestId: menuReqId,
        expectedVersion: 0,
        name: menuName,
        description: "Test menu",
        sections: [{ sectionId: "sec-main", name: "Ana Yemekler", productIds: products }],
      }),
    },
  );
  assert.ok(createMenu.status === 200 || createMenu.status === 201);
  const menuId = createMenu.body?.id ?? menuReqId;
  const actMenu = await apiJson(
    `${apiUrl}/api/v1/firms/${firmId}/branches/${branchId}/catalog/menus/${menuId}/activation`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: randomUUID(), expectedVersion: createMenu.body.version ?? 1, isActive: true }),
    },
  );
  assert.equal(actMenu.status, 200);
}

async function runPsql(database, sql) {
  const { stdout } = await execFile("psql", [
    "-h", PG_HOST,
    "-p", PG_PORT,
    "-U", PG_USER,
    "-d", database,
    "-tAc", sql,
  ], { env: { ...process.env, PGPASSWORD: PG_PASSWORD } });
  return stdout.trim();
}

async function run() {
  const ts = Date.now();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hipos-faz12-13-"));
  const lanDbName = `hipos_lan_test_${ts}`;
  const servers = [];
  const children = [];
  let browser = null;
  let cloudProxy = null;

  try {
    console.log("1️⃣ Verifying cloud services & CLI bridge flags...");
    for (const url of [`${CLOUD_API_URL}/health`, ADMIN_URL, `${POS_URL}/waiter`]) {
      const res = await fetch(url);
      assert.ok(res.ok, `Service unreachable: ${url} (${res.status})`);
    }
    const { stdout: helpOut } = await execFile("node", ["scripts/hipos-print-bridge.mjs", "--help"]);
    assert.ok(helpOut.includes("--dry-run") && helpOut.includes("--spool-file"));
    console.log("   ✅ Services healthy & bridge --help verified.");

    // =========================================================================
    // PART A: FAZ 12 — PRINT BRIDGE RESILIENCE, VOID, DRAWER, Z-REPORT, HID, SSE
    // =========================================================================
    console.log("2️⃣ Onboarding Faz 12 test tenant & preparing hardware mocks...");
    const ownerEmail = `faz12-owner-${ts}@lezzet.local`;
    const ownerPassword = "Secret1234!";
    const ownerPin = "7788";
    const onboardRes = await apiJson(`${CLOUD_API_URL}/api/v1/onboarding/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Platform-Admin-Key": PLATFORM_KEY },
      body: JSON.stringify({
        firmName: `Faz12 Restoran ${ts}`,
        branchName: "Merkez",
        ownerName: "Faz12 Patron",
        ownerEmail,
        ownerPassword,
        ownerPin,
        district: "Kadikoy",
        initialTableCount: 4,
      }),
    });
    assert.equal(onboardRes.status, 201, `Onboard failed: ${JSON.stringify(onboardRes.body)}`);
    const firmId = onboardRes.body.firm.id;
    const branchId = onboardRes.body.branch.id;

    const loginRes = await apiJson(`${CLOUD_API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
    });
    assert.equal(loginRes.status, 200);
    const token = loginRes.body.token;

    const bridgeTokenRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/printing/bridge-token`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(bridgeTokenRes.status, 200);
    const bridgeToken = bridgeTokenRes.body.token;

    const deadKitchenPort = await reserveUnusedPort();
    const cashierMock = await createMockPrinterServer();
    servers.push(cashierMock);

    const cfgPath = path.join(tmpDir, "faz12-bridge.config.json");
    await fs.writeFile(cfgPath, JSON.stringify({
      apiUrl: CLOUD_API_URL,
      firmId,
      branchId,
      token: bridgeToken,
      heartbeatIntervalMs: 3000,
    }, null, 2));

    const printCfgRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/printing/config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          deliveryMode: "CloudBridge",
          autoPrintKitchenOnOrder: true,
          autoSplitKitchenByStation: false,
          kitchenType: "Network",
          kitchenIp: "127.0.0.1",
          kitchenPort: deadKitchenPort,
          kitchenEnabled: true,
          cashierType: "Network",
          cashierIp: "127.0.0.1",
          cashierPort: cashierMock.port,
          cashierEnabled: true,
        }),
      },
    );
    assert.equal(printCfgRes.status, 200);

    const spoolPath = path.join(tmpDir, "spool.json");
    const bridge1 = spawn("node", [
      "scripts/hipos-print-bridge.mjs",
      "--config", cfgPath,
      "--spool-file", spoolPath,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    children.push(bridge1);
    let bridge1Logs = "";
    bridge1.stdout.on("data", (d) => { bridge1Logs += d.toString(); });
    bridge1.stderr.on("data", (d) => { bridge1Logs += d.toString(); });
    await waitUntil(() => bridge1Logs.includes("Bağlantı aktif"), 12_000, "bridge1 SSE connect");

    const adanaSku = `8690001${ts.toString().slice(-6)}`;
    const adanaId = await createAndPublishProduct(CLOUD_API_URL, token, firmId, branchId, {
      name: "Izgara Adana",
      sku: adanaSku,
      categoryId: "cat-food",
      categoryName: "Yiyecekler",
      amountMinor: 24000,
    });
    const sisId = await createAndPublishProduct(CLOUD_API_URL, token, firmId, branchId, {
      name: "Tavuk Sis",
      sku: `8690002${ts.toString().slice(-6)}`,
      categoryId: "cat-food",
      categoryName: "Yiyecekler",
      amountMinor: 20000,
    });
    await setupActiveMenu(CLOUD_API_URL, token, firmId, branchId, "Faz12 Menu", [adanaId, sisId]);

    const waitersRes = await apiJson(`${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/service/waiters`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const waiterId = waitersRes.body.items[0].id;
    const tablesRes = await apiJson(`${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/service/tables`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const table1Id = tablesRes.body.items[0].id;
    const table2Id = tablesRes.body.items[1].id;

    console.log("3️⃣ Testing Print Bridge retry spool recovery when kitchen TCP printer comes back online...");
    const check1ReqId = randomUUID();
    const check1OrderId = randomUUID();
    const check1Res = await apiJson(`${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestId: check1ReqId,
        firstOrderId: check1OrderId,
        items: [
          { productId: adanaId, quantity: 1 },
          { productId: sisId, quantity: 1 },
        ],
        customerId: null,
        tableId: table1Id,
        waiterId,
      }),
    });
    assert.equal(check1Res.status, 201, `Check 1 failed: ${JSON.stringify(check1Res.body)}`);
    const check1Id = check1Res.body.id;

    // Wait for bridge to detect failure and persist job to spoolPath
    await waitUntil(async () => {
      try {
        const raw = await fs.readFile(spoolPath, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length >= 1;
      } catch {
        return false;
      }
    }, 10_000, "spool file populated on dead printer");

    // Bring kitchen TCP printer online on the exact previously dead port!
    const revivedKitchenMock = await createMockPrinterServer(deadKitchenPort);
    servers.push(revivedKitchenMock);

    await waitUntil(() => revivedKitchenMock.getText().includes("Izgara Adana"), 12_000, "spooled ticket flushed to revived printer");
    await waitUntil(async () => {
      try {
        const raw = await fs.readFile(spoolPath, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.length === 0;
      } catch (err) {
        return err?.code === "ENOENT";
      }
    }, 10_000, "spool cleared after retry recovery");
    console.log("   ✅ Offline printer spooled to disk & automatically recovered once TCP came online.");

    console.log("4️⃣ Testing line void -> kitchen cancelled + void ticket & full check cancel...");
    const sisLine = check1Res.body.orders[0].items.find((l) => l.productName === "Tavuk Sis");
    assert.ok(sisLine, "Expected Tavuk Sis line on check 1");
    revivedKitchenMock.reset();

    const voidRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks/${check1Id}/adjustments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: check1Res.body.version,
          action: "void",
          orderLineId: sisLine.id,
          quantity: 1,
          reason: "Müşteri vazgeçti",
          managerPin: ownerPin,
        }),
      },
    );
    assert.equal(voidRes.status, 201, `Line void failed: ${JSON.stringify(voidRes.body)}`);
    assert.equal(voidRes.body.check.totalMinor, 24000, "Remaining check total after voiding 200 TL Tavuk Sis must be 240 TL");

    await waitUntil(() => revivedKitchenMock.getText().includes("IPTAL BILETI"), 8_000, "void ticket printed");
    assert.ok(revivedKitchenMock.getText().includes("Tavuk"), "Void ticket must include cancelled product name");

    const tasksAfterVoid = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks?status=cancelled`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(tasksAfterVoid.status, 200);
    assert.ok(tasksAfterVoid.body.items.some((t) => t.productName === "Tavuk Sis" && t.status === "cancelled"));

    // Create check 2 and cancel the entire check
    revivedKitchenMock.reset();
    const check2Res = await apiJson(`${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        firstOrderId: randomUUID(),
        items: [{ productId: sisId, quantity: 1 }],
        customerId: null,
        tableId: table2Id,
        waiterId,
      }),
    });
    assert.equal(check2Res.status, 201);
    const check2Id = check2Res.body.id;

    await waitUntil(() => revivedKitchenMock.getText().includes("Tavuk"), 8_000, "check2 initial kitchen ticket");
    revivedKitchenMock.reset();

    const cancelRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks/${check2Id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          expectedVersion: check2Res.body.version,
          reason: "Yanlis masa acilisi",
          managerPin: ownerPin,
        }),
      },
    );
    assert.equal(cancelRes.status, 200, `Cancel check failed: ${JSON.stringify(cancelRes.body)}`);
    assert.equal(cancelRes.body.check.status, "closed");
    const tasksAfterCancel = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks?status=cancelled`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(tasksAfterCancel.status, 200);
    assert.ok(tasksAfterCancel.body.items.length >= 2, "Expected both line-void and full-check-cancel tasks in cancelled list");
    await waitUntil(() => revivedKitchenMock.getText().includes("IPTAL BILETI"), 8_000, "full check cancel void ticket");
    console.log("   ✅ Line void & check cancel updated totals, marked KDS tasks cancelled, and printed ESC/POS IPTAL BILETI.");

    // Switch bridge1 to dry-run bridge2 for preview capture + drawer/Z-report verification alongside cashierMock
    bridge1.kill("SIGTERM");
    await delay(300);

    const previewDir = path.join(tmpDir, "previews");
    const bridgeDry = spawn("node", [
      "scripts/hipos-print-bridge.mjs",
      "--config", cfgPath,
      "--dry-run",
      "--preview-dir", previewDir,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    children.push(bridgeDry);
    let bridgeDryLogs = "";
    bridgeDry.stdout.on("data", (d) => { bridgeDryLogs += d.toString(); });
    bridgeDry.stderr.on("data", (d) => { bridgeDryLogs += d.toString(); });
    await waitUntil(() => bridgeDryLogs.includes("[DRY-RUN MODU]") && bridgeDryLogs.includes("Bağlantı aktif"), 10_000, "dry-run bridge ready");

    // Verify DirectLan fallback or CloudBridge preview capture on open-drawer and settle + close shift
    const overviewBefore = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/cash/overview`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(overviewBefore.status, 200);
    let regId = overviewBefore.body.registers?.[0]?.id;
    if (!regId) {
      const defReg = await apiJson(
        `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/cash/registers/default`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ requestId: randomUUID() }),
        },
      );
      assert.ok(defReg.status === 200 || defReg.status === 201);
      regId = defReg.body.register.id;
    }

    // Open cash shift, verify dry-run preview on RJ11 open-drawer + Z-report print
    const shiftId = randomUUID();
    const openShiftRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/cash/shifts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: shiftId, registerId: regId, openingCashMinor: 50000, note: "Sabah acilis" }),
      },
    );
    assert.equal(openShiftRes.status, 201);

    console.log("5️⃣ Running Playwright Browser E2E (Cashier Drawer, HID Barcode, Z-Report, Waiter Ready Toast)...");
    browser = await chromium.launch({ headless: true });

    // Waiter context + Cashier context
    const waiterCtx = await browser.newContext();
    const waiterPage = await waiterCtx.newPage();
    await waiterPage.goto(`${POS_URL}/waiter?firmId=${encodeURIComponent(firmId)}&branchId=${encodeURIComponent(branchId)}`, {
      waitUntil: "networkidle",
    });
    for (const d of ownerPin) await waiterPage.locator(`button:text-is("${d}")`).click();
    await waiterPage.waitForSelector(".pos-sync-pill", { timeout: 10_000 });

    // Move remaining Izgara Adana kitchen task from submitted -> preparing -> ready and verify Waiter SSE toast!
    const activeTasksRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks?status=active`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const adanaTask = activeTasksRes.body.items.find((t) => t.productName === "Izgara Adana");
    assert.ok(adanaTask, "Expected active Adana task");

    const prepRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks/${adanaTask.id}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: randomUUID(), nextStatus: "preparing", expectedVersion: adanaTask.version }),
      },
    );
    assert.equal(prepRes.status, 200);
    const readyRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks/${adanaTask.id}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId: randomUUID(), nextStatus: "ready", expectedVersion: prepRes.body.version }),
      },
    );
    assert.equal(readyRes.status, 200);

    await waiterPage.waitForFunction(
      () => document.body.innerText.includes("HAZIR:") && document.body.innerText.includes("Izgara Adana"),
      null,
      { timeout: 10_000 },
    );
    await waiterCtx.close();
    console.log("   ✅ Waiter SSE HAZIR notification toast rendered automatically in floor view.");

    // Cashier context: Quick sale barcode scan, cash drawer kick, settle Adana check & print Z-Report
    const cashierCtx = await browser.newContext();
    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto(`${POS_URL}/cashier?firmId=${encodeURIComponent(firmId)}&branchId=${encodeURIComponent(branchId)}`, {
      waitUntil: "networkidle",
    });
    for (const d of ownerPin) await cashierPage.locator(`button:text-is("${d}")`).click();
    await cashierPage.waitForSelector(".cashier-header-clean", { timeout: 10_000 });
    await delay(500);
    if (await cashierPage.locator("#station-assign-title").isVisible().catch(() => false)) {
      await cashierPage.locator(".morning-shift-card button.ops-primary").first().click();
      await delay(300);
    }

    // Switch to Quick Sale & test HID barcode scan (<75ms intervals)
    await cashierPage.click('button.cashier-seg-btn:has-text("Hızlı Satış")');
    await delay(400);
    for (const ch of adanaSku) {
      await cashierPage.keyboard.press(ch);
      await delay(15);
    }
    await cashierPage.keyboard.press("Enter");
    await cashierPage.waitForFunction(
      () => document.querySelector(".quick-cart-inline-list")?.textContent?.includes("Izgara Adana"),
      null,
      { timeout: 8_000 },
    );
    console.log("   ✅ Quick Sale HID USB barcode scan automatically matched SKU and added to cart.");

    // Trigger manual cash drawer button in Cashier header -> check --dry-run preview captured [RJ11-CEKMECE-AC]
    await cashierPage.click('button:has-text("Çekmece")');
    await waitUntil(async () => {
      try {
        const files = await fs.readdir(previewDir);
        for (const f of files) {
          const content = await fs.readFile(path.join(previewDir, f), "utf8");
          if (content.includes("[RJ11-CEKMECE-AC]")) return true;
        }
        return false;
      } catch {
        return false;
      }
    }, 10_000, "dry-run preview captures [RJ11-CEKMECE-AC]");
    console.log("   ✅ Cashier RJ11 cash drawer pulse captured via --dry-run preview.");

    // Also test real DirectLan RJ11 byte delivery to cashierMock on open-drawer
    const rawDrawerCheck = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/printing/config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deliveryMode: "DirectLan" }),
      },
    );
    assert.equal(rawDrawerCheck.status, 200);
    cashierMock.reset();
    const drawerApi = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/printing/open-drawer`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(drawerApi.status, 200);
    assert.equal(drawerApi.body.success, true);
    await waitUntil(() => cashierMock.getBytes() >= 5, 5_000, "cashierMock RJ11 bytes");
    const pulseBytes = cashierMock.getBuffer();
    assert.ok(pulseBytes.includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])), "Exact RJ11 ESC/POS kick bytes expected");

    // Settle Check 1 via API so shift can be closed and Z-Report tested from UI
    const check1Refreshed = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks/${check1Id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const payOrder = check1Refreshed.body.orders[0];
    const payRes = await apiJson(
      `${CLOUD_API_URL}/api/v1/firms/${firmId}/branches/${branchId}/sales/checks/${check1Id}/payment-attempts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          orderId: payOrder.id,
          attemptId: randomUUID(),
          amountMinor: check1Refreshed.body.remainingMinor,
          method: "cash",
          simulatedOutcome: "succeeded",
          expectedOrderVersion: payOrder.version,
          postToCash: true,
          registerId: regId,
        }),
      },
    );
    assert.ok(payRes.status === 200 || payRes.status === 201, `Payment failed: ${JSON.stringify(payRes.body)}`);

    // Switch back to tables view and reload to pick up closed check & open shift, then close shift from Cashier UI & click Fiş Yazdır!
    cashierMock.reset();
    await cashierPage.reload({ waitUntil: "networkidle" });
    await cashierPage.click('button:has-text("Vardiyayı Kapat")');
    await cashierPage.getByLabel("Kasada sayılan fiziksel nakit (TL)").fill("740");
    await cashierPage.click('button:has-text("Say ve vardiyayı kapat")');
    await cashierPage.waitForSelector('#z-report-title', { timeout: 10_000 });
    await cashierPage.click('button:has-text("Fiş Yazdır")');
    await waitUntil(() => cashierMock.getText().includes("GUN SONU Z-RAPORU"), 8_000, "Z-report printed to thermal mock");
    await cashierCtx.close();
    bridgeDry.kill("SIGTERM");
    console.log("   ✅ Real Z-Report thermal printout (GUN SONU Z-RAPORU) triggered cleanly from Cashier UI.");

    // =========================================================================
    // PART B: FAZ 13 — HYBRID LAN HUB, SYNC OUTBOX, IDEMPOTENCY & UI PILL
    // =========================================================================
    console.log(`6️⃣ Creating clean LAN Hub database (${lanDbName}) & booting LAN Hub (:5185) + POS (:5178)...`);
    await execFile("createdb", ["-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, lanDbName], {
      env: { ...process.env, PGPASSWORD: PG_PASSWORD },
    });
    const lanConnStr = `Host=${PG_HOST};Port=${PG_PORT};Database=${lanDbName};Username=${PG_USER};Password=${PG_PASSWORD}`;
    for (const ctx of ALL_DB_CONTEXTS) {
      await execFile("dotnet", [
        "tool", "run", "dotnet-ef", "database", "update", "--no-build", "--project", API_CSPROJ, "--context", ctx,
      ], {
        env: { ...process.env, HIPOS_FEATURE_STORAGE: "postgres", HIPOS_FEATURES_CONNECTION: lanConnStr },
      });
    }

    cloudProxy = createToggleCloudProxy(CLOUD_API_URL);
    const proxyPort = await cloudProxy.listen();
    const lanPort = 5185;
    const lanApiUrl = `http://127.0.0.1:${lanPort}`;
    const lanPosPort = 5178;
    const lanPosUrl = `http://127.0.0.1:${lanPosPort}`;

    const lanApiProc = spawn("dotnet", [API_DLL], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: "Development",
        ASPNETCORE_URLS: `http://127.0.0.1:${lanPort}`,
        HIPOS_ALLOW_DEMO_ACTOR: "false",
        HIPOS_JWT_SECRET: JWT_SECRET,
        HIPOS_PLATFORM_ADMIN_KEY: PLATFORM_KEY,
        HIPOS_FEATURE_STORAGE: "postgres",
        HIPOS_FEATURES_CONNECTION: lanConnStr,
        HIPOS_CLOUD_SYNC_URL: `http://127.0.0.1:${proxyPort}`,
        HIPOS_CLOUD_SYNC_TOKEN: SYNC_TOKEN,
        HIPOS_SYNC_NODE_ID: "lan-hub-e2e-01",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(lanApiProc);
    let lanApiLog = "";
    lanApiProc.stderr.on("data", (d) => { lanApiLog += d.toString(); });
    lanApiProc.stdout.on("data", (d) => { lanApiLog += d.toString(); });
    await waitForHealth(lanApiUrl);

    const lanViteProc = spawn("npx", [
      "vite", "--config", "apps/pos/vite.config.ts", "apps/pos", "--host", "127.0.0.1", "--port", String(lanPosPort), "--strictPort",
    ], {
      cwd: process.cwd(),
      env: { ...process.env, HIPOS_DEV_API_TARGET: lanApiUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(lanViteProc);
    await waitUntil(async () => {
      const r = await fetch(`${lanPosUrl}/waiter`);
      return r.ok;
    }, 15_000, "LAN Vite POS :5178 ready");

    // Onboard LAN tenant locally while Cloud proxy is OFFLINE!
    const lanEmail = `lan-owner-${ts}@kasa.local`;
    const lanPin = "8899";
    const lanOnboard = await apiJson(`${lanApiUrl}/api/v1/onboarding/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Platform-Admin-Key": PLATFORM_KEY },
      body: JSON.stringify({
        firmName: `LAN Restoran ${ts}`,
        branchName: "Kadikoy Hub",
        ownerName: "LAN Patron",
        ownerEmail: lanEmail,
        ownerPassword: ownerPassword,
        ownerPin: lanPin,
        district: "Kadikoy",
        initialTableCount: 3,
      }),
    });
    assert.equal(lanOnboard.status, 201);
    const lanFirmId = lanOnboard.body.firm.id;
    const lanBranchId = lanOnboard.body.branch.id;

    const lanLogin = await apiJson(`${lanApiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: lanEmail, password: ownerPassword }),
    });
    const lanToken = lanLogin.body.token;
    const lanProdId = await createAndPublishProduct(lanApiUrl, lanToken, lanFirmId, lanBranchId, {
      name: "Mercimek Corbasi",
      sku: `CORBA-${ts}`,
      categoryId: "cat-food",
      categoryName: "Yiyecekler",
      amountMinor: 11000,
    });
    await setupActiveMenu(lanApiUrl, lanToken, lanFirmId, lanBranchId, "LAN Menu", [lanProdId]);
    const lanWaiterId = (await apiJson(`${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/service/waiters`, {
      headers: { Authorization: `Bearer ${lanToken}` },
    })).body.items[0].id;
    const lanTableId = (await apiJson(`${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/service/tables`, {
      headers: { Authorization: `Bearer ${lanToken}` },
    })).body.items[0].id;

    console.log("7️⃣ Creating check offline (Cloud proxy DOWN) & verifying sync.outbox pending + yellow POS UI pill...");
    assert.equal(cloudProxy.isOnline(), false);
    const lanCheckRes = await apiJson(`${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sales/checks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lanToken}` },
      body: JSON.stringify({
        requestId: randomUUID(),
        firstOrderId: randomUUID(),
        items: [{ productId: lanProdId, quantity: 2 }],
        customerId: null,
        tableId: lanTableId,
        waiterId: lanWaiterId,
      }),
    });
    assert.equal(lanCheckRes.status, 201);

    const outboxBefore = await apiJson(
      `${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sync/outbox?status=pending`,
      { headers: { Authorization: `Bearer ${lanToken}` } },
    );
    assert.equal(outboxBefore.status, 200);
    assert.ok(outboxBefore.body.items.some((e) => e.eventType === "check.created"), "Outbox must queue check.created locally");
    const outboxEventId = outboxBefore.body.items[0].eventId;
    const outboxPayloadHash = outboxBefore.body.items[0].payloadHash;

    // Trigger immediate flush attempt while Cloud is DOWN so CloudReachable=false & uiState=lan_pending
    await apiJson(
      `${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sync/flush`,
      { method: "POST", headers: { Authorization: `Bearer ${lanToken}` } },
    );
    const statusOffline = await apiJson(
      `${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sync/status`,
      { headers: { Authorization: `Bearer ${lanToken}` } },
    );
    assert.equal(statusOffline.status, 200);
    assert.equal(statusOffline.body.nodeMode, "lan_hub");
    assert.equal(statusOffline.body.cloudReachable, false);
    assert.equal(statusOffline.body.uiState, "lan_pending");
    assert.ok(statusOffline.body.pendingCount >= 1);

    // Open POS Waiter & Cashier on :5178 in Chromium -> verify Yellow "Yerel Ağda · Bulut Bekliyor" pill
    const lanCtx = await browser.newContext();
    const lanPage = await lanCtx.newPage();
    await lanPage.goto(`${lanPosUrl}/waiter?firmId=${encodeURIComponent(lanFirmId)}&branchId=${encodeURIComponent(lanBranchId)}`, {
      waitUntil: "networkidle",
    });
    for (const d of lanPin) await lanPage.locator(`button:text-is("${d}")`).click();
    await lanPage.waitForSelector('.pos-sync-pill[data-sync-state="lan_pending"]', { timeout: 10_000 });
    const pillTextOffline = await lanPage.locator(".pos-sync-pill").innerText();
    assert.ok(pillTextOffline.includes("Yerel Ağda"), `Unexpected offline badge text: ${pillTextOffline}`);
    console.log(`   ✅ UI displays yellow local badge offline: "${pillTextOffline}"`);

    console.log("8️⃣ Restoring Cloud connectivity, clicking Sync Pill -> verifying Cloud persistence & idempotency...");
    cloudProxy.setOnline(true);
    await lanPage.locator(".pos-sync-pill").click();
    try {
      await lanPage.waitForSelector('.pos-sync-pill[data-sync-state="online_synced"]', { timeout: 12_000 });
    } catch (waitErr) {
      const pillState = await lanPage.locator(".pos-sync-pill").getAttribute("data-sync-state").catch(() => null);
      const pillText = await lanPage.locator(".pos-sync-pill").innerText().catch(() => null);
      const diagStatus = await apiJson(
        `${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sync/status`,
        { headers: { Authorization: `Bearer ${lanToken}` } },
      ).catch(() => null);
      const diagOutbox = await apiJson(
        `${lanApiUrl}/api/v1/firms/${lanFirmId}/branches/${lanBranchId}/sync/outbox`,
        { headers: { Authorization: `Bearer ${lanToken}` } },
      ).catch(() => null);
      console.error("DIAG pillState:", pillState, "pillText:", pillText);
      console.error("DIAG /sync/status:", JSON.stringify(diagStatus?.body));
      console.error("DIAG /sync/outbox:", JSON.stringify(diagOutbox?.body));
      console.error("DIAG lanApiLog tail:\n", lanApiLog.slice(-2500));
      throw waitErr;
    }
    const pillTextOnline = await lanPage.locator(".pos-sync-pill").innerText();
    assert.ok(pillTextOnline.includes("Bulut Bağlı"), `Unexpected synced badge text: ${pillTextOnline}`);
    await lanCtx.close();

    // Verify Cloud postgres sync.inbound_events received the event
    const inboundCount = await runPsql(
      "hipos_features",
      `SELECT count(*) FROM sync.inbound_events WHERE event_id = '${outboxEventId}'::uuid;`,
    );
    assert.equal(Number(inboundCount), 1, `Expected event ${outboxEventId} in Cloud sync.inbound_events`);

    // Verify replay idempotency (duplicate: true) & payload conflict (IDEMPOTENCY_CONFLICT) on Cloud :5180
    const replayRes = await apiJson(`${CLOUD_API_URL}/api/v1/sync/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": SYNC_TOKEN },
      body: JSON.stringify({
        events: [{
          eventId: outboxEventId,
          firmId: lanFirmId,
          branchId: lanBranchId,
          aggregateType: "check",
          aggregateId: lanCheckRes.body.id,
          partitionKey: `${lanFirmId}:${lanBranchId}:check:${lanCheckRes.body.id}`,
          eventType: "check.created",
          payloadJson: "{}",
          payloadHash: outboxPayloadHash,
          schemaVersion: 1,
          idempotencyKey: "replay",
          originNodeId: "lan-hub-e2e-01",
          createdAt: new Date().toISOString(),
        }],
      }),
    });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.results[0].status, "acked");
    assert.equal(replayRes.body.results[0].duplicate, true);

    const conflictRes = await apiJson(`${CLOUD_API_URL}/api/v1/sync/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": SYNC_TOKEN },
      body: JSON.stringify({
        events: [{
          eventId: outboxEventId,
          firmId: lanFirmId,
          branchId: lanBranchId,
          aggregateType: "check",
          aggregateId: lanCheckRes.body.id,
          partitionKey: `${lanFirmId}:${lanBranchId}:check:${lanCheckRes.body.id}`,
          eventType: "check.created",
          payloadJson: "{\"tampered\":true}",
          payloadHash: "0000000000000000000000000000000000000000000000000000000000000000",
          schemaVersion: 1,
          idempotencyKey: "conflict",
          originNodeId: "lan-hub-e2e-01",
          createdAt: new Date().toISOString(),
        }],
      }),
    });
    assert.equal(conflictRes.status, 200);
    assert.equal(conflictRes.body.results[0].status, "conflict");
    assert.equal(conflictRes.body.results[0].code, "IDEMPOTENCY_CONFLICT");

    console.log("   ✅ LAN Hub flush, Cloud sync.inbound_events persistence, duplicate replay, and conflict guard verified!");
    console.log("\n🎉 ALL FAZ 12 & FAZ 13 E2E TESTS PASSED!");
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    if (cloudProxy) await cloudProxy.close().catch(() => {});
    for (const s of servers) await s.close().catch(() => {});
    await execFile("psql", [
      "-h", PG_HOST, "-p", PG_PORT, "-U", PG_USER, "-d", "postgres",
      "-c", `DROP DATABASE IF EXISTS "${lanDbName}" WITH (FORCE);`,
    ], { env: { ...process.env, PGPASSWORD: PG_PASSWORD } }).catch(() => {});
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error("❌ Faz 12/13 E2E failed:", err);
  process.exit(1);
});
