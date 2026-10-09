import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Boxes, ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { DemoNotice, MetricCard, PageHeading, StatusPill } from "../../shared/ui";

type Warehouse = { id: string; name: string; isActive: boolean };
type Ingredient = { id: string; warehouseId: string; name: string; unit: string; criticalBelow: number; onHand: number; belowThresholdBy: number; isCritical: boolean; isActive: boolean; version: number };
type Movement = { id: string; warehouseId: string; ingredientId: string; ingredientName: string; delta: number; unit: string; kind: string; description: string; createdAt: string; actor: string };
type RecipeLine = { ingredientId: string; ingredientName: string; quantity: number; unit: string };
type Recipe = { id: string; productId: string; productName: string; version: number; portion: string; createdAt: string; lines: RecipeLine[] };
type Estimate = { productId: string; productName: string; recipeVersion: number; portion: string; status: "ready" | "unit_mismatch"; theoreticalPortions: number | null; limitingIngredientId: string | null; limitingIngredientName: string | null; lines: Array<{ ingredientId: string; ingredientName: string; onHand: number; requiredPerPortion: number; possiblePortions: number | null; unit: string }>; explanation: string };
type CountLine = { ingredientId: string; ingredientName: string; unit: string; systemQuantity: number; physicalQuantity: number | null; difference: number | null; reviewStatus: "awaiting_count" | "review_required" | "matched" };
type Count = { id: string; warehouseId: string; status: "draft" | "approved" | "cancelled"; version: number; createdAt: string; createdBy: string; approvedAt: string | null; approvedBy: string | null; cancelledAt: string | null; cancelledBy: string | null; lines: CountLine[] };
type Product = { id: string; name: string };
type View = "summary" | "ingredients" | "warehouseStock" | "critical" | "movements" | "counts" | "recipes";

const labels: Record<View, string> = { summary: "Stok özeti", ingredients: "Hammadde", warehouseStock: "Depo stokları", critical: "Kritik stoklar", movements: "Stok hareket geçmişi", counts: "Stok sayımları", recipes: "Reçeteler" };
const fmtQty = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function InventoryHttpPage({ ctx, view, canWriteItems, canWriteRecipes, canWriteCounts }: {
  ctx: ViewContext; view: View; canWriteItems: boolean; canWriteRecipes: boolean; canWriteCounts: boolean;
}) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCountId, setSelectedCountId] = useState("");
  const [physicalDrafts, setPhysicalDrafts] = useState<Record<string, string>>({});
  const [ingredientName, setIngredientName] = useState("");
  const [ingredientUnit, setIngredientUnit] = useState("g");
  const [criticalBelow, setCriticalBelow] = useState("0");
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [movementIngredient, setMovementIngredient] = useState("");
  const [movementKind, setMovementKind] = useState<"manual_in" | "manual_out">("manual_in");
  const [movementQuantity, setMovementQuantity] = useState("");
  const [movementDescription, setMovementDescription] = useState("");
  const [recipeProduct, setRecipeProduct] = useState("");
  const [recipePortion, setRecipePortion] = useState("1 porsiyon");
  const [recipeQuantities, setRecipeQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const branchId = ctx.branchApiId;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const scope = branchId ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory` : null;
  const openCount = counts.find((count) => count.id === selectedCountId) ?? counts.find((count) => count.status === "draft") ?? null;
  const hasOpenCount = counts.some((count) => count.status === "draft");
  const critical = useMemo(() => ingredients.filter((ingredient) => ingredient.isCritical), [ingredients]);

  const api = useCallback(async <T,>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180"}${path}`, {
        method, headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error("Stok API'sine bağlanılamadı. API ve PostgreSQL sağlayıcısını kontrol edin."); }
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(problem.detail ?? `Stok işlemi başarısız (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [actor]);

  const reload = useCallback(async () => {
    if (!scope) { setLoading(false); setError("Önce tek bir şube seçin."); return; }
    setLoading(true); setError("");
    try {
      const warehouseResult = await api<{ items: Warehouse[] }>(`${scope}/warehouses`);
      const selectedWarehouseId = warehouseResult.items.some((warehouse) => warehouse.id === warehouseId)
        ? warehouseId : warehouseResult.items[0]?.id ?? "";
      setWarehouses(warehouseResult.items);
      setWarehouseId(selectedWarehouseId);
      const query = selectedWarehouseId ? `?warehouseId=${encodeURIComponent(selectedWarehouseId)}` : "";
      const [ingredientResult, movementResult, recipeResult, countResult] = await Promise.all([
        api<{ items: Ingredient[] }>(`${scope}/ingredients${query}`),
        api<{ items: Movement[] }>(`${scope}/movements${query}`),
        api<{ items: Recipe[] }>(`${scope}/recipes`),
        api<{ items: Count[] }>(`${scope}/counts${query}`),
      ]);
      const estimateResult = await api<{ items: Estimate[] }>(`${scope}/production-estimates${query}`);
      setIngredients(ingredientResult.items); setMovements(movementResult.items);
      setRecipes(recipeResult.items); setCounts(countResult.items); setEstimates(estimateResult.items);
      setSelectedCountId((current) => countResult.items.some((count) => count.id === current)
        ? current : countResult.items.find((count) => count.status === "draft")?.id ?? countResult.items[0]?.id ?? "");
      if (!movementIngredient && ingredientResult.items[0]) setMovementIngredient(ingredientResult.items[0].id);
      setLoading(false);
    } catch (reason) { setError((reason as Error).message); setLoading(false); }
  }, [api, scope, movementIngredient, warehouseId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (view !== "recipes" || !branchId) return;
    let cancelled = false;
    const path = `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/catalog/products?branchId=${encodeURIComponent(branchId)}&pageSize=100`;
    void api<{ items: Product[] }>(path).then((result) => {
      if (cancelled) return;
      setProducts(result.items);
      if (!recipeProduct && result.items[0]) setRecipeProduct(result.items[0].id);
    }).catch((reason) => { if (!cancelled) setError((reason as Error).message); });
    return () => { cancelled = true; };
  }, [api, branchId, ctx.firmId, recipeProduct, view]);

  useEffect(() => {
    const recipe = recipes.find((item) => item.productId === recipeProduct);
    setRecipePortion(recipe?.portion ?? "1 porsiyon");
    setRecipeQuantities(Object.fromEntries((recipe?.lines ?? []).map((line) => [line.ingredientId, String(line.quantity)])));
  }, [recipeProduct, recipes]);

  async function run(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await reload(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function createIngredient(event: FormEvent) {
    event.preventDefault();
    if (!scope) return;
    await run(async () => {
      await api(`${scope}/ingredients`, "POST", { requestId: crypto.randomUUID(), name: ingredientName.trim(), unit: ingredientUnit, criticalBelow: Number(criticalBelow) });
      setIngredientName(""); setCriticalBelow("0");
    }, "Hammadde kartı PostgreSQL'e kaydedildi.");
  }

  async function addMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !movementIngredient) return;
    const amount = Number(movementQuantity);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Miktar sıfırdan büyük olmalı."); return; }
    const delta = movementKind === "manual_in" ? amount : -amount;
    await run(async () => {
      await api(`${scope}/movements`, "POST", { requestId: crypto.randomUUID(), ingredientId: movementIngredient,
        warehouseId, delta, kind: movementKind, description: movementDescription.trim() });
      setMovementQuantity(""); setMovementDescription("");
    }, "Stok hareketi kalıcı deftere eklendi; bakiye hareket toplamından yeniden hesaplandı.");
  }

  async function saveRecipe(event: FormEvent) {
    event.preventDefault();
    if (!scope || !recipeProduct) return;
    const lines = ingredients.filter((ingredient) => recipeQuantities[ingredient.id]?.trim())
      .map((ingredient) => ({ ingredientId: ingredient.id, quantity: Number(recipeQuantities[ingredient.id]), unit: ingredient.unit }));
    if (!lines.length || lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setError("En az bir hammadde için sıfırdan büyük miktar girin."); return;
    }
    const current = recipes.find((recipe) => recipe.productId === recipeProduct);
    await run(async () => {
      await api(`${scope}/recipes/${encodeURIComponent(recipeProduct)}`, "PUT", {
        requestId: crypto.randomUUID(), expectedVersion: current?.version ?? 0, portion: recipePortion.trim(), lines,
      });
    }, "Yeni reçete sürümü PostgreSQL'e kaydedildi; önceki sürüm korundu.");
  }

  async function startCount() {
    if (!scope) return;
    await run(async () => {
      const created = await api<Count>(`${scope}/counts`, "POST", { requestId: crypto.randomUUID(), warehouseId });
      setSelectedCountId(created.id);
    }, "Sayım taslağı açıldı. Sistem miktarı bu başlangıç anında kaydedildi.");
  }

  async function saveCountLine(line: CountLine) {
    if (!scope || !openCount || physicalDrafts[line.ingredientId] === undefined) return;
    const physicalQuantity = Number(physicalDrafts[line.ingredientId]);
    if (!Number.isFinite(physicalQuantity) || physicalQuantity < 0) { setError("Fiziksel miktar sıfır veya daha büyük olmalı."); return; }
    await run(async () => {
      const updated = await api<Count>(`${scope}/counts/${encodeURIComponent(openCount.id)}/lines/${encodeURIComponent(line.ingredientId)}`, "PUT", {
        physicalQuantity, expectedVersion: openCount.version,
      });
      setSelectedCountId(updated.id);
      setCounts((current) => current.map((count) => count.id === updated.id ? updated : count));
    }, "Fiziksel sayım miktarı kaydedildi.");
  }

  async function approveCount() {
    if (!scope || !openCount) return;
    await run(async () => {
      const approved = await api<Count>(`${scope}/counts/${encodeURIComponent(openCount.id)}/approve`, "POST", {
        requestId: crypto.randomUUID(), expectedVersion: openCount.version,
      });
      setCounts((current) => current.map((count) => count.id === approved.id ? approved : count));
    }, "Sayım onaylandı. Farklar tekil stok düzeltme hareketlerine yazıldı.");
  }

  async function updateIngredient(item: Ingredient) {
    if (!scope) return;
    const value = Number(thresholdDrafts[item.id] ?? item.criticalBelow);
    if (!Number.isFinite(value) || value < 0) { setError("Kritik eşik sıfır veya daha büyük olmalı."); return; }
    await run(async () => {
      await api(`${scope}/ingredients/${encodeURIComponent(item.id)}`, "PUT", {
        requestId: crypto.randomUUID(), expectedVersion: item.version, unit: item.unit, criticalBelow: value,
      });
      setThresholdDrafts((current) => { const next = { ...current }; delete next[item.id]; return next; });
    }, "Kritik eşik ve birim ayarları denetim kaydıyla kaydedildi.");
  }

  async function cancelCount() {
    if (!scope || !openCount) return;
    await run(async () => {
      await api(`${scope}/counts/${encodeURIComponent(openCount.id)}/cancel`, "POST", {
        requestId: crypto.randomUUID(), expectedVersion: openCount.version,
      });
      setSelectedCountId("");
    }, "Sayım iptal edildi; stok değişmedi ve yeni hareketlere izin verildi.");
  }

  const pageTitle = labels[view];
  const visibleIngredients = view === "critical" ? critical : ingredients;
  return <>
    <PageHeading eyebrow="STOK VE TEDARİK · POSTGRESQL" title={pageTitle}
      description={`${ctx.selectedBranch?.name ?? "Seçili şube"} · miktarlar değiştirilebilir bir bakiye alanından değil, kalıcı hareket defterinden hesaplanır.`}
      action={<StatusPill tone={loading ? "neutral" : error ? "orange" : "green"}>{loading ? "Yükleniyor" : error ? "Bağlantı/kurulum gerekli" : "PostgreSQL · ilk stok dilimi"}</StatusPill>} />
    <DemoNotice>Bu geliştirme dilimi tek şube ve tek stok alanı içindir. Reçete sürümlüdür; satış reçeteden otomatik stok düşmez. Sayım farkı onay öncesi stoğu değiştirmez. API aktörü geliştirme kimliğidir, üretim yetkilendirmesi değildir.</DemoNotice>
    <div className="inventory-toolbar"><label>Fiziksel depo<select aria-label="Fiziksel depo" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><span>Depo, stok miktarlarının tutulduğu fiziksel konumdur.</span></div>
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {!branchId && <div className="card generic-empty">Kalıcı stok işlemleri için tek bir şube seçin.</div>}
    {loading && <div className="card generic-empty" role="status">Stok, reçete ve sayım verileri yükleniyor…</div>}

    {!loading && !error && view === "summary" && <>
      <div className="metric-grid compact-grid">
        <MetricCard icon={<Boxes size={23} />} title="HAMMADDE" value={String(ingredients.length)} foot="PostgreSQL kartları" tone="blue" />
        <MetricCard icon={<ClipboardCheck size={23} />} title="KRİTİK STOK" value={String(critical.length)} foot="Eşik altındaki miktarlar" tone="orange" />
        <MetricCard icon={<ClipboardCheck size={23} />} title="REÇETE" value={String(recipes.length)} foot="En güncel sürüm / ürün" tone="purple" />
        <MetricCard icon={<ClipboardCheck size={23} />} title="AÇIK SAYIM" value={String(counts.filter((count) => count.status === "draft").length)} foot="Onay bekleyen taslaklar" tone="green" />
      </div>
      <div className="inventory-toolbar"><Link to="/admin/inventory/ingredients">Hammadde <ArrowRight size={15} /></Link><Link to="/admin/inventory/recipes">Reçeteler <ArrowRight size={15} /></Link><Link to="/admin/inventory/counts">Sayım <ArrowRight size={15} /></Link><Link to="/admin/inventory/movements">Hareketler <ArrowRight size={15} /></Link></div>
      <IngredientTable items={ingredients} editable={false} />
    </>}

    {!loading && !error && (view === "ingredients" || view === "critical") && <>
      {view === "ingredients" && canWriteItems && <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">YENİ KART</span><h2>Hammadde ekle</h2></div></div>
        <form className="cari-form" onSubmit={createIngredient}>
          <label>Hammadde adı<input value={ingredientName} onChange={(event) => setIngredientName(event.target.value)} minLength={2} maxLength={160} required /></label>
          <label>Birim<select value={ingredientUnit} onChange={(event) => setIngredientUnit(event.target.value)}><option value="g">g · gram</option><option value="kg">kg · kilogram</option><option value="ml">ml · mililitre</option><option value="l">l · litre</option><option value="adet">adet</option></select></label>
          <label>Kritik eşik<input type="number" min="0" step="0.001" value={criticalBelow} onChange={(event) => setCriticalBelow(event.target.value)} required /></label>
          <button className="primary-button" disabled={busy || hasOpenCount}><Plus size={15} /> PostgreSQL'e kaydet</button>
        </form>
        {hasOpenCount && <p className="card-note">Depoda açık sayım var. Yeni hammadde kartı, sayım onaylanana veya iptal edilene kadar kilitli.</p>}
      </section>}
      <IngredientTable items={visibleIngredients} editable={view === "ingredients" && canWriteItems} thresholdDrafts={thresholdDrafts} setThresholdDrafts={setThresholdDrafts} onSave={updateIngredient} busy={busy} />
      {view === "ingredients" && canWriteItems && ingredients.length > 0 && <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">YENİ HAREKET</span><h2>Stok giriş/çıkışı</h2></div></div>
        <form className="cari-form" onSubmit={addMovement}>
          <label>Hammadde<select value={movementIngredient} onChange={(event) => setMovementIngredient(event.target.value)}>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} · {fmtQty(item.onHand)} {item.unit}</option>)}</select></label>
          <label>Hareket türü<select value={movementKind} onChange={(event) => setMovementKind(event.target.value as "manual_in" | "manual_out")}><option value="manual_in">Stok girişi</option><option value="manual_out">Stok çıkışı</option></select></label>
          <label>Miktar<input type="number" min="0.001" step="0.001" value={movementQuantity} onChange={(event) => setMovementQuantity(event.target.value)} required /></label>
          <label>Açıklama<input value={movementDescription} onChange={(event) => setMovementDescription(event.target.value)} minLength={3} maxLength={500} required /></label>
          <button className="primary-button" disabled={busy || hasOpenCount}><Plus size={15} /> Hareketi kaydet</button>
        </form>
        {hasOpenCount && <p className="card-note">Depoda açık sayım var; yeni stok hareketi kabul edilmiyor.</p>}
      </section>}
      {view === "ingredients" && <p className="card-note">Kritik eşik yalnızca uyarı seviyesidir; stok miktarı hareket defterinden hesaplanır. Açık sayım varken stok hareketleri ve yeni hammadde kartı engellenir.</p>}
    </>}

    {!loading && !error && view === "movements" && <MovementTable items={movements} />}

    {!loading && !error && view === "recipes" && <>
      <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">YENİ SÜRÜM</span><h2>Ürün reçetesini düzenle</h2></div></div>
        <form className="cari-form" onSubmit={saveRecipe}>
          <label>Ürün<select value={recipeProduct} onChange={(event) => setRecipeProduct(event.target.value)}>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
          <label>Porsiyon tanımı<input value={recipePortion} onChange={(event) => setRecipePortion(event.target.value)} minLength={2} maxLength={120} required /></label>
          <div className="inventory-recipe-inputs">{ingredients.filter((ingredient) => ingredient.isActive).map((ingredient) => <label key={ingredient.id}>{ingredient.name} ({ingredient.unit})<input aria-label={`${ingredient.name} (${ingredient.unit})`} type="number" min="0" step="0.001" value={recipeQuantities[ingredient.id] ?? ""} onChange={(event) => setRecipeQuantities((current) => ({ ...current, [ingredient.id]: event.target.value }))} placeholder="Kullanılmıyor" /></label>)}</div>
          <button className="primary-button" disabled={!canWriteRecipes || busy || products.length === 0}>{canWriteRecipes ? "Yeni reçete sürümünü kaydet" : "Reçete modülü kapalı"}</button>
        </form>
      </section>
      <div className="generic-grid">{recipes.map((recipe) => { const estimate = estimates.find((item) => item.productId === recipe.productId); return <section className="card demo-recipe-card" key={recipe.id}><span className="card-kicker">SÜRÜM {recipe.version} · {recipe.portion}</span><h2>{recipe.productName}</h2><ul>{recipe.lines.map((line) => <li key={line.ingredientId}><span>{line.ingredientName}</span><strong>{fmtQty(line.quantity)} {line.unit}</strong></li>)}</ul><div className="notice" role="status">{estimate?.status === "unit_mismatch" ? "Birim uyuşmazlığı: teorik üretim hesaplanamadı." : <>Teorik üretim kapasitesi: <strong>{fmtQty(estimate?.theoreticalPortions ?? 0)} porsiyon</strong>{estimate?.limitingIngredientName ? ` · Kısıtlayan: ${estimate.limitingIngredientName}` : ""}</>}<small>{estimate?.explanation ?? "Tahmin kullanılamıyor."} Bu değer üretim emri veya garanti edilmiş satış kapasitesi değildir.</small></div></section>; })}</div>
      {recipes.length === 0 && <div className="card generic-empty">Henüz kalıcı reçete yok. Ürün ve hammaddeleri seçerek ilk sürümü kaydedin.</div>}
    </>}

    {!loading && !error && view === "counts" && <>
      <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">SİSTEM ANLIK GÖRÜNTÜSÜ</span><h2>Sayım taslağı</h2></div><button className="primary-button" disabled={!canWriteCounts || busy || ingredients.length === 0 || hasOpenCount} onClick={() => void startCount()}><Plus size={15} /> Yeni sayım başlat</button></div>
        {counts.length > 0 && <label className="count-select">Sayım<select aria-label="Sayım seç" value={openCount?.id ?? ""} onChange={(event) => setSelectedCountId(event.target.value)}>{counts.map((count) => <option key={count.id} value={count.id}>{dateTime(count.createdAt)} · {count.status === "draft" ? "Taslak" : count.status === "approved" ? "Onaylandı" : "İptal edildi"}</option>)}</select></label>}
        {openCount && <><div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>SİSTEM MİKTARI · SAYIM BAŞI</th><th>FİZİKSEL MİKTAR</th><th>FARK</th><th>UYUŞMAZLIK</th><th /></tr></thead><tbody>{openCount.lines.map((line) => <tr key={line.ingredientId}><td><strong>{line.ingredientName}</strong></td><td>{fmtQty(line.systemQuantity)} {line.unit}</td><td>{openCount.status === "draft" ? <input aria-label={`${line.ingredientName} fiziksel miktar`} className="count-quantity" type="number" min="0" step="0.001" value={physicalDrafts[`${openCount.id}:${line.ingredientId}`] ?? (line.physicalQuantity === null ? "" : String(line.physicalQuantity))} onChange={(event) => setPhysicalDrafts((current) => ({ ...current, [`${openCount.id}:${line.ingredientId}`]: event.target.value }))} /> : `${fmtQty(line.physicalQuantity ?? 0)} ${line.unit}`}</td><td>{line.difference === null ? "—" : `${line.difference > 0 ? "+" : ""}${fmtQty(line.difference)} ${line.unit}`}</td><td><StatusPill tone={line.reviewStatus === "review_required" ? "orange" : line.reviewStatus === "matched" ? "green" : "neutral"}>{line.reviewStatus === "review_required" ? "İnceleme gerekli" : line.reviewStatus === "matched" ? "Eşleşti" : "Sayım bekliyor"}</StatusPill></td><td>{openCount.status === "draft" && <button className="soft-button" disabled={!canWriteCounts || busy} onClick={() => void saveCountLine(line)}>Miktarı kaydet</button>}</td></tr>)}</tbody></table></div>
          {openCount.status === "draft" ? <div className="count-approval"><p>Onay öncesi stok değişmez. Açık sayım boyunca yeni hareket kabul edilmez. Onay, fark başına tekil düzeltme hareketi üretir.</p><button className="primary-button" disabled={!canWriteCounts || busy || openCount.lines.some((line) => line.physicalQuantity === null)} onClick={() => void approveCount()}><ClipboardCheck size={15} /> Sayımı onayla ve düzeltmeleri kaydet</button><button className="soft-button" disabled={!canWriteCounts || busy} onClick={() => void cancelCount()}>Sayımı iptal et</button></div> : openCount.status === "approved" ? <div className="notice" role="status">Onaylayan: {openCount.approvedBy} · {openCount.approvedAt ? dateTime(openCount.approvedAt) : ""}. Düzeltme hareketleri deftere yazıldı.</div> : <div className="notice" role="status">Sayım iptal edildi. Stokta düzeltme yapılmadı.</div>}
        </>}
        {!openCount && <div className="card generic-empty">Henüz sayım yok. Sayım başlattığınızda stok miktarları o an için sabitlenir.</div>}
      </section>
      {counts.filter((count) => count.status === "approved").length > 0 && <div className="card generic-empty">Onaylanmış sayımlar geriye dönük değiştirilemez; düzeltmeler Stok Hareketleri ekranında izlenir.</div>}
    </>}
    {!loading && <button className="soft-button inventory-refresh" onClick={() => void reload()}><RefreshCw size={14} /> Verileri yenile</button>}
  </>;
}

function IngredientTable({ items, editable = false, thresholdDrafts, setThresholdDrafts, onSave, busy = false }: { items: Ingredient[]; editable?: boolean; thresholdDrafts?: Record<string, string>; setThresholdDrafts?: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSave?: (item: Ingredient) => void; busy?: boolean }) {
  return <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">STOK KARTLARI</span><h2>Hammadde durumu</h2></div></div>
    <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>MEVCUT MİKTAR</th><th>KRİTİK EŞİK</th><th>EŞİK ALTINDA</th><th>DURUM</th>{editable && <th>AYAR</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{fmtQty(item.onHand)} {item.unit}</td><td>{editable ? <input aria-label={`${item.name} kritik eşik`} type="number" min="0" step="0.001" value={thresholdDrafts?.[item.id] ?? String(item.criticalBelow)} onChange={(event) => setThresholdDrafts?.((current) => ({ ...current, [item.id]: event.target.value }))} /> : `${fmtQty(item.criticalBelow)} ${item.unit}`}</td><td>{item.isCritical ? `${fmtQty(item.belowThresholdBy)} ${item.unit}` : "—"}</td><td><StatusPill tone={item.isCritical ? "orange" : "green"}>{item.isCritical ? "Kritik" : "Yeterli"}</StatusPill></td>{editable && <td><button className="soft-button" disabled={busy} onClick={() => onSave?.(item)}>Eşiği kaydet</button></td>}</tr>)}</tbody></table>{items.length === 0 && <div className="empty-list">Bu kapsamda hammadde kaydı yok.</div>}</div>
  </section>;
}

function MovementTable({ items }: { items: Movement[] }) {
  const kindName: Record<string, string> = { opening: "Açılış", manual_in: "Elle giriş", manual_out: "Elle çıkış", count_adjustment: "Sayım düzeltmesi" };
  return <section className="card content-card"><div className="card-heading padded"><div><span className="card-kicker">DEĞİŞTİRİLEMEZ HAREKET DEFTERİ</span><h2>Son stok hareketleri</h2></div></div><div className="table-scroll"><table><thead><tr><th>ZAMAN</th><th>HAMMADDE</th><th>KAYNAK</th><th>AÇIKLAMA</th><th>MİKTAR ETKİSİ</th><th>AKTÖR</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td>{item.ingredientName}</td><td>{kindName[item.kind] ?? item.kind}</td><td>{item.description}</td><td>{item.delta > 0 ? "+" : ""}{fmtQty(item.delta)} {item.unit}</td><td>{item.actor}</td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-list">Henüz stok hareketi yok.</div>}</div></section>;
}
