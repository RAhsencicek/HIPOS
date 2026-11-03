import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Warehouse = { id: string; name: string; isActive: boolean };
type Ingredient = { id: string; name: string; unit: string; onHand: number; isActive: boolean };
type Waste = { id: string; warehouseId: string; ingredientId: string; ingredientName: string; quantity: number; unit: string; reasonType: string; description: string; createdAt: string; reportedBy: string };
type RecipeWasteProduct = { productId: string; productName: string; recipeId: string; recipeVersion: number; portion: string; lines: { ingredientId: string; ingredientName: string; quantity: number; unit: string }[] };
type RecipeWaste = { id: string; warehouseId: string; productId: string; productName: string; recipeVersion: number; portions: number; reasonType: string; description: string; createdAt: string; reportedBy: string; lines: { ingredientId: string; ingredientName: string; quantity: number; unit: string }[] };

const reasons: Record<string, string> = {
  spoilage: "Bozulma", expired: "Son kullanma tarihi geçti", spill_breakage: "Dökülme / kırılma",
  burn: "Yanma", quality_control: "Kalite kontrol",
};
const qty = (value: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(value);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export function WastePage({ ctx, canWrite }: { ctx: ViewContext; canWrite: boolean }) {
  const branchId = ctx.branchApiId;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const scope = branchId ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory` : "";
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [items, setItems] = useState<Waste[]>([]);
  const [recipeItems, setRecipeItems] = useState<RecipeWaste[]>([]);
  const [products, setProducts] = useState<RecipeWasteProduct[]>([]);
  const [entryType, setEntryType] = useState<"ingredient" | "product">("ingredient");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reasonType, setReasonType] = useState("spoilage");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const api = useCallback(async <T,>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> => {
    const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
      method, headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(problem.detail ?? `Fire işlemi tamamlanamadı (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [actor]);

  const reload = useCallback(async () => {
    if (!scope) { setError("Önce tek bir şube seçin."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const warehouseResult = await api<{ items: Warehouse[] }>(`${scope}/warehouses`);
      const selected = warehouseResult.items.some((item) => item.id === warehouseId) ? warehouseId : warehouseResult.items[0]?.id ?? "";
      const query = selected ? `?warehouseId=${encodeURIComponent(selected)}` : "";
      const [ingredientResult, wasteResult, productResult, recipeWasteResult] = await Promise.all([
        api<{ items: Ingredient[] }>(`${scope}/ingredients${query}`),
        api<{ items: Waste[] }>(`${scope}/waste${query}`),
        api<{ items: RecipeWasteProduct[] }>(`${scope}/recipe-waste-products`),
        api<{ items: RecipeWaste[] }>(`${scope}/recipe-waste${query}`),
      ]);
      const active = ingredientResult.items.filter((item) => item.isActive);
      setWarehouses(warehouseResult.items); setWarehouseId(selected); setIngredients(active); setItems(wasteResult.items);
      setProducts(productResult.items); setRecipeItems(recipeWasteResult.items);
      setIngredientId((current) => active.some((item) => item.id === current) ? current : active[0]?.id ?? "");
      setProductId((current) => productResult.items.some((item) => item.productId === current) ? current : productResult.items[0]?.productId ?? "");
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, scope, warehouseId]);

  useEffect(() => { void reload(); }, [reload]);
  const selectedIngredient = useMemo(() => ingredients.find((item) => item.id === ingredientId), [ingredientId, ingredients]);
  const selectedProduct = useMemo(() => products.find((item) => item.productId === productId), [productId, products]);
  const amount = Number(quantity);
  const valid = Boolean(canWrite && warehouseId && Number.isFinite(amount) && amount > 0 && description.trim().length >= 3 &&
    (entryType === "ingredient" ? ingredientId && amount <= (selectedIngredient?.onHand ?? 0) : productId));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (entryType === "ingredient")
        await api(`${scope}/waste`, "POST", { requestId: crypto.randomUUID(), warehouseId, ingredientId, quantity: amount, reasonType, description: description.trim() });
      else
        await api(`${scope}/recipe-waste`, "POST", { requestId: crypto.randomUUID(), warehouseId, productId, portions: amount, reasonType, description: description.trim() });
      setQuantity(""); setDescription("");
      setNotice(entryType === "ingredient" ? "Fire kaydı oluşturuldu ve miktar stoktan düşüldü." : "Ürün zayisi oluşturuldu; reçete hammaddeleri stoktan birlikte düşüldü.");
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading eyebrow="STOK VE TEDARİK" title="Fire kayıtları"
      description={`${ctx.selectedBranch?.name ?? "Seçili şube"} · hammadde veya reçeteli ürün kaybını gerekçesiyle kaydedin.`}
      action={<StatusPill tone="green">PostgreSQL</StatusPill>} />
    <DemoNotice>Fire kaydı değiştirilemez bir stok çıkışı oluşturur. Gerçek şef PIN onayı, kimlik ve yetkilendirme modülü tamamlandığında bağlanacaktır.</DemoNotice>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    <section className="card content-card waste-card">
      <div className="card-heading padded"><div><span className="card-kicker">YENİ KAYIT</span><h2>Gerekçeli fire / zayi</h2></div><AlertTriangle size={20} /></div>
      <form className="waste-form" onSubmit={submit}>
        <label>Depo<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Kayıt türü<select value={entryType} onChange={(event) => { setEntryType(event.target.value as "ingredient" | "product"); setQuantity(""); }}><option value="ingredient">Hammadde firesi</option><option value="product">Reçeteli ürün zayisi</option></select></label>
        {entryType === "ingredient" ? <label>Hammadde<select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)}>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} · {qty(item.onHand)} {item.unit}</option>)}</select></label>
          : <label>Ürün<select value={productId} onChange={(event) => setProductId(event.target.value)}>{products.map((item) => <option key={item.productId} value={item.productId}>{item.productName} · reçete v{item.recipeVersion}</option>)}</select></label>}
        <label>{entryType === "ingredient" ? "Miktar" : "Zayi porsiyon"}<div className="waste-quantity"><input type="number" min="0.001" max={entryType === "ingredient" ? selectedIngredient?.onHand ?? undefined : undefined} step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><span>{entryType === "ingredient" ? selectedIngredient?.unit ?? "—" : "porsiyon"}</span></div></label>
        <label>Fire türü<select value={reasonType} onChange={(event) => setReasonType(event.target.value)}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="waste-description">Açıklama<textarea rows={3} maxLength={500} placeholder="Örn. Dolap arızası sebebiyle bozuldu" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {entryType === "product" && selectedProduct && <div className="waste-recipe-preview"><strong>Stoktan düşecek reçete</strong>{selectedProduct.lines.map((line) => <span key={line.ingredientId}>{line.ingredientName}: {qty(line.quantity * (amount || 0))} {line.unit}</span>)}</div>}
        <div className="waste-submit"><span>{entryType === "ingredient" ? <>Mevcut stok: <strong>{qty(selectedIngredient?.onHand ?? 0)} {selectedIngredient?.unit ?? ""}</strong></> : <>Aktif reçete: <strong>v{selectedProduct?.recipeVersion ?? "—"}</strong></>}</span><button className="primary-button" disabled={!valid || busy}>{busy ? "Kaydediliyor…" : entryType === "ingredient" ? "Fireyi kaydet ve stoktan düş" : "Ürün zayisini kaydet"}</button></div>
      </form>
    </section>
    <section className="card content-card">
      <div className="card-heading padded"><div><span className="card-kicker">KAYIP GEÇMİŞİ</span><h2>Fire ve zayi kayıtları</h2></div><button className="soft-button" disabled={loading} onClick={() => void reload()}><RefreshCw size={14} /> Yenile</button></div>
      <div className="table-scroll"><table><thead><tr><th>ZAMAN</th><th>HAMMADDE</th><th>TÜR</th><th>AÇIKLAMA</th><th>MİKTAR</th><th>KAYDEDEN</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td><strong>{item.ingredientName}</strong></td><td>{reasons[item.reasonType] ?? item.reasonType}</td><td>{item.description}</td><td>-{qty(item.quantity)} {item.unit}</td><td>{item.reportedBy}</td></tr>)}</tbody></table>{!loading && items.length === 0 && <div className="empty-list">Henüz fire kaydı yok.</div>}</div>
    </section>
    <section className="card content-card">
      <div className="card-heading padded"><div><span className="card-kicker">ÜRÜN ZAYİSİ GEÇMİŞİ</span><h2>Reçeteden düşülen ürünler</h2></div></div>
      <div className="table-scroll"><table><thead><tr><th>ZAMAN</th><th>ÜRÜN</th><th>PORSİYON</th><th>REÇETE</th><th>HAMMADDE ETKİSİ</th><th>NEDEN</th><th>KAYDEDEN</th></tr></thead><tbody>{recipeItems.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td><strong>{item.productName}</strong></td><td>{qty(item.portions)}</td><td>v{item.recipeVersion}</td><td>{item.lines.map((line) => `${line.ingredientName}: -${qty(line.quantity)} ${line.unit}`).join(" · ")}</td><td>{reasons[item.reasonType] ?? item.reasonType} · {item.description}</td><td>{item.reportedBy}</td></tr>)}</tbody></table>{!loading && recipeItems.length === 0 && <div className="empty-list">Henüz reçeteli ürün zayisi yok.</div>}</div>
    </section>
  </>;
}
