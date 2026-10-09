import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const demo = JSON.parse(await readFile(new URL("../contracts/demo-single-branch.v1.json", import.meta.url), "utf8"));

function unique(items, key) {
  const values = items.map((item) => item[key]);
  if (new Set(values).size !== values.length) throw new Error(`Tekrarlanan ${key} bulundu.`);
}

function validate() {
  if (demo.schemaVersion !== 1 || demo.demoOnly !== true || demo.currency !== "TRY") throw new Error("Demo sözleşmesi geçersiz.");
  if (!demo.warehouse?.id || demo.warehouse.name !== "Kadıköy Ana Depo") throw new Error("Demo depo sözleşmesi geçersiz.");
  for (const group of [demo.categories, demo.products, demo.ingredients, demo.recipes, demo.parties, demo.partyMovements, demo.stockMovements]) unique(group, "id");
  unique(demo.products, "sku");
  const categories = new Set(demo.categories.map((item) => item.id));
  const products = new Map(demo.products.map((item) => [item.id, item]));
  const ingredients = new Map(demo.ingredients.map((item) => [item.id, item]));
  const recipes = new Map(demo.recipes.map((item) => [item.id, item]));
  const parties = new Map(demo.parties.map((item) => [item.id, item]));
  const service = demo.serviceDemo;
  if (!Number.isInteger(service.tableCount) || service.tableCount < 1 || service.tableCount > 100)
    throw new Error("Demo masa sayısı geçersiz.");
  for (const group of [service.waiters, service.employees, service.orders, service.assignments]) unique(group, "id");
  unique([...service.waiters, ...service.employees], "id");
  for (const employee of service.employees) if (employee.name.trim().length < 2 ||
    !["management", "kitchen", "service", "cashier", "support"].includes(employee.department) || employee.jobTitle.trim().length < 2)
    throw new Error(`Demo personel kartı geçersiz: ${employee.id}`);
  unique(service.assignments, "orderId");
  unique(service.assignments, "tableNumber");
  const waiters = new Set(service.waiters.map((row) => row.id));
  const serviceOrders = new Set(service.orders.map((row) => row.id));
  for (const order of service.orders) {
    if (!Number.isFinite(Date.parse(order.createdAt)) || !order.items.length ||
      new Set(order.items.map((item) => item.productId)).size !== order.items.length ||
      order.items.some((item) => !products.has(item.productId) || !Number.isInteger(item.quantity) || item.quantity < 1))
      throw new Error(`Demo servis siparişi geçersiz: ${order.id}`);
  }
  for (const assignment of service.assignments) if (!serviceOrders.has(assignment.orderId) ||
    assignment.tableNumber < 1 || assignment.tableNumber > service.tableCount ||
    (assignment.waiterId && !waiters.has(assignment.waiterId)))
    throw new Error(`Demo masa bağı geçersiz: ${assignment.id}`);
  for (const party of demo.parties) if (party.name.trim().length < 2 || !party.types.length ||
    new Set(party.types).size !== party.types.length || party.types.some((type) => !["customer", "supplier"].includes(type)))
    throw new Error(`Cari kartı geçersiz: ${party.id}`);
  for (const product of demo.products) {
    if (!categories.has(product.categoryId) || !Number.isSafeInteger(product.priceMinor) || product.priceMinor <= 0) throw new Error(`Ürün geçersiz: ${product.id}`);
    if (product.recipeId && recipes.get(product.recipeId)?.productId !== product.id) throw new Error(`Reçete bağlantısı geçersiz: ${product.id}`);
  }
  for (const recipe of demo.recipes) {
    if (products.get(recipe.productId)?.recipeId !== recipe.id || recipe.version < 1) throw new Error(`Reçete geçersiz: ${recipe.id}`);
    for (const line of recipe.lines) if (!ingredients.has(line.ingredientId) || line.quantity <= 0) throw new Error(`Reçete kalemi geçersiz: ${recipe.id}`);
  }
  for (const movement of demo.partyMovements) {
    const typedDelta = movement.entryType === "customer_charge" || movement.entryType === "supplier_debt" ? movement.deltaMinor > 0
      : movement.entryType === "customer_collection" || movement.entryType === "supplier_payment" ? movement.deltaMinor < 0 : movement.entryType === "legacy_manual";
    if (!parties.has(movement.partyId) || !Number.isSafeInteger(movement.deltaMinor) || movement.deltaMinor === 0 ||
      movement.source !== "manual_demo" || !movement.description?.trim() || !movement.effectiveDate ||
      !["customer", "supplier"].includes(movement.kind) || !typedDelta ||
      movement.entryType.startsWith("customer_") && movement.kind !== "customer" ||
      movement.entryType.startsWith("supplier_") && movement.kind !== "supplier" ||
      !parties.get(movement.partyId).types.includes(movement.kind)) throw new Error(`Cari hareketi geçersiz: ${movement.id}`);
  }
  const stock = new Map(demo.ingredients.map((item) => [item.id, 0]));
  for (const movement of demo.stockMovements) {
    if (!ingredients.has(movement.ingredientId) || !Number.isFinite(movement.delta) || movement.delta === 0 ||
      Math.round(movement.delta * 1000) !== movement.delta * 1000 ||
      !["opening_demo", "purchase_demo", "manual_use_demo"].includes(movement.source) ||
      (movement.partyId && !parties.get(movement.partyId)?.types.includes("supplier"))) throw new Error(`Stok hareketi geçersiz: ${movement.id}`);
    stock.set(movement.ingredientId, stock.get(movement.ingredientId) + movement.delta);
  }
  for (const [id, quantity] of stock) if (quantity < 0) throw new Error(`Negatif stok: ${id}`);
  const count = demo.countExample;
  if (stock.get(count.ingredientId) !== count.systemQuantity || ingredients.get(count.ingredientId)?.unit !== count.unit || count.status !== "scenario_only") throw new Error("Sayım örneği stokla uyuşmuyor.");
  if (!Array.isArray(demo.countLines) || demo.countLines.length !== demo.ingredients.length) throw new Error("Demo sayım tüm hammadde kartlarını kapsamalı.");
  unique(demo.countLines, "ingredientId");
  for (const line of demo.countLines) if (!ingredients.has(line.ingredientId) ||
    !Number.isFinite(line.physicalQuantity) || line.physicalQuantity < 0 ||
    Math.round(line.physicalQuantity * 1000) !== line.physicalQuantity * 1000)
    throw new Error(`Demo sayım kalemi geçersiz: ${line.ingredientId}`);
  return stock;
}

const stock = validate();
if (process.argv.includes("--check")) {
  console.log(`Demo tutarlı: ${demo.products.length} ürün, ${demo.recipes.length} reçete, ${demo.parties.length} cari, ${stock.size} stok kalemi, ${demo.serviceDemo.tableCount} masa, ${demo.serviceDemo.orders.length} servis siparişi. Mozzarella farkı: ${demo.countExample.physicalQuantity - demo.countExample.systemQuantity} ${demo.countExample.unit}.`);
  process.exit(0);
}

const databaseUrl = process.env.HIPOS_DEMO_DATABASE_URL;
if (!databaseUrl) throw new Error("HIPOS_DEMO_DATABASE_URL gerekli. Yalnız yerel geliştirme veritabanına bağlanın.");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/hipos_features") throw new Error("Demo seed yalnız yerel hipos_features veritabanında çalışır.");

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlArray = (items) => `ARRAY[${items.map(sqlString).join(",")}]::text[]`;
const firm = sqlString(demo.firm.id);
const branch = sqlString(demo.branch.id);
const now = "2026-10-08T09:00:00Z";
const cariOnly = process.argv.includes("--cari");
const serviceOnly = process.argv.includes("--service");
const inventoryOnly = process.argv.includes("--inventory");
if ([cariOnly, serviceOnly, inventoryOnly].filter(Boolean).length > 1) throw new Error("--cari, --service ve --inventory birlikte kullanılamaz.");
const statements = ["BEGIN;"];
if (serviceOnly) {
  for (let number = 1; number <= demo.serviceDemo.tableCount; number++) statements.push(
    `INSERT INTO service.tables (id,firm_id,branch_id,number,name,is_active,version,updated_at) VALUES (${sqlString(`table-${String(number).padStart(2, "0")}`)},${firm},${branch},${number},${sqlString(`Masa ${String(number).padStart(2, "0")}`)},true,1,${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`
  );
  for (const waiter of demo.serviceDemo.waiters) statements.push(
    `INSERT INTO service.employees (id,firm_id,branch_id,name,department,job_title,phone,is_active,version,created_at,updated_at) VALUES (${sqlString(waiter.id)},${firm},${branch},${sqlString(waiter.name)},'service','Garson',NULL,true,1,${sqlString(now)},${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`
  );
  for (const employee of demo.serviceDemo.employees) statements.push(
    `INSERT INTO service.employees (id,firm_id,branch_id,name,department,job_title,phone,is_active,version,created_at,updated_at) VALUES (${sqlString(employee.id)},${firm},${branch},${sqlString(employee.name)},${sqlString(employee.department)},${sqlString(employee.jobTitle)},NULL,true,1,${sqlString(now)},${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`
  );
  for (const order of demo.serviceDemo.orders) {
    const fingerprint = createHash("sha256").update(order.items.toSorted((a, b) => a.productId.localeCompare(b.productId))
      .map((item) => `${item.productId.replaceAll("-", "").toLowerCase()}:${item.quantity}`).join("|")).digest("hex").toUpperCase();
    const total = order.items.reduce((sum, item) => sum + demo.products.find((product) => product.id === item.productId).priceMinor * item.quantity, 0);
    statements.push(`INSERT INTO sales.orders (id,firm_id,branch_id,source,status,payment_status,total_minor,currency,request_fingerprint,created_at,version) VALUES (${sqlString(order.id)},${firm},${branch},'demo_service','open','unpaid',${total},'TRY',${sqlString(fingerprint)},${sqlString(order.createdAt)},1) ON CONFLICT (id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM sales.orders WHERE id = ${sqlString(order.id)} AND firm_id = ${firm} AND branch_id = ${branch} AND source = 'demo_service' AND request_fingerprint = ${sqlString(fingerprint)}) THEN RAISE EXCEPTION 'Demo sipariş kimliği farklı içerikle kullanılıyor: ${order.id}'; END IF; END $$;`);
    for (const item of order.items) {
      const product = demo.products.find((entry) => entry.id === item.productId);
      statements.push(`INSERT INTO sales.order_lines (order_id,product_id,product_name,sku,quantity,unit_price_minor,line_total_minor,currency) SELECT ${sqlString(order.id)},${sqlString(product.id)},${sqlString(product.name)},${sqlString(product.sku)},${item.quantity},${product.priceMinor},${product.priceMinor * item.quantity},'TRY' WHERE NOT EXISTS (SELECT 1 FROM sales.order_lines WHERE order_id = ${sqlString(order.id)} AND product_id = ${sqlString(product.id)});`);
    }
  }
  for (const assignment of demo.serviceDemo.assignments) {
    const order = demo.serviceDemo.orders.find((row) => row.id === assignment.orderId);
    statements.push(`INSERT INTO service.assignments (id,firm_id,branch_id,table_id,order_id,waiter_id,opened_at,closed_at,version,created_by,closed_by) VALUES (${sqlString(assignment.id)},${firm},${branch},${sqlString(`table-${String(assignment.tableNumber).padStart(2, "0")}`)},${sqlString(order.id)},${assignment.waiterId ? sqlString(assignment.waiterId) : "NULL"},${sqlString(order.createdAt)},NULL,1,'demo-seed',NULL) ON CONFLICT (id) DO NOTHING;`);
  }
} else if (cariOnly) {
  for (const party of demo.parties) {
    const id = sqlString(party.id);
    const phone = party.phone ? sqlString(party.phone) : "NULL";
    const email = party.email ? sqlString(party.email) : "NULL";
    const note = party.note ? sqlString(party.note) : "NULL";
    statements.push(`INSERT INTO cari.parties (id,firm_id,branch_id,name,types,phone,email,note,is_active,version,updated_at) VALUES (${id},${firm},${branch},${sqlString(party.name)},${sqlArray(party.types)},${phone},${email},${note},true,1,${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM cari.parties WHERE id=${id} AND firm_id=${firm} AND branch_id=${branch} AND name=${sqlString(party.name)} AND types=${sqlArray(party.types)}) THEN RAISE EXCEPTION 'Demo cari kimliği farklı içerikle kullanılıyor: ${party.id}'; END IF; END $$;`);
  }
  for (const movement of demo.partyMovements) {
    const party = demo.parties.find((item) => item.id === movement.partyId);
    const id = sqlString(movement.id);
    const kind = sqlString(movement.kind ?? party.types[0]);
    const entryType = sqlString(movement.entryType ?? "legacy_manual");
    const reference = movement.reference ? sqlString(movement.reference) : "NULL";
    const effectiveDate = sqlString(movement.effectiveDate ?? now.slice(0, 10));
    const detail = sqlString(`${movement.entryType}: ${movement.description} · ${movement.deltaMinor} kuruş`);
    statements.push(`INSERT INTO cari.movements (id,firm_id,branch_id,party_id,kind,entry_type,delta_minor,currency,description,reference,effective_date,source,actor,created_at) VALUES (${id},${firm},${branch},${sqlString(movement.partyId)},${kind},${entryType},${movement.deltaMinor},'TRY',${sqlString(movement.description)},${reference},${effectiveDate},'manual','demo-seed',${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM cari.movements WHERE id=${id} AND firm_id=${firm} AND branch_id=${branch} AND party_id=${sqlString(movement.partyId)} AND kind=${kind} AND entry_type=${entryType} AND delta_minor=${movement.deltaMinor} AND effective_date=${effectiveDate}) THEN RAISE EXCEPTION 'Demo cari hareket kimliği farklı içerikle kullanılıyor: ${movement.id}'; END IF; END $$;`);
    statements.push(`INSERT INTO cari.audit (firm_id,branch_id,party_id,action,actor,detail,occurred_at) SELECT ${firm},${branch},${sqlString(movement.partyId)},'movement_added','demo-seed',${detail},${sqlString(now)} WHERE NOT EXISTS (SELECT 1 FROM cari.audit WHERE firm_id=${firm} AND branch_id=${branch} AND party_id=${sqlString(movement.partyId)} AND action='movement_added' AND detail=${detail});`);
  }
} else if (inventoryOnly) {
  const warehouseId = sqlString(demo.warehouse.id);
  statements.push(`INSERT INTO inventory.warehouses (id,firm_id,branch_id,name,is_active,version,created_at,updated_at) VALUES (${warehouseId},${firm},${branch},${sqlString(demo.warehouse.name)},true,1,${sqlString(now)},${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`);
  statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM inventory.warehouses WHERE id=${warehouseId} AND firm_id=${firm} AND branch_id=${branch} AND name=${sqlString(demo.warehouse.name)}) THEN RAISE EXCEPTION 'Demo depo kimliği farklı içerikle kullanılıyor.'; END IF; END $$;`);
  for (const ingredient of demo.ingredients) {
    const id = sqlString(ingredient.id);
    const name = sqlString(ingredient.name);
    const unit = sqlString(ingredient.unit);
    const nameKey = sqlString(ingredient.name.toUpperCase());
    statements.push(`INSERT INTO inventory.ingredients (id,firm_id,branch_id,name,name_key,unit,critical_below,is_active,version,created_at,updated_at) VALUES (${id},${firm},${branch},${name},${nameKey},${unit},${ingredient.criticalBelow},true,1,${sqlString(now)},${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM inventory.ingredients WHERE id=${id} AND firm_id=${firm} AND branch_id=${branch} AND name=${name} AND unit=${unit} AND critical_below=${ingredient.criticalBelow}) THEN RAISE EXCEPTION 'Demo hammadde kimliği farklı içerikle kullanılıyor: ${ingredient.id}'; END IF; END $$;`);
  }
  for (const recipe of demo.recipes) {
    const recipeId = sqlString(recipe.id);
    const productId = sqlString(recipe.productId);
    const portion = sqlString(recipe.portion);
    const createdAt = sqlString(now);
    statements.push(`INSERT INTO inventory.recipes (id,firm_id,branch_id,product_id,version,portion,created_at,created_by) VALUES (${recipeId},${firm},${branch},${productId},${recipe.version},${portion},${createdAt},'demo-seed') ON CONFLICT (id) DO NOTHING;`);
    for (const line of recipe.lines) {
      const unit = demo.ingredients.find((ingredient) => ingredient.id === line.ingredientId).unit;
      statements.push(`INSERT INTO inventory.recipe_lines (recipe_id,ingredient_id,quantity,unit) VALUES (${recipeId},${sqlString(line.ingredientId)},${line.quantity},${sqlString(unit)}) ON CONFLICT (recipe_id,ingredient_id) DO NOTHING;`);
    }
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM inventory.recipes WHERE id=${recipeId} AND firm_id=${firm} AND branch_id=${branch} AND product_id=${productId} AND version=${recipe.version} AND portion=${portion}) OR (SELECT count(*) FROM inventory.recipe_lines WHERE recipe_id=${recipeId}) <> ${recipe.lines.length} THEN RAISE EXCEPTION 'Demo reçete kimliği farklı içerikle kullanılıyor: ${recipe.id}'; END IF; END $$;`);
  }
  for (const movement of demo.stockMovements) {
    const kind = movement.source === "opening_demo" ? "opening" : movement.source === "purchase_demo" ? "manual_in" : "manual_out";
    const description = movement.source === "opening_demo" ? "Açılış bakiyesi · demo" : movement.source === "purchase_demo" ? "Örnek stok girişi · demo" : "Örnek stok kullanımı";
    const id = sqlString(movement.id);
    const unit = sqlString(demo.ingredients.find((ingredient) => ingredient.id === movement.ingredientId).unit);
    statements.push(`INSERT INTO inventory.movements (id,firm_id,branch_id,warehouse_id,ingredient_id,delta,unit,kind,description,count_id,created_at,actor) VALUES (${id},${firm},${branch},${warehouseId},${sqlString(movement.ingredientId)},${movement.delta},${unit},${sqlString(kind)},${sqlString(description)},NULL,${sqlString(now)},'demo-seed') ON CONFLICT (id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM inventory.movements WHERE id=${id} AND firm_id=${firm} AND branch_id=${branch} AND warehouse_id=${warehouseId} AND ingredient_id=${sqlString(movement.ingredientId)} AND delta=${movement.delta} AND unit=${unit} AND kind=${sqlString(kind)}) THEN RAISE EXCEPTION 'Demo stok hareketi kimliği farklı içerikle kullanılıyor: ${movement.id}'; END IF; END $$;`);
    statements.push(`INSERT INTO inventory.audit (firm_id,branch_id,warehouse_id,entity_id,action,request_id,actor,detail,occurred_at) SELECT ${firm},${branch},${warehouseId},${id},'movement_added',${id},'demo-seed',${sqlString(`${demo.ingredients.find((ingredient) => ingredient.id === movement.ingredientId).name}: ${movement.delta} ${demo.ingredients.find((ingredient) => ingredient.id === movement.ingredientId).unit} · ${description}`)},${sqlString(now)} WHERE NOT EXISTS (SELECT 1 FROM inventory.audit WHERE firm_id=${firm} AND branch_id=${branch} AND request_id=${id});`);
  }
  const countId = "count-mozzarella-demo";
  statements.push(`INSERT INTO inventory.counts (id,firm_id,branch_id,warehouse_id,status,version,created_at,created_by,approved_at,approved_by,approval_request_id) VALUES (${sqlString(countId)},${firm},${branch},${warehouseId},'draft',1,${sqlString(now)},'demo-seed',NULL,NULL,NULL) ON CONFLICT (id) DO NOTHING;`);
  for (const line of demo.countLines) {
    const ingredient = demo.ingredients.find((item) => item.id === line.ingredientId);
    const systemQuantity = stock.get(line.ingredientId);
    const movementCountSnapshot = demo.stockMovements.filter((movement) => movement.ingredientId === line.ingredientId).length;
    const ingredientId = sqlString(line.ingredientId);
    statements.push(`INSERT INTO inventory.count_lines (count_id,ingredient_id,system_quantity,movement_count_snapshot,physical_quantity,unit) VALUES (${sqlString(countId)},${ingredientId},${systemQuantity},${movementCountSnapshot},${line.physicalQuantity},${sqlString(ingredient.unit)}) ON CONFLICT (count_id,ingredient_id) DO NOTHING;`);
    statements.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM inventory.count_lines WHERE count_id=${sqlString(countId)} AND ingredient_id=${ingredientId} AND system_quantity=${systemQuantity} AND movement_count_snapshot=${movementCountSnapshot} AND physical_quantity=${line.physicalQuantity} AND unit=${sqlString(ingredient.unit)}) THEN RAISE EXCEPTION 'Demo sayım kalemi farklı içerikle kullanılıyor: ${line.ingredientId}'; END IF; END $$;`);
  }
  statements.push(`INSERT INTO inventory.audit (firm_id,branch_id,warehouse_id,entity_id,action,request_id,actor,detail,occurred_at) SELECT ${firm},${branch},${warehouseId},${sqlString(countId)},'count_started',${sqlString(countId)},'demo-seed',${sqlString(`${demo.countLines.length} hammadde · örnek sayım taslağı`)},${sqlString(now)} WHERE NOT EXISTS (SELECT 1 FROM inventory.audit WHERE firm_id=${firm} AND branch_id=${branch} AND entity_id=${sqlString(countId)} AND action='count_started');`);
} else {
for (const [index, category] of demo.categories.entries()) statements.push(
  `INSERT INTO catalog.categories (firm_id,id,brand_id,name,is_active,sort_order,version,updated_at) VALUES (${firm},${sqlString(category.id)},NULL,${sqlString(category.name)},true,${index},1,${sqlString(now)}) ON CONFLICT (firm_id,id) DO NOTHING;`
);
for (const product of demo.products) {
  const category = demo.categories.find((item) => item.id === product.categoryId);
  statements.push(`INSERT INTO catalog.products (id,firm_id,brand_id,name,sku,category_id,category_name,status,channels,image,recipe_linked,base_price_minor,currency,description,allergens,option_groups,branch_ids,updated_at,version) VALUES (${sqlString(product.id)},${firm},NULL,${sqlString(product.name)},${sqlString(product.sku)},${sqlString(category.id)},${sqlString(category.name)},'published',${sqlArray(["pos"])},${sqlString(product.image)},false,${product.priceMinor},'TRY',${sqlString(product.description)},${sqlArray(product.allergens)},${sqlArray([])},${sqlArray([demo.branch.id])},${sqlString(now)},1) ON CONFLICT (id) DO NOTHING;`);
  const suffix = product.id.slice(-3);
  const priceVersionId = `77777777-7777-4777-8777-777777777${suffix}`;
  const publicationId = `88888888-8888-4888-8888-888888888${suffix}`;
  statements.push(`INSERT INTO catalog.price_versions (id,firm_id,branch_id,product_id,number,amount_minor,currency,actor,created_at) VALUES (${sqlString(priceVersionId)},${firm},${branch},${sqlString(product.id)},1,${product.priceMinor},'TRY','demo-seed',${sqlString(now)}) ON CONFLICT (id) DO NOTHING;`);
  statements.push(`INSERT INTO catalog.publications (id,firm_id,branch_id,product_id,number,price_version_id,product_name,sku,category_id,category_name,amount_minor,currency,channels,published_at,actor) VALUES (${sqlString(publicationId)},${firm},${branch},${sqlString(product.id)},1,${sqlString(priceVersionId)},${sqlString(product.name)},${sqlString(product.sku)},${sqlString(category.id)},${sqlString(category.name)},${product.priceMinor},'TRY',${sqlArray(["pos"])},${sqlString(now)},'demo-seed') ON CONFLICT (id) DO NOTHING;`);
}
}
statements.push("COMMIT;");
const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1"], {
  env: {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.slice(1),
  },
  stdio: ["pipe", "inherit", "inherit"],
});
child.stdin.end(statements.join("\n"));
const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
if (code !== 0) process.exit(code);
console.log(cariOnly
  ? `Demo cari seed'i ${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)} veritabanında tamamlandı: ${demo.parties.length} kart, ${demo.partyMovements.length} hareket. Tekrar çalıştırmak mevcut kayıtları değiştirmez.`
  : serviceOnly
    ? `Demo servis seed'i ${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)} veritabanında tamamlandı: ${demo.serviceDemo.tableCount} masa, ${demo.serviceDemo.waiters.length + demo.serviceDemo.employees.length} personel kartı, ${demo.serviceDemo.orders.length} sipariş, ${demo.serviceDemo.assignments.length} masa bağı. Mevcut kayıtlar değiştirilmedi.`
  : inventoryOnly
    ? `Demo stok seed'i ${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)} veritabanında tamamlandı: ${demo.ingredients.length} hammadde, ${demo.recipes.length} reçete, ${demo.stockMovements.length} hareket, ${demo.countLines.length} kalemli 1 sayım taslağı. Mevcut kayıtlar değiştirilmedi.`
  : `Demo katalog seed'i bu ortamda ${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.slice(1)} veritabanında tamamlandı: ${demo.firm.name} / ${demo.branch.name}. Cari için ayrıca demo:seed:cari gerekir; reçete, stok ve sayım henüz veritabanına yazılmadı.`);
