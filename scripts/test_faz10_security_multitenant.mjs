#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const API_DLL = "apps/api/Hipos.Api/bin/Debug/net10.0/Hipos.Api.dll";
const DB_CONN = "Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only";
const PROD_PORT = 5189;
const PROD_URL = `http://127.0.0.1:${PROD_PORT}`;
const STRONG_SECRET = "faz10-prod-jwt-secret-key-at-least-48-characters-long-2026!!";
const PLATFORM_KEY = "faz10-platform-admin-key-2026";
const DEMO_FIRM_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

function spawnApiProcess(envOverrides) {
  return spawn("dotnet", [API_DLL], {
    cwd: process.cwd(),
    env: { ...process.env, ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(baseUrl, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`API failed to respond at ${baseUrl}/health within ${timeoutMs}ms`);
}

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

async function run() {
  const children = [];
  let tcpServer = null;
  let browser = null;

  try {
    console.log("1️⃣ Production startup: testing weak JWT secret rejection...");
    const weakProc = spawnApiProcess({
      ASPNETCORE_ENVIRONMENT: "Production",
      ASPNETCORE_URLS: "http://127.0.0.1:5190",
      HIPOS_JWT_SECRET: "short-secret",
      HIPOS_FEATURE_STORAGE: "postgres",
      HIPOS_FEATURES_CONNECTION: DB_CONN,
    });
    const weakExit = await Promise.race([
      new Promise((resolve) => weakProc.on("exit", (code) => resolve(code))),
      delay(10_000).then(() => "TIMEOUT"),
    ]);
    if (weakExit === "TIMEOUT") {
      weakProc.kill("SIGKILL");
      throw new Error("Expected Production API with weak HIPOS_JWT_SECRET to fail fast, but it stayed running.");
    }
    assert.notEqual(weakExit, 0, "Expected non-zero exit code for weak HIPOS_JWT_SECRET in Production");
    console.log(`   ✅ Weak JWT secret correctly aborted startup (exit=${weakExit}).`);

    console.log(`2️⃣ Booting Production API on ${PROD_URL}...`);
    const prodProc = spawnApiProcess({
      ASPNETCORE_ENVIRONMENT: "Production",
      ASPNETCORE_URLS: PROD_URL,
      HIPOS_JWT_SECRET: STRONG_SECRET,
      HIPOS_PLATFORM_ADMIN_KEY: PLATFORM_KEY,
      HIPOS_FEATURE_STORAGE: "postgres",
      HIPOS_FEATURES_CONNECTION: DB_CONN,
    });
    children.push(prodProc);
    let prodStderr = "";
    prodProc.stderr.on("data", (chunk) => { prodStderr += chunk.toString(); });
    await waitForHealth(PROD_URL);
    console.log("   ✅ Production API started cleanly.");

    console.log("3️⃣ Verifying unauthenticated & X-Demo-Actor lockdown (expecting 401)...");
    const protectedGets = [
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/features`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/printing/config`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/overview/cash-profit`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/overview/activities`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/overview/alerts`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/sales/checks`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/sales/orders?branchId=${DEMO_BRANCH_ID}`,
      `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/service/tables`,
    ];

    for (const url of protectedGets) {
      const noAuth = await fetch(url);
      assert.equal(noAuth.status, 401, `Expected 401 for anonymous ${url}, got ${noAuth.status}`);

      const demoPos = await fetch(url, { headers: { "X-Demo-Actor": "pos-single" } });
      assert.equal(demoPos.status, 401, `Expected 401 for X-Demo-Actor: pos-single on ${url}, got ${demoPos.status}`);

      const demoMgr = await fetch(url, { headers: { "X-Demo-Actor": "manager-single" } });
      assert.equal(demoMgr.status, 401, `Expected 401 for X-Demo-Actor: manager-single on ${url}, got ${demoMgr.status}`);

      const forgedJwt = await fetch(url, {
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.forgedsignature" },
      });
      assert.equal(forgedJwt.status, 401, `Expected 401 for forged JWT on ${url}, got ${forgedJwt.status}`);
    }

    const sseDemo = await fetch(`${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/events/stream?actor=pos-single`);
    assert.equal(sseDemo.status, 401, "Expected 401 for SSE ?actor=pos-single in Production");
    console.log("   ✅ All protected endpoints & SSE returned 401 for demo actors and forged JWTs.");

    console.log("4️⃣ Verifying Tenant 1 login, onboarding guard (403), and Tenant 2 provisioning (201)...");
    const tenant1Login = await apiJson(`${PROD_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "patron@hipos.local", password: "Patron123!" }),
    });
    assert.equal(tenant1Login.status, 200, `Tenant 1 login failed: ${JSON.stringify(tenant1Login.body)}`);
    const t1Token = tenant1Login.body.token;
    assert.ok(t1Token);

    const ts = Date.now();
    const t2Email = `patron-${ts}@testlezzet.local`;
    const t2Password = "Secret1234!";
    const t2Pin = "7788";
    const t2OwnerName = `Test Patron ${ts}`;
    const onboardPayload = {
      firmName: `Test Lezzet A.Ş. ${ts}`,
      branchName: "Etiler Şube",
      ownerName: t2OwnerName,
      ownerEmail: t2Email,
      ownerPassword: t2Password,
      ownerPin: t2Pin,
      district: "Beşiktaş",
      initialTableCount: 6,
    };

    const unauthOnboard = await apiJson(`${PROD_URL}/api/v1/onboarding/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t1Token}` },
      body: JSON.stringify(onboardPayload),
    });
    assert.equal(unauthOnboard.status, 403, `Expected 403 for onboarding without platform key, got ${unauthOnboard.status}`);

    const onboardRes = await apiJson(`${PROD_URL}/api/v1/onboarding/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Platform-Admin-Key": PLATFORM_KEY },
      body: JSON.stringify(onboardPayload),
    });
    assert.equal(onboardRes.status, 201, `Tenant onboarding failed: ${JSON.stringify(onboardRes.body)}`);
    const firm2 = onboardRes.body.firm.id;
    const branch2a = onboardRes.body.branch.id;
    assert.ok(firm2 && branch2a);
    console.log(`   ✅ Tenant 2 provisioned: firm=${firm2}, branch=${branch2a}`);

    const t2Login = await apiJson(`${PROD_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: t2Email, password: t2Password }),
    });
    assert.equal(t2Login.status, 200);
    let t2Token = t2Login.body.token;

    const meRes = await apiJson(`${PROD_URL}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${t2Token}` },
    });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.firm.id, firm2);
    assert.equal(meRes.body.branches.length, 1);

    const branchInfo = await apiJson(`${PROD_URL}/api/v1/auth/branch-info?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`);
    assert.equal(branchInfo.status, 200);
    assert.equal(branchInfo.body.branchName, "Etiler Şube");

    console.log("5️⃣ Verifying multi-branch creation, switch-scope, and strict cross-tenant isolation (403)...");
    const newBranchRes = await apiJson(`${PROD_URL}/api/v1/firms/${firm2}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
      body: JSON.stringify({ branchName: "Cadde Şube", district: "Kadıköy", initialTableCount: 4 }),
    });
    assert.equal(newBranchRes.status, 201, `Create branch failed: ${JSON.stringify(newBranchRes.body)}`);
    const branch2b = newBranchRes.body.branch.id;
    assert.ok(branch2b);

    const switchRes = await apiJson(`${PROD_URL}/api/v1/auth/switch-scope`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
      body: JSON.stringify({ firmId: firm2, branchId: branch2b }),
    });
    assert.equal(switchRes.status, 200);
    assert.equal(switchRes.body.user.branchId, branch2b);

    // Cross-tenant 403 assertions: Tenant 1 -> Tenant 2, and Tenant 2 -> Tenant 1
    const crossChecks = [
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/features` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/service/tables` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/overview/cash-profit` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/overview/activities` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/sales/checks` },
      { token: t1Token, url: `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/events/stream` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/features` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/service/tables` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/printing/config` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/overview/cash-profit` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/overview/activities` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/sales/checks` },
      { token: t2Token, url: `${PROD_URL}/api/v1/firms/${DEMO_FIRM_ID}/branches/${DEMO_BRANCH_ID}/events/stream` },
    ];
    for (const c of crossChecks) {
      const res = await fetch(c.url, { headers: { Authorization: `Bearer ${c.token}` } });
      assert.equal(res.status, 403, `Expected 403 cross-tenant block for ${c.url}, got ${res.status}`);
    }

    const crossBranchPost = await fetch(`${PROD_URL}/api/v1/firms/${firm2}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t1Token}` },
      body: JSON.stringify({ branchName: "Unauthorized", district: "X", initialTableCount: 2 }),
    });
    assert.equal(crossBranchPost.status, 403);

    const crossPinVerify = await apiJson(`${PROD_URL}/api/v1/auth/pin-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firmId: DEMO_FIRM_ID, branchId: DEMO_BRANCH_ID, pin: t2Pin }),
    });
    assert.equal(crossPinVerify.status, 401);
    console.log("   ✅ Cross-tenant isolation (403) and branch switch verified across all routes.");

    console.log("6️⃣ Verifying Print Bridge token scope & real JWT-authenticated ESC/POS print flow...");
    const bridgeTokenRes = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-token`,
      { method: "POST", headers: { Authorization: `Bearer ${t2Token}` } }
    );
    assert.equal(bridgeTokenRes.status, 200, `Bridge token failed: ${JSON.stringify(bridgeTokenRes.body)}`);
    const bridgeToken = bridgeTokenRes.body.token;
    assert.ok(bridgeToken);

    // Bridge token must NOT be able to access sales checks or re-issue bridge tokens
    const bridgeChecksForbidden = await fetch(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/sales/checks`,
      { headers: { Authorization: `Bearer ${bridgeToken}` } }
    );
    assert.equal(bridgeChecksForbidden.status, 403, "Expected bridge role to get 403 on sales/checks");

    const bridgeSelfMintForbidden = await fetch(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/bridge-token`,
      { method: "POST", headers: { Authorization: `Bearer ${bridgeToken}` } }
    );
    assert.equal(bridgeSelfMintForbidden.status, 403, "Expected bridge role to get 403 on minting bridge-token");

    // Configure Tenant 2 printing to cloud_bridge + mock TCP printer
    let receivedEscPosBytes = 0;
    const receivedChunks = [];
    tcpServer = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        receivedEscPosBytes += chunk.length;
        receivedChunks.push(chunk);
      });
    });
    await new Promise((resolve) => tcpServer.listen(0, "127.0.0.1", resolve));
    const tcpPort = tcpServer.address().port;

    const savePrintCfg = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/config`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          mode: "cloud_bridge",
          kitchenIp: "127.0.0.1",
          kitchenPort: tcpPort,
          cashierIp: "127.0.0.1",
          cashierPort: tcpPort,
        }),
      }
    );
    assert.equal(savePrintCfg.status, 200);

    const bridgeProc = spawn(
      "node",
      ["scripts/hipos-print-bridge.mjs", "--url", PROD_URL, "--token", bridgeToken],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] }
    );
    children.push(bridgeProc);

    let bridgeLogs = "";
    bridgeProc.stdout.on("data", (d) => { bridgeLogs += d.toString(); });
    bridgeProc.stderr.on("data", (d) => { bridgeLogs += d.toString(); });

    const waitStarted = Date.now();
    while (!bridgeLogs.includes("Bağlantı aktif") && Date.now() - waitStarted < 10_000) {
      await delay(150);
    }
    assert.ok(bridgeLogs.includes("Bağlantı aktif"), `Print Bridge failed to connect:\n${bridgeLogs}`);

    const testPrintRes = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/printing/test?target=kitchen`,
      { method: "POST", headers: { Authorization: `Bearer ${t2Token}` } }
    );
    assert.equal(testPrintRes.status, 200, `Test print failed: ${JSON.stringify(testPrintRes.body)}`);

    const waitPrintStarted = Date.now();
    while (receivedEscPosBytes === 0 && Date.now() - waitPrintStarted < 6_000) {
      await delay(100);
    }
    assert.ok(receivedEscPosBytes > 0, `Expected TCP mock printer to receive ESC/POS bytes, got 0. Bridge logs:\n${bridgeLogs}`);
    console.log(`   ✅ Print Bridge delivered ${receivedEscPosBytes} ESC/POS bytes using ONLY JWT bridge token.`);

    console.log("7️⃣ Running real Browser E2E (Admin + POS Waiter/Kitchen/Cashier against hardened API :5180)...");
    browser = await chromium.launch({ headless: true });
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    const leakedDemoRequests = [];
    adminPage.on("request", (req) => {
      if (req.url().includes("/api/") && req.headers()["x-demo-actor"]) {
        leakedDemoRequests.push({ url: req.url(), actor: req.headers()["x-demo-actor"] });
      }
    });

    await adminPage.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
    await adminPage.waitForSelector('input[type="email"]', { timeout: 10_000 });
    await adminPage.fill('input[type="email"]', t2Email);
    await adminPage.fill('input[type="password"]', t2Password);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForFunction(
      (ownerName) => !document.querySelector('input[type="email"]') && document.body.innerText.includes(ownerName),
      t2OwnerName,
      { timeout: 10_000 }
    );

    const bodyText = await adminPage.textContent("body");
    assert.ok(bodyText.includes(t2OwnerName), "Expected logged-in owner name to appear in Admin");
    assert.ok(!bodyText.includes("Ahmet Patron"), "Must NOT display hardcoded demo user Ahmet Patron");
    assert.equal(leakedDemoRequests.length, 0, `Found X-Demo-Actor headers in Admin: ${JSON.stringify(leakedDemoRequests)}`);

    await adminPage.goto("http://127.0.0.1:5173/admin/branches/list", { waitUntil: "networkidle" });
    await adminPage.waitForFunction(
      () => document.body.innerText.includes("Etiler Şube") && document.body.innerText.includes("Cadde Şube"),
      null,
      { timeout: 10_000 }
    );
    console.log("   ✅ Admin browser authenticated & isolated cleanly with zero X-Demo-Actor headers.");

    // Create + publish a Tenant 2 product and activate starter menu so Waiter has orderable items
    const productId = randomUUID();
    const createProd = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/products`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          draftId: productId,
          priceVersionId: randomUUID(),
          name: "Izgara Köfte",
          sku: `KOFTE-${ts}`,
          categoryId: "cat-food",
          categoryName: "Yiyecekler",
          description: "Tenant 2 başlangıç ürünü",
          amountMinor: 15000,
        }),
      }
    );
    assert.equal(createProd.status, 201, `Create product failed: ${JSON.stringify(createProd.body)}`);

    const pubProd = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/drafts/${productId}/publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          publicationId: randomUUID(),
          expectedVersion: createProd.body.version,
        }),
      }
    );
    assert.equal(pubProd.status, 201, `Publish product failed: ${JSON.stringify(pubProd.body)}`);

    const menuReqId = randomUUID();
    const createMenu = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/menus`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          requestId: menuReqId,
          expectedVersion: 0,
          name: "Ana Menü",
          description: "Etiler şubesi salon menüsü",
          sections: [{ sectionId: "sec-food", name: "Yiyecekler", productIds: [productId] }],
        }),
      }
    );
    assert.ok(createMenu.status === 200 || createMenu.status === 201, `Create menu failed: ${JSON.stringify(createMenu.body)}`);

    const menuId = createMenu.body?.id ?? menuReqId;
    const activateMenu = await apiJson(
      `${PROD_URL}/api/v1/firms/${firm2}/branches/${branch2a}/catalog/menus/${menuId}/activation`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2Token}` },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedVersion: createMenu.body.version ?? 1,
          isActive: true,
        }),
      }
    );
    assert.equal(activateMenu.status, 200, `Activate menu failed: ${JSON.stringify(activateMenu.body)}`);
    console.log("   ✅ Seeded Tenant 2 starter product + active menu.");

    // Shared browser context for Waiter, Kitchen & Cashier verifies route-isolated JWT storage!
    const posContext = await browser.newContext();
    const posPage = await posContext.newPage();

    const preUnlockApiCalls = [];
    posPage.on("request", (req) => {
      if (req.url().includes("/api/") && req.headers()["x-demo-actor"]) {
        leakedDemoRequests.push({ url: req.url(), actor: req.headers()["x-demo-actor"] });
      }
      if (req.url().includes("/api/") && !req.url().includes("/auth/branch-info") && !req.url().includes("/auth/pin-verify")) {
        preUnlockApiCalls.push(req.url());
      }
    });

    // Load Waiter locked screen
    await posPage.goto(
      `http://127.0.0.1:5176/waiter?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`,
      { waitUntil: "networkidle" }
    );
    await delay(500);
    assert.equal(preUnlockApiCalls.length, 0, `Locked Waiter screen leaked API calls: ${JSON.stringify(preUnlockApiCalls)}`);
    const pinModalText = await posPage.textContent("body");
    assert.ok(pinModalText.includes("Etiler Şube"), "Expected PinPadModal to show bound Tenant 2 branch name");

    // Unlock Waiter with Tenant 2 Owner PIN 7788
    for (const digit of t2Pin) {
      await posPage.locator(`button:text-is("${digit}")`).click();
    }
    await posPage.waitForSelector(".waiter-table-grid", { timeout: 10_000 });

    const waiterTableCount = await posPage.locator(".waiter-table-card").count();
    assert.equal(waiterTableCount, 6, `Expected 6 tables provisioned for Tenant 2 Etiler Şube, got ${waiterTableCount}`);

    // Open Masa 01 & send an order
    await posPage.locator(".waiter-table-card").first().click();
    await posPage.waitForSelector(".waiter-category-toggle", { timeout: 10_000 });
    await posPage.locator(".waiter-category-toggle").first().click();
    await posPage.waitForSelector(".waiter-add-product", { timeout: 10_000 });
    await posPage.locator(".waiter-add-product").first().click();
    // Wait for customization modal & option-groups resolution before clicking Sepete ekle
    await posPage.waitForSelector(".waiter-custom-modal", { timeout: 10_000 });
    await posPage.waitForFunction(
      () => {
        const btn = document.querySelector(".waiter-custom-modal button.ops-primary");
        return Boolean(btn && !btn.hasAttribute("disabled"));
      },
      null,
      { timeout: 10_000 }
    );
    await posPage.locator('.waiter-custom-modal button.ops-primary').click();
    await posPage.waitForSelector(".waiter-custom-modal", { state: "detached", timeout: 5_000 });

    const sendBtn = posPage.locator('button:has-text("Siparişi mutfağa gönder")');
    await sendBtn.waitFor({ state: "visible", timeout: 5_000 });
    await sendBtn.click();
    await posPage.waitForFunction(
      () => Boolean(document.querySelector(".ops-success") || document.querySelector(".ops-error")),
      null,
      { timeout: 20_000 }
    );
    const errEl = await posPage.locator(".ops-error").first().textContent().catch(() => null);
    assert.ok(!errEl, `Waiter sendOrder failed with error: ${errEl}`);
    await posPage.waitForSelector(".ops-success", { timeout: 5_000 });
    console.log("   ✅ Waiter unlocked Tenant 2 branch via PIN and placed real order on Masa 1.");

    // Navigate to Kitchen in same context -> check NO pre-unlock calls + unlock with PIN 7788
    const preUnlockKitchenCalls = [];
    const kitchenListener = (req) => {
      if (req.url().includes("/kitchen/") || req.url().includes("/events/stream")) {
        preUnlockKitchenCalls.push(req.url());
      }
    };
    posPage.on("request", kitchenListener);

    await posPage.goto(
      `http://127.0.0.1:5176/kitchen?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`,
      { waitUntil: "networkidle" }
    );
    await delay(500);
    assert.equal(preUnlockKitchenCalls.length, 0, `Locked Kitchen screen leaked API calls: ${JSON.stringify(preUnlockKitchenCalls)}`);
    posPage.off("request", kitchenListener);

    for (const digit of t2Pin) {
      await posPage.locator(`button:text-is("${digit}")`).click();
    }
    await posPage.waitForSelector(".kitchen-toolbar", { timeout: 10_000 });
    await posPage.waitForFunction(() => document.body.innerText.includes("Masa 01"), null, { timeout: 10_000 });
    console.log("   ✅ Kitchen remained idle while locked, unlocked via PIN, and displayed Masa 01 ticket.");

    // Verify route-isolated tokens coexist without overwriting
    const storageTokens = await posPage.evaluate(() => ({
      waiter: Boolean(localStorage.getItem("hipos_waiter_token")),
      kitchen: Boolean(localStorage.getItem("hipos_kitchen_token")),
      posClobber: Boolean(localStorage.getItem("hipos_pos_token")),
    }));
    assert.equal(storageTokens.waiter, true, "Waiter token must remain intact after unlocking Kitchen");
    assert.equal(storageTokens.kitchen, true, "Kitchen token must be stored under its own key");
    assert.equal(storageTokens.posClobber, false, "PinPadModal must not clobber hipos_pos_token");

    // Navigate to Cashier -> unlock via PIN 7788
    await posPage.goto(
      `http://127.0.0.1:5176/cashier?firmId=${encodeURIComponent(firm2)}&branchId=${encodeURIComponent(branch2a)}`,
      { waitUntil: "networkidle" }
    );
    for (const digit of t2Pin) {
      await posPage.locator(`button:text-is("${digit}")`).click();
    }
    await posPage.waitForSelector(".cashier-header-clean", { timeout: 10_000 });

    const finalTokens = await posPage.evaluate(() => ({
      waiter: Boolean(localStorage.getItem("hipos_waiter_token")),
      kitchen: Boolean(localStorage.getItem("hipos_kitchen_token")),
      cashier: Boolean(localStorage.getItem("hipos_cashier_token")),
    }));
    assert.deepEqual(finalTokens, { waiter: true, kitchen: true, cashier: true });
    assert.equal(leakedDemoRequests.length, 0, `Found X-Demo-Actor headers in browser: ${JSON.stringify(leakedDemoRequests)}`);
    console.log("   ✅ Cashier unlocked & all 3 POS terminal tokens remained route-isolated.");

    console.log("\n🎉 ALL FAZ 10 SECURITY, MULTI-TENANT, BRIDGE & BROWSER E2E ASSERTIONS PASSED!");
    if (prodStderr.trim()) {
      console.log(`(Production stderr length: ${prodStderr.length} bytes)`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (tcpServer) await new Promise((r) => tcpServer.close(() => r()));
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
  }
}

run().catch((err) => {
  console.error("❌ Faz 10 test suite failed:", err);
  process.exit(1);
});
