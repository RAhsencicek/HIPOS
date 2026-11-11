#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const API_URL = (process.env.HIPOS_TEST_API_URL || "http://127.0.0.1:5180").replace(/\/+$/, "");
const ADMIN_URL = (process.env.HIPOS_TEST_ADMIN_URL || "http://127.0.0.1:5173").replace(/\/+$/, "");
const POS_URL = (process.env.HIPOS_TEST_POS_URL || "http://127.0.0.1:5176").replace(/\/+$/, "");
const PLATFORM_KEY = process.env.HIPOS_PLATFORM_ADMIN_KEY || "faz10-platform-admin-key-2026";
const DEMO_FIRM_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

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

async function createMockPrinterServer() {
  const chunks = [];
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    getBytes: () => Buffer.concat(chunks).length,
    getAsciiText: () =>
      Buffer.concat(chunks)
        .toString("latin1")
        .replace(/[^\x20-\x7E\n\r]/g, " "),
    clear: () => {
      chunks.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  };
}

async function waitUntil(fn, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await delay(100);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

async function createAndPublishProduct(token, firmId, branchId, { name, sku, categoryId, categoryName, amountMinor }) {
  const productId = randomUUID();
  const createRes = await apiJson(
    `${API_URL}/api/v1/firms/${firmId}/branches/${branchId}/catalog/products`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        draftId: productId,
        priceVersionId: randomUUID(),
        name,
        sku,
        categoryId,
        categoryName,
        description: `Faz 11 test urunu (${categoryName})`,
        amountMinor,
      }),
    },
  );
  assert.equal(createRes.status, 201, `Product create failed (${name}): ${JSON.stringify(createRes.body)}`);

  const pubRes = await apiJson(
    `${API_URL}/api/v1/firms/${firmId}/branches/${branchId}/catalog/drafts/${productId}/publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        publicationId: randomUUID(),
        expectedVersion: createRes.body.version,
      }),
    },
  );
  assert.equal(pubRes.status, 201, `Product publish failed (${name}): ${JSON.stringify(pubRes.body)}`);
  return productId;
}

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hipos-faz11-"));
  const servers = [];
  let bridgeProc = null;
  let browser = null;

  try {
    console.log(`1️⃣ Verifying local services (${API_URL}, ${ADMIN_URL}, ${POS_URL})...`);
    for (const url of [`${API_URL}/health`, ADMIN_URL, `${POS_URL}/waiter`]) {
      const res = await fetch(url);
      assert.ok(res.ok, `Service unreachable: ${url} (${res.status})`);
    }
    console.log("   ✅ API, Admin Vite, and POS Vite are all healthy.");

    console.log("2️⃣ Provisioning fresh Tenant 2 with 2 branches & starter Food/Drink catalog...");
    const ts = Date.now();
    const t2Email = `faz11-patron-${ts}@testlezzet.local`;
    const t2Password = "Secret1234!";
    const t2Pin = "7788";
    const t2OwnerName = `Faz11 Patron ${ts}`;

    const onboardRes = await apiJson(`${API_URL}/api/v1/onboarding/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Platform-Admin-Key": PLATFORM_KEY },
      body: JSON.stringify({
        firmName: `Test Lezzet ${ts}`,
        branchName: "Etiler Sube",
        ownerName: t2OwnerName,
        ownerEmail: t2Email,
        ownerPassword: t2Password,
        ownerPin: t2Pin,
        district: "Besiktas",
        initialTableCount: 6,
      }),
    });
    assert.equal(onboardRes.status, 201, `Onboarding failed: ${JSON.stringify(onboardRes.body)}`);
    const firm2 = onboardRes.body.firm.id;
    const branch2a = onboardRes.body.branch.id;

    const loginRes = await apiJson(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: t2Email, password: t2Password }),
    });
    assert.equal(loginRes.status, 200);
    const t2Token = loginRes.body.token;

    const branchBRes = await apiJson(`${API_URL}/api/v1/firms/${firm2}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
      body: JSON.stringify({ branchName: "Cadde Sube", district: "Kadikoy", initialTableCount: 4 }),
    });
    assert.equal(branchBRes.status, 201, `Second branch creation failed: ${JSON.stringify(branchBRes.body)}`);
    const branch2b = branchBRes.body.branch.id;
    const t2UpdatedToken = branchBRes.body.token ?? t2Token;
    console.log(`   ✅ Tenant 2 firm=${firm2}, branchA=${branch2a}, branchB=${branch2b}`);

    console.log("3️⃣ Verifying per-branch PostgreSQL printer profile isolation...");
    const saveA = await apiJson(`${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2UpdatedToken}` },
      body: JSON.stringify({
        kitchenIp: "192.168.10.10",
        kitchenPort: 9101,
        kitchenType: "Network",
      }),
    });
    assert.equal(saveA.status, 200);

    const saveB = await apiJson(`${API_URL}/api/v1/firms/${firm2}/branches/${branch2b}/printing/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2UpdatedToken}` },
      body: JSON.stringify({
        kitchenIp: "192.168.20.20",
        kitchenPort: 9102,
        kitchenType: "Network",
      }),
    });
    assert.equal(saveB.status, 200);

    const getA = await apiJson(`${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config`, {
      headers: { Authorization: `Bearer ${t2UpdatedToken}` },
    });
    const getB = await apiJson(`${API_URL}/api/v1/firms/${firm2}/branches/${branch2b}/printing/config`, {
      headers: { Authorization: `Bearer ${t2UpdatedToken}` },
    });
    assert.equal(getA.status, 200);
    assert.equal(getB.status, 200);
    assert.equal(getA.body.kitchenPrinter.ipAddress, "192.168.10.10");
    assert.equal(getA.body.kitchenPrinter.port, 9101);
    assert.equal(getB.body.kitchenPrinter.ipAddress, "192.168.20.20");
    assert.equal(getB.body.kitchenPrinter.port, 9102);
    console.log("   ✅ Branch A & Branch B store independent printing.printer_profiles in Postgres.");

    console.log("4️⃣ Verifying bridge role scoping & embedded bridge-script endpoint...");
    const bridgeTokenRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-token`,
      { method: "POST", headers: { Authorization: `Bearer ${t2Token}` } },
    );
    assert.equal(bridgeTokenRes.status, 200);
    const bridgeToken = bridgeTokenRes.body.token;

    const statusOwn = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-status`,
      { headers: { Authorization: `Bearer ${bridgeToken}` } },
    );
    assert.equal(statusOwn.status, 200);

    const hbOwn = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-heartbeat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridgeToken}` },
        body: JSON.stringify({ bridgeId: "probe", hostname: "probe-host", platform: "darwin" }),
      },
    );
    assert.equal(hbOwn.status, 200);

    const statusOtherBranch = await fetch(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2b}/printing/bridge-status`,
      { headers: { Authorization: `Bearer ${bridgeToken}` } },
    );
    assert.equal(statusOtherBranch.status, 403, "Bridge token for Branch A must return 403 on Branch B");

    const statusOtherTenant = await fetch(
      `${API_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/printing/bridge-status`,
      { headers: { Authorization: `Bearer ${bridgeToken}` } },
    );
    assert.equal(statusOtherTenant.status, 403, "Bridge token must return 403 on Tenant 1");

    const scriptRes = await fetch(`${API_URL}/api/v1/printing/bridge-script`);
    assert.equal(scriptRes.status, 200);
    const scriptBody = await scriptRes.text();
    assert.ok(scriptBody.includes("HIPOS PRINT BRIDGE"), "Expected embedded bridge script marker");
    console.log("   ✅ Bridge role isolation (own=200, cross-branch/tenant=403) & bridge-script verified.");

    console.log("5️⃣ Booting 4 mock TCP printers & connecting Print Bridge v2 via --config file...");
    const kitchenMock1 = await createMockPrinterServer();
    const kitchenMock2 = await createMockPrinterServer();
    const barMock = await createMockPrinterServer();
    const cashierMock = await createMockPrinterServer();
    servers.push(kitchenMock1, kitchenMock2, barMock, cashierMock);

    const cfgPath = path.join(tmpDir, "hipos-bridge.config.json");
    await fs.writeFile(
      cfgPath,
      JSON.stringify(
        {
          apiUrl: API_URL,
          firmId: firm2,
          branchId: branch2a,
          token: bridgeToken,
          heartbeatIntervalMs: 5000,
        },
        null,
        2,
      ),
      "utf8",
    );

    const branchCfgRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          deliveryMode: "CloudBridge",
          autoPrintKitchenOnOrder: true,
          autoSplitKitchenByStation: true,
          kitchenType: "Network",
          kitchenIp: "127.0.0.1",
          kitchenPort: kitchenMock1.port,
          kitchenEnabled: true,
          barEnabled: true,
          barType: "Network",
          barIp: "127.0.0.1",
          barPort: barMock.port,
          cashierType: "Network",
          cashierIp: "127.0.0.1",
          cashierPort: cashierMock.port,
          cashierEnabled: true,
        }),
      },
    );
    assert.equal(branchCfgRes.status, 200, `Config update failed: ${JSON.stringify(branchCfgRes.body)}`);
    assert.equal(branchCfgRes.body.deliveryMode, "CloudBridge");
    assert.equal(branchCfgRes.body.barPrinter.enabled, true);

    bridgeProc = spawn("node", ["scripts/hipos-print-bridge.mjs", "--config", cfgPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let bridgeLogs = "";
    bridgeProc.stdout.on("data", (d) => { bridgeLogs += d.toString(); });
    bridgeProc.stderr.on("data", (d) => { bridgeLogs += d.toString(); });

    await waitUntil(() => bridgeLogs.includes("Bağlantı aktif"), 10_000, "Print Bridge SSE connect");

    const liveBridgeStatus = await waitUntil(async () => {
      const res = await apiJson(
        `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-status`,
        { headers: { Authorization: `Bearer ${t2Token}` } },
      );
      if (res.status === 200 && res.body?.connected && res.body?.activeStreamCount >= 1 && res.body?.bridges?.length >= 1) {
        return res.body;
      }
      return null;
    }, 8_000, "bridge-status connected === true");

    assert.equal(liveBridgeStatus.bridges[0].hostname, os.hostname());
    console.log(`   ✅ Print Bridge online in Registry (hostname=${liveBridgeStatus.bridges[0].hostname}, streams=${liveBridgeStatus.activeStreamCount}).`);

    console.log("6️⃣ Verifying station split receipt routing (Food -> Kitchen, Drink -> Bar) & Cashier settlement bill...");
    const foodId = await createAndPublishProduct(t2Token, firm2, branch2a, {
      name: "Izgara Adana",
      sku: `ADANA-${ts}`,
      categoryId: "cat-food",
      categoryName: "Yiyecekler",
      amountMinor: 24000,
    });
    const drinkId = await createAndPublishProduct(t2Token, firm2, branch2a, {
      name: "Taze Limonata",
      sku: `LIMON-${ts}`,
      categoryId: "cat-drink",
      categoryName: "İçecekler",
      amountMinor: 7500,
    });

    const menuReqId = randomUUID();
    const createMenu = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/menus`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          requestId: menuReqId,
          expectedVersion: 0,
          name: "Ana Menu",
          description: "Etiler Sube menu",
          sections: [
            { sectionId: "sec-food", name: "Yiyecekler", productIds: [foodId] },
            { sectionId: "sec-drink", name: "Icecekler", productIds: [drinkId] },
          ],
        }),
      },
    );
    assert.ok(createMenu.status === 200 || createMenu.status === 201);
    const menuId = createMenu.body?.id ?? menuReqId;
    const actMenu = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/menus/${menuId}/activation`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({ requestId: randomUUID(), expectedVersion: createMenu.body.version ?? 1, isActive: true }),
      },
    );
    assert.equal(actMenu.status, 200);

    const waitersRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/service/waiters`,
      { headers: { Authorization: `Bearer ${t2Token}` } },
    );
    assert.equal(waitersRes.status, 200);
    const waiterId = waitersRes.body.items[0].id;

    const tablesRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/service/tables`,
      { headers: { Authorization: `Bearer ${t2Token}` } },
    );
    assert.equal(tablesRes.status, 200);
    const tableId = tablesRes.body.items[0].id;

    const orderRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/service/tables/${tableId}/orders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          orderId: randomUUID(),
          waiterId,
          items: [
            { productId: foodId, quantity: 1, notes: "Az acili" },
            { productId: drinkId, quantity: 2, notes: "Buzsuz" },
          ],
        }),
      },
    );
    assert.equal(orderRes.status, 201, `Order failed: ${JSON.stringify(orderRes.body)}`);

    await waitUntil(() => kitchenMock1.getBytes() > 0 && barMock.getBytes() > 0, 8_000, "Kitchen & Bar mock ESC/POS receipts");

    const kitchenText = kitchenMock1.getAsciiText();
    const barText = barMock.getAsciiText();
    assert.ok(kitchenText.includes("HIPOS MUTFAK"), `Kitchen receipt missing HIPOS MUTFAK:\n${kitchenText}`);
    assert.ok(kitchenText.includes("Izgara Adana"), `Kitchen receipt missing food item:\n${kitchenText}`);
    assert.ok(!kitchenText.includes("Taze Limonata"), `Kitchen receipt must NOT include drink item:\n${kitchenText}`);
    assert.ok(!kitchenText.includes("BAR / ICECEK"), `Kitchen receipt must NOT have Bar header:\n${kitchenText}`);

    assert.ok(barText.includes("BAR / ICECEK"), `Bar receipt missing BAR / ICECEK:\n${barText}`);
    assert.ok(barText.includes("Taze Limonata"), `Bar receipt missing drink item:\n${barText}`);
    assert.ok(!barText.includes("Izgara Adana"), `Bar receipt must NOT include food item:\n${barText}`);
    assert.ok(!barText.includes("HIPOS MUTFAK"), `Bar receipt must NOT have Kitchen header:\n${barText}`);
    console.log("   ✅ Station splitting verified: Kitchen got Izgara Adana only; Bar got Taze Limonata only.");

    const settleRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/service/tables/${tableId}/settle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({ paymentMethod: "NAKIT" }),
      },
    );
    assert.equal(settleRes.status, 200, `Settle failed: ${JSON.stringify(settleRes.body)}`);

    await waitUntil(() => cashierMock.getBytes() > 0, 8_000, "Cashier mock ESC/POS settlement bill");
    const cashierText = cashierMock.getAsciiText();
    assert.ok(
      cashierText.includes("Test Lezzet") || cashierText.includes("Etiler Sube"),
      `Cashier receipt missing real tenant firm/branch title:\n${cashierText}`,
    );
    assert.ok(!cashierText.includes("Lezzet Bistro"), "Cashier receipt must not hardcode Lezzet Bistro");
    console.log("   ✅ Cashier bill delivered over Print Bridge with Tenant 2's actual firm/branch header.");

    console.log("7️⃣ Verifying live printer.config.updated SSE push without restarting Print Bridge...");
    kitchenMock1.clear();
    kitchenMock2.clear();

    const updateKitchenPortRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          kitchenIp: "127.0.0.1",
          kitchenPort: kitchenMock2.port,
          kitchenType: "Network",
        }),
      },
    );
    assert.equal(updateKitchenPortRes.status, 200);
    await waitUntil(() => bridgeLogs.includes("Panelden yazıcı ayarı güncellendi"), 6_000, "bridge live config update");

    const testKitchenRes = await apiJson(
      `${API_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/test?target=kitchen`,
      { method: "POST", headers: { Authorization: `Bearer ${t2Token}` } },
    );
    assert.equal(testKitchenRes.status, 200);
    assert.equal(testKitchenRes.body.success, true);

    await waitUntil(() => kitchenMock2.getBytes() > 0, 8_000, "Kitchen Mock 2 live reloaded target");
    assert.equal(kitchenMock1.getBytes(), 0, "Old kitchen port must NOT receive ticket after live config push");
    console.log(`   ✅ Live SSE config reload routed test print from port ${kitchenMock1.port} -> ${kitchenMock2.port} with zero bridge restart.`);

    console.log("8️⃣ Running Playwright Browser E2E (Admin BranchesPage + POS Cashier + POS Waiter)...");
    browser = await chromium.launch({ headless: true });

    // Admin UI
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    adminPage.on("pageerror", (err) => console.error("[ADMIN PAGEERROR]", err));
    await adminPage.goto(`${ADMIN_URL}/`, { waitUntil: "networkidle" });
    await adminPage.fill('input[type="email"]', t2Email);
    await adminPage.fill('input[type="password"]', t2Password);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForFunction(
      (name) => !document.querySelector('input[type="email"]') && document.body.innerText.includes(name),
      t2OwnerName,
      { timeout: 10_000 },
    );

    await adminPage.goto(`${ADMIN_URL}/admin/admin/branches/list`, { waitUntil: "networkidle" });
    try {
      await adminPage.waitForSelector('button.branch-list-card:has-text("Etiler Sube")', { timeout: 10_000 });
    } catch (e) {
      console.error("[ADMIN BODY SNAPSHOT]", adminPage.url(), await adminPage.textContent("body"));
      throw e;
    }
    await adminPage.click('button.branch-list-card:has-text("Etiler Sube")');
    await adminPage.waitForFunction(
      () => document.body.innerText.includes("Print Bridge Çevrimiçi"),
      null,
      { timeout: 10_000 },
    );

    await adminPage.click('button:has-text("Yazıcı Köprüsü (Print Bridge) Tokenı Üret")');
    await adminPage.waitForSelector('button:has-text("hipos-bridge.config.json")', { timeout: 10_000 });
    await adminPage.waitForSelector('button:has-text("Windows (.bat)")', { timeout: 5_000 });
    await adminPage.waitForSelector('button:has-text("macOS (.command)")', { timeout: 5_000 });

    await adminPage.click('button:has-text("Şube Yazıcı Ayarlarını Kaydet")');
    await adminPage.waitForFunction(
      () => document.body.innerText.includes("Şube yazıcı ayarları kaydedildi"),
      null,
      { timeout: 10_000 },
    );
    await adminCtx.close();
    console.log("   ✅ Admin BranchesPage verified: live Bridge status, 3 config/launcher downloads, and inline printer save.");

    // POS UI (Cashier + Waiter)
    const posCtx = await browser.newContext();
    const posPage = await posCtx.newPage();

    await posPage.goto(`${POS_URL}/cashier?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`, {
      waitUntil: "networkidle",
    });
    for (const digit of t2Pin) {
      await posPage.locator(`button:text-is("${digit}")`).click();
    }
    await posPage.waitForSelector(".cashier-header-clean", { timeout: 10_000 });
    await delay(800);

    // Select Ana Kasa (MAIN) if initial station setup overlay appears
    const stationOverlay = posPage.locator("#station-assign-title");
    if (await stationOverlay.isVisible().catch(() => false)) {
      await posPage.locator(".morning-shift-card button.ops-primary").first().click();
      await delay(400);
    }

    // Dismiss morning shift opening overlay if displayed
    const skipShiftBtn = posPage.locator(".morning-skip-btn");
    if (await skipShiftBtn.isVisible().catch(() => false)) {
      await skipShiftBtn.click();
      await delay(300);
    }

    await posPage.click('button:has-text("Yazıcılar")');
    await posPage.waitForSelector("#printer-settings-title", { timeout: 10_000 });
    await posPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("Print Bridge Çevrimiçi") &&
          text.includes("Bar / İçecek Yazıcısı") &&
          text.includes("Bar IP Adresi")
        );
      },
      null,
      { timeout: 10_000 },
    );
    await posPage.click('button[aria-label="Kapat"]');
    await posPage.waitForSelector("#printer-settings-title", { state: "detached", timeout: 5_000 });
    console.log("   ✅ POS Cashier PrinterSettingsModal verified.");

    await posPage.goto(`${POS_URL}/waiter?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`, {
      waitUntil: "networkidle",
    });
    for (const digit of t2Pin) {
      await posPage.locator(`button:text-is("${digit}")`).click();
    }
    await posPage.waitForSelector(".waiter-table-grid", { timeout: 10_000 });
    await posPage.click('button:has-text("Yazıcı Ayarları")');
    await posPage.waitForSelector("#printer-settings-title", { timeout: 10_000 });
    await posPage.waitForFunction(
      () => {
        const text = document.body.innerText;
        return (
          text.includes("Print Bridge Çevrimiçi") &&
          text.includes("Mutfak + Bar + Kasa") &&
          text.includes("Ayrı Bar Yazıcısı Kullan")
        );
      },
      null,
      { timeout: 10_000 },
    );
    await posCtx.close();
    console.log("   ✅ POS Waiter PrinterSettingsModal verified.");

    console.log("\n🎉 ALL FAZ 11 MULTI-PRINTER, STATION SPLIT & LIVE BRIDGE E2E CHECKS PASSED!");
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (bridgeProc) bridgeProc.kill("SIGTERM");
    await Promise.all(servers.map((s) => s.close()));
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error("\n❌ FAZ 11 E2E FAILED:", err);
  process.exit(1);
});
