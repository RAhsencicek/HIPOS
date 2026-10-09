import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const demo = JSON.parse(await readFile(new URL("../contracts/demo-single-branch.v1.json", import.meta.url), "utf8"));
const address = process.env.HIPOS_DEMO_DATABASE_URL;
if (!address) throw new Error("HIPOS_DEMO_DATABASE_URL gerekli.");
const url = new URL(address);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/hipos_features")
  throw new Error("Menü seed'i yalnız yerel hipos_features geliştirme veritabanında çalışır.");
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const firm = quote(demo.firm.id), branch = quote(demo.branch.id);
const menus = [
  { id: "99999999-9999-4999-8999-999999999901", name: "Ana Menü", description: "Fırından çıkan pizzalar, taze sandviçler, tatlılar ve içecekler.", categories: demo.categories },
  { id: "99999999-9999-4999-8999-999999999902", name: "İçecek Menüsü", description: "Kahve molasına eşlik eden sıcak ve soğuk içecekler.", categories: demo.categories.filter(x => x.id === "drinks") },
];
const statements = ["BEGIN;"];
for (const menu of menus) {
  const sections = menu.categories.map(c => ({ sectionId: `catalog-${c.id}`, name: c.name, productIds: demo.products.filter(p => p.categoryId === c.id).map(p => p.id) }));
  const fingerprint = createHash("sha256").update(JSON.stringify(menu)).digest("hex").toUpperCase();
  const inserts = [];
  inserts.push(`INSERT INTO catalog.menus (id,firm_id,branch_id,name,description,is_active,version,created_at,updated_at) VALUES (${quote(menu.id)},${firm},${branch},${quote(menu.name)},${quote(menu.description)},false,1,now(),now());`);
  for (const [s, section] of sections.entries()) {
    inserts.push(`INSERT INTO catalog.menu_sections (menu_id,section_id,name,sort_order) VALUES (${quote(menu.id)},${quote(section.sectionId)},${quote(section.name)},${s});`);
    for (const [p, product] of section.productIds.entries()) {
      inserts.push(`IF NOT EXISTS (SELECT 1 FROM catalog.products WHERE id=${quote(product)} AND firm_id=${firm} AND ${branch}=ANY(branch_ids)) THEN RAISE EXCEPTION 'Menü ürünü bulunamadı; önce demo:seed çalıştırın.'; END IF;`);
      inserts.push(`INSERT INTO catalog.menu_items (menu_id,section_id,product_id,sort_order) VALUES (${quote(menu.id)},${quote(section.sectionId)},${quote(product)},${p});`);
    }
  }
  inserts.push(`INSERT INTO catalog.menu_audit (request_id,menu_id,firm_id,branch_id,actor,action,fingerprint,snapshot_json,version,occurred_at) VALUES (${quote(menu.id)},${quote(menu.id)},${firm},${branch},'demo-seed','created',${quote(fingerprint)},${quote(JSON.stringify({ name: menu.name, description: menu.description, isActive: false, sections }))}::jsonb,1,now());`);
  statements.push(`DO $seed$ BEGIN IF EXISTS (SELECT 1 FROM catalog.menus WHERE id=${quote(menu.id)} AND (firm_id<>${firm} OR branch_id<>${branch})) THEN RAISE EXCEPTION 'Demo menü kimliği farklı kapsamda kullanılıyor.'; END IF; IF NOT EXISTS (SELECT 1 FROM catalog.menus WHERE id=${quote(menu.id)}) THEN ${inserts.join("\n")} END IF; END $seed$;`);
}
statements.push("COMMIT;");
const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], { env: { ...process.env,
  PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: "hipos_features" }, stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(statements.join("\n"));
const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
if (code !== 0) process.exit(code ?? 1);
console.log("Yerel PostgreSQL menü seed'i tamamlandı: Ana Menü ve İçecek Menüsü. Var olan menülerin içeriği ve aktiflik tercihi korunur.");
