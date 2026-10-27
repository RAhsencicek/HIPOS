import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Warehouse = { id: string; name: string; isActive: boolean };
type Ingredient = { id: string; name: string; unit: string; onHand: number; isActive: boolean };
type Waste = { id: string; warehouseId: string; ingredientId: string; ingredientName: string; quantity: number; unit: string; reasonType: string; description: string; createdAt: string; reportedBy: string };

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
      const [ingredientResult, wasteResult] = await Promise.all([
        api<{ items: Ingredient[] }>(`${scope}/ingredients${query}`),
        api<{ items: Waste[] }>(`${scope}/waste${query}`),
      ]);
      const active = ingredientResult.items.filter((item) => item.isActive);
      setWarehouses(warehouseResult.items); setWarehouseId(selected); setIngredients(active); setItems(wasteResult.items);
      setIngredientId((current) => active.some((item) => item.id === current) ? current : active[0]?.id ?? "");
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, [api, scope, warehouseId]);

  useEffect(() => { void reload(); }, [reload]);
  const selectedIngredient = useMemo(() => ingredients.find((item) => item.id === ingredientId), [ingredientId, ingredients]);
  const amount = Number(quantity);
  const valid = Boolean(canWrite && warehouseId && ingredientId && Number.isFinite(amount) && amount > 0 &&
    amount <= (selectedIngredient?.onHand ?? 0) && description.trim().length >= 3);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`${scope}/waste`, "POST", { requestId: crypto.randomUUID(), warehouseId, ingredientId, quantity: amount, reasonType, description: description.trim() });
      setQuantity(""); setDescription("");
      setNotice("Fire kaydı oluşturuldu ve miktar stoktan düşüldü.");
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading eyebrow="STOK VE TEDARİK" title="Fire kayıtları"
      description={`${ctx.selectedBranch?.name ?? "Seçili şube"} · dökülen, bozulan veya kullanılamayan hammaddeleri gerekçesiyle kaydedin.`}
      action={<StatusPill tone="green">PostgreSQL</StatusPill>} />
    <DemoNotice>Fire kaydı değiştirilemez bir stok çıkışı oluşturur. Gerçek şef PIN onayı, kimlik ve yetkilendirme modülü tamamlandığında bağlanacaktır.</DemoNotice>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    <section className="card content-card waste-card">
      <div className="card-heading padded"><div><span className="card-kicker">YENİ KAYIT</span><h2>Gerekçeli fire / zayi</h2></div><AlertTriangle size={20} /></div>
      <form className="waste-form" onSubmit={submit}>
        <label>Depo<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Hammadde<select value={ingredientId} onChange={(event) => setIngredientId(event.target.value)}>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name} · {qty(item.onHand)} {item.unit}</option>)}</select></label>
        <label>Miktar<div className="waste-quantity"><input type="number" min="0.001" max={selectedIngredient?.onHand ?? undefined} step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /><span>{selectedIngredient?.unit ?? "—"}</span></div></label>
        <label>Fire türü<select value={reasonType} onChange={(event) => setReasonType(event.target.value)}>{Object.entries(reasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="waste-description">Açıklama<textarea rows={3} maxLength={500} placeholder="Örn. Dolap arızası sebebiyle bozuldu" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="waste-submit"><span>Mevcut stok: <strong>{qty(selectedIngredient?.onHand ?? 0)} {selectedIngredient?.unit ?? ""}</strong></span><button className="primary-button" disabled={!valid || busy}>{busy ? "Kaydediliyor…" : "Fireyi kaydet ve stoktan düş"}</button></div>
      </form>
    </section>
    <section className="card content-card">
      <div className="card-heading padded"><div><span className="card-kicker">KAYIP GEÇMİŞİ</span><h2>Fire ve zayi kayıtları</h2></div><button className="soft-button" disabled={loading} onClick={() => void reload()}><RefreshCw size={14} /> Yenile</button></div>
      <div className="table-scroll"><table><thead><tr><th>ZAMAN</th><th>HAMMADDE</th><th>TÜR</th><th>AÇIKLAMA</th><th>MİKTAR</th><th>KAYDEDEN</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td><strong>{item.ingredientName}</strong></td><td>{reasons[item.reasonType] ?? item.reasonType}</td><td>{item.description}</td><td>-{qty(item.quantity)} {item.unit}</td><td>{item.reportedBy}</td></tr>)}</tbody></table>{!loading && items.length === 0 && <div className="empty-list">Henüz fire kaydı yok.</div>}</div>
    </section>
  </>;
}
