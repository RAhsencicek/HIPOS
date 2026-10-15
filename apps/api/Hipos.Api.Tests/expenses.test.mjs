import assert from "node:assert/strict";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const execFile = promisify(execFileCallback);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const project = fileURLToPath(new URL("../Hipos.Api/Hipos.Api.csproj", import.meta.url));
const pgBin = "/opt/homebrew/opt/postgresql@18/bin";
const single = "11111111-1111-4111-8111-111111111111";
const singleBranch = "33333333-3333-4333-8333-333333333333";
const multi = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const moda = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const besiktas = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitFor(base, child, readOutput, path) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${base}${path}`)).ok) return; } catch { /* process starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Process did not become ready: ${readOutput()}`);
}

test("Gider MVP PostgreSQL API, modül kapısı, idempotency ve panel", { timeout: 240000 }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), "hipos-expenses-test-"));
  const data = join(temporary, "data");
  const log = join(temporary, "postgres.log");
  const pgPort = await freePort();
  const apiPort = await freePort();
  const uiPort = 5177; // API CORS list intentionally includes this local preview origin.
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const uiBase = `http://127.0.0.1:${uiPort}`;
  const connection = `Host=127.0.0.1;Port=${pgPort};Database=hipos_features;Username=${process.env.USER};Pooling=false`;
  const demoUrl = `postgresql://${process.env.USER}@127.0.0.1:${pgPort}/hipos_features`;
  const env = { ...process.env, ASPNETCORE_ENVIRONMENT: "Development", HIPOS_FEATURE_STORAGE: "postgres",
    HIPOS_FEATURES_CONNECTION: connection };
  const runPg = (command, args) => execFile(join(pgBin, command), args);
  let pgStarted = false;
  let api;
  let ui;
  let browser;
  let apiOutput = "";
  let uiOutput = "";
  const stop = async child => {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
  const request = async (path, method = "GET", body, actor = "manager-single") => {
    const response = await fetch(`${apiBase}${path}`, { method,
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const raw = await response.text();
    return { status: response.status, data: JSON.parse(raw) };
  };
  const featureRoot = `/api/v1/firms/${single}/branches/${singleBranch}/features`;
  const root = `/api/v1/firms/${single}/branches/${singleBranch}`;

  try {
    await runPg("initdb", ["-D", data, "-A", "trust", "--encoding", "UTF8", "--no-instructions"]);
    await runPg("pg_ctl", ["-D", data, "-l", log, "-o", `-h 127.0.0.1 -p ${pgPort} -k /tmp`, "start"]);
    pgStarted = true;
    await runPg("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER, "hipos_features"]);
    for (const context of ["FeatureDbContext", "CariDbContext", "CashDbContext"]) {
      await execFile("dotnet", ["tool", "run", "dotnet-ef", "database", "update", "--project", project,
        "--context", context], { cwd: repo, env });
    }

    api = spawn("dotnet", ["run", "--project", project, "--urls", apiBase], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    api.stdout.on("data", chunk => { apiOutput += chunk; });
    api.stderr.on("data", chunk => { apiOutput += chunk; });
    await waitFor(apiBase, api, () => apiOutput, "/health");

    assert.equal((await request(`${root}/expense-categories`)).data.error.code, "EXPENSE_STORAGE_UNAVAILABLE");
    const featureUnavailable = await request(`${featureRoot}/finance.expenses`, "PUT", { desiredEnabled: true, expectedVersion: 1 });
    assert.equal(featureUnavailable.data.code, "EXPENSE_STORAGE_UNAVAILABLE");
    await stop(api); api = undefined;

    await execFile("dotnet", ["tool", "run", "dotnet-ef", "database", "update", "--project", project,
      "--context", "ExpenseDbContext"], { cwd: repo, env });
    await execFile(process.execPath, [join(repo, "scripts/seed-demo.mjs"), "--expenses"], {
      cwd: repo, env: { ...env, HIPOS_DEMO_DATABASE_URL: demoUrl },
    });
    apiOutput = "";
    api = spawn("dotnet", ["run", "--project", project, "--urls", apiBase], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
    api.stdout.on("data", chunk => { apiOutput += chunk; });
    api.stderr.on("data", chunk => { apiOutput += chunk; });
    await waitFor(apiBase, api, () => apiOutput, "/health");

    const categories = await request(`${root}/expense-categories`);
    assert.equal(categories.status, 200);
    assert.equal(categories.data.items.length, 6);
    const body = { requestId: "e0000000-0000-4000-8000-000000000001", categoryId: "supplies",
      expenseDate: "2026-10-15", amountMinor: 12345, description: "Kahve ve sarf malzemesi" };
    const expenses = `${root}/expenses`;
    assert.equal((await request(expenses, "POST", body)).data.error.code, "FEATURE_DISABLED");
    assert.equal((await request(expenses, "POST", body, "viewer-multi")).status, 403);

    const state = (await request(featureRoot)).data.find(item => item.key === "finance.expenses");
    const enabled = await request(`${featureRoot}/finance.expenses`, "PUT", { desiredEnabled: true, expectedVersion: state.version });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.data.effectiveForNewWork, true);
    assert.equal((await request(expenses, "POST", { ...body, amountMinor: 0 })).status, 400);
    assert.equal((await request(expenses, "POST", { ...body, amountMinor: -1 })).status, 400);
    assert.equal((await request(expenses, "POST", { ...body, currency: "USD" })).data.error.code, "CURRENCY_NOT_SUPPORTED");
    assert.equal((await request(expenses, "POST", { ...body, categoryId: "not-a-category" })).data.error.code, "EXPENSE_CATEGORY_NOT_FOUND");
    const cashBefore = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
      "-d", "hipos_features", "-t", "-A", "-c", "SELECT count(*) FROM cash.movements"]);
    const cariBefore = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
      "-d", "hipos_features", "-t", "-A", "-c", "SELECT count(*) FROM cari.movements"]);
    const created = await request(expenses, "POST", body);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.expense.amountMinor, body.amountMinor);
    assert.equal(created.data.expense.currency, "TRY");
    assert.equal(created.data.expense.categoryName, "Sarf malzemeleri");
    const replay = await request(expenses, "POST", body);
    assert.equal(replay.status, 200);
    assert.equal(replay.data.expense.id, created.data.expense.id);
    assert.equal((await request(expenses, "POST", { ...body, amountMinor: 12346 })).data.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await request(`${expenses}/${body.requestId}`)).data.expense.description, body.description);
    assert.equal((await request(`${expenses}?from=2026-10-15&to=2026-10-15`)).data.pageInfo.totalItems, 1);
    assert.equal((await request(`${expenses}?categoryId=rent`)).data.pageInfo.totalItems, 0);
    assert.equal((await request(`${root}/expenses/${body.requestId}`, "GET", undefined, "manager-moda")).status, 403);
    const audit = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
      "-d", "hipos_features", "-t", "-A", "-c", `SELECT count(*) FROM finance.audit WHERE entity_id='${body.requestId}' AND action='expense_created'`]);
    assert.equal(audit.stdout.trim(), "1");
    const cashAfter = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
      "-d", "hipos_features", "-t", "-A", "-c", "SELECT count(*) FROM cash.movements"]);
    const cariAfter = await runPg("psql", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", process.env.USER,
      "-d", "hipos_features", "-t", "-A", "-c", "SELECT count(*) FROM cari.movements"]);
    assert.equal(cashAfter.stdout.trim(), cashBefore.stdout.trim());
    assert.equal(cariAfter.stdout.trim(), cariBefore.stdout.trim());

    const modaRoot = `/api/v1/firms/${multi}/branches/${moda}`;
    const besiktasRoot = `/api/v1/firms/${multi}/branches/${besiktas}`;
    assert.equal((await request(`${modaRoot}/expense-categories`, "GET", undefined, "manager-moda")).data.items.length, 6);
    const modaFeatureRoot = `${modaRoot}/features`;
    const modaState = (await request(modaFeatureRoot, "GET", undefined, "manager-moda")).data.find(item => item.key === "finance.expenses");
    const modaEnabled = await request(`${modaFeatureRoot}/finance.expenses`, "PUT",
      { desiredEnabled: true, expectedVersion: modaState.version }, "manager-moda");
    assert.equal(modaEnabled.status, 200);
    const branchExpense = { ...body, requestId: "e0000000-0000-4000-8000-000000000003", description: "Moda şube gideri" };
    assert.equal((await request(`${modaRoot}/expenses`, "POST", branchExpense, "viewer-multi")).status, 403);
    assert.equal((await request(`${modaRoot}/expenses`, "POST", branchExpense, "manager-moda")).status, 201);
    assert.equal((await request(`${besiktasRoot}/expenses`, "GET", undefined, "manager-multi")).data.pageInfo.totalItems, 0);
    assert.equal((await request(`${besiktasRoot}/expenses/${branchExpense.requestId}`, "GET", undefined, "manager-multi")).status, 404);
    const modaAfter = (await request(modaFeatureRoot, "GET", undefined, "manager-moda")).data.find(item => item.key === "finance.expenses");
    assert.equal((await request(`${modaFeatureRoot}/finance.expenses`, "PUT",
      { desiredEnabled: false, expectedVersion: modaAfter.version }, "manager-moda")).status, 200);

    const currentState = (await request(featureRoot)).data.find(item => item.key === "finance.expenses");
    assert.equal((await request(`${featureRoot}/finance.expenses`, "PUT", { desiredEnabled: false, expectedVersion: currentState.version })).status, 200);
    assert.equal((await request(expenses)).status, 200);
    assert.equal((await request(`${expenses}/${body.requestId}`)).status, 200);
    assert.equal((await request(expenses, "POST", { ...body, requestId: "e0000000-0000-4000-8000-000000000002" })).data.error.code, "FEATURE_DISABLED");
    await execFile(process.execPath, [join(repo, "scripts/seed-demo.mjs"), "--expenses"], {
      cwd: repo, env: { ...env, HIPOS_DEMO_DATABASE_URL: demoUrl },
    });
    const seededAgain = await request(`${root}/expense-categories`);
    assert.equal(seededAgain.data.items.length, 6);

    const menuEnv = { ...env, VITE_FEATURE_PROVIDER: "http", VITE_EXPENSE_PROVIDER: "http", VITE_API_BASE_URL: apiBase };
    const disabledState = (await request(featureRoot)).data.find(item => item.key === "finance.expenses");
    ui = spawn("npm", ["run", "dev", "--workspace", "@hipos/admin", "--", "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"],
      { cwd: repo, env: menuEnv, stdio: ["ignore", "pipe", "pipe"] });
    ui.stdout.on("data", chunk => { uiOutput += chunk; });
    ui.stderr.on("data", chunk => { uiOutput += chunk; });
    await waitFor(uiBase, ui, () => uiOutput, "/admin/finance/expenses");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${uiBase}/admin/finance/expenses`);
    await expect(page.getByRole("heading", { name: "Giderler", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Modül kapalı · yeni gider eklenemez" })).toBeDisabled();
    const panelEnabled = await request(`${featureRoot}/finance.expenses`, "PUT", {
      desiredEnabled: true, expectedVersion: disabledState.version,
    });
    assert.equal(panelEnabled.status, 200);
    await page.reload();
    await expect(page.getByRole("button", { name: "Gideri kaydet" })).toBeEnabled();
    await page.goto(`${uiBase}/admin/finance/expense-categories`);
    await expect(page.getByRole("heading", { name: "Gider kategorileri", exact: true })).toBeVisible();
    await expect(page.getByText("Sarf malzemeleri", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.goto(`${uiBase}/admin/finance/expenses`);
    await page.getByLabel("Tutar (TRY)").fill("87,50");
    await page.getByLabel("Açıklama").fill("Panel test gider kaydı");
    await page.getByRole("button", { name: "Gideri kaydet" }).click();
    await expect(page.getByText("Gider PostgreSQL'e kaydedildi. Kasa ve cari hareketi oluşturulmadı.")).toBeVisible();
    await page.getByRole("button", { name: "Listeye dön" }).click();
    const panelExpense = page.getByRole("button", { name: /Panel test gider kaydı/ });
    assert.equal(await panelExpense.count(), 1, await page.locator("body").innerText());
    await panelExpense.click();
    await expect(page.getByText("Panel test gider kaydı", { exact: true })).toBeVisible();
    await expect(page.locator(".expense-detail h3")).toContainText("87,50");
    await page.close();
    await browser.close(); browser = undefined;
  } catch (error) {
    const pgOutput = await import("node:fs/promises").then(fs => fs.readFile(log, "utf8")).catch(() => "");
    throw new Error(`${error.stack ?? error.message}\nAPI: ${apiOutput.slice(-8000)}\nUI: ${uiOutput.slice(-4000)}\nPostgreSQL: ${pgOutput.slice(-3000)}`);
  } finally {
    await browser?.close();
    await stop(ui);
    await stop(api);
    if (pgStarted) await runPg("pg_ctl", ["-D", data, "-m", "fast", "stop"]).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
});
