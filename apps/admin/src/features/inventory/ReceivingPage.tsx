import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2, Truck } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Warehouse = { id: string; name: string; isActive: boolean };
type Ingredient = { id: string; name: string; unit: string; isActive: boolean };
type Supplier = { id: string; name: string; types: string[]; isActive: boolean };
type Line = { id: string; ingredientId: string; quantity: string; unitPrice: string; discountRate: string; taxRate: string };
type PurchaseLine = { id: string; ingredientName: string; quantity: number; unit: string; unitPriceMinor: number; discountRateBps: number; taxRateBps: number; netMinor: number; taxMinor: number; totalMinor: number };
type PurchaseCorrection = { id: string; purchaseLineId: string; quantity: number; unit: string; reason: string; totalMinor: number; createdAt: string; createdBy: string };
type PurchaseReturn = PurchaseCorrection & { documentNumber: string; documentDate: string };
type Purchase = { id: string; warehouseId: string; supplierName: string; documentNumber: string; documentDate: string; status: "draft" | "approved"; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; version: number; createdAt: string; createdBy: string; approvedAt?: string; approvedBy?: string; lines: PurchaseLine[]; corrections: PurchaseCorrection[]; returns: PurchaseReturn[] };

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const emptyLine = (): Line => ({ id: crypto.randomUUID(), ingredientId: "", quantity: "", unitPrice: "", discountRate: "0", taxRate: "10" });
const number = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const lineAmounts = (line: Line) => {
  const gross = Math.round(number(line.quantity) * number(line.unitPrice) * 100);
  const discount = Math.round(gross * number(line.discountRate) / 100);
  const net = gross - discount;
  const tax = Math.round(net * number(line.taxRate) / 100);
  return { gross, discount, net, tax, total: net + tax };
};

async function get<T>(path: string, actor: string): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { headers: { "X-Demo-Actor": actor } });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(problem.detail ?? `Veri yüklenemedi (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, actor: string, body: unknown): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Actor": actor }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(problem.detail ?? `İşlem tamamlanamadı (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function ReceivingPage({ ctx, canWrite }: { ctx: ViewContext; canWrite: boolean }) {
  const branchId = ctx.branchApiId;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentDate, setDocumentDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [quickTotal, setQuickTotal] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [message, setMessage] = useState("");
  const [returnLineId, setReturnLineId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnDocumentNumber, setReturnDocumentNumber] = useState("");
  const [returnDocumentDate, setReturnDocumentDate] = useState(today);
  const [returnReason, setReturnReason] = useState("");

  useEffect(() => {
    if (!branchId) { setLoading(false); setError("Mal kabul taslağı için bir şube seçin."); return; }
    const firm = encodeURIComponent(ctx.firmId);
    const branch = encodeURIComponent(branchId);
    const inventory = `/api/v1/firms/${firm}/branches/${branch}/inventory`;
    const caris = `/api/v1/firms/${firm}/branches/${branch}/caris`;
    setLoading(true); setError("");
    void Promise.all([
      get<{ items: Warehouse[] }>(`${inventory}/warehouses`, actor),
      get<{ items: Ingredient[] }>(`${inventory}/ingredients`, actor),
      get<{ items: Supplier[] }>(caris, actor),
      get<{ items: Purchase[] }>(`${inventory}/purchases`, actor),
    ]).then(([warehouseResult, ingredientResult, supplierResult, purchaseResult]) => {
      const activeIngredients = ingredientResult.items.filter((item) => item.isActive);
      const activeSuppliers = supplierResult.items.filter((item) => item.isActive && item.types.includes("supplier"));
      setWarehouses(warehouseResult.items.filter((item) => item.isActive));
      setIngredients(activeIngredients); setSuppliers(activeSuppliers);
      setPurchases(purchaseResult.items);
      setWarehouseId(warehouseResult.items.find((item) => item.isActive)?.id ?? "");
      setSupplierId(activeSuppliers[0]?.id ?? "");
      setLines([ { ...emptyLine(), ingredientId: activeIngredients[0]?.id ?? "" } ]);
    }).catch((reason) => setError((reason as Error).message)).finally(() => setLoading(false));
  }, [actor, branchId, ctx.firmId]);

  const totals = useMemo(() => lines.reduce((sum, line) => {
    const value = lineAmounts(line);
    return { gross: sum.gross + value.gross, discount: sum.discount + value.discount,
      net: sum.net + value.net, tax: sum.tax + value.tax, total: sum.total + value.total };
  }, { gross: 0, discount: 0, net: 0, tax: 0, total: 0 }), [lines]);
  const valid = Boolean(warehouseId && supplierId && documentNumber.trim() && lines.length &&
    lines.every((line) => line.ingredientId && number(line.quantity) > 0 && number(line.unitPrice) > 0 &&
      number(line.discountRate) >= 0 && number(line.discountRate) <= 100 && number(line.taxRate) >= 0));
  const selectedPurchase = purchases.find((purchase) => purchase.id === selectedPurchaseId);

  const updateLine = (id: string, patch: Partial<Line>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  const applyQuickTotal = () => {
    const line = lines[0];
    const quantity = number(line?.quantity ?? "");
    const taxRate = number(line?.taxRate ?? "");
    const total = number(quickTotal);
    if (!line || lines.length !== 1 || quantity <= 0 || total <= 0) {
      setError("Hızlı toplam hesabı için tek satırda miktar ve KDV dahil toplam girin."); return;
    }
    const netUnitPrice = total / (1 + taxRate / 100) / quantity;
    updateLine(line.id, { unitPrice: netUnitPrice.toFixed(4), discountRate: "0" });
    setError("");
  };

  const inventoryPath = branchId ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory` : "";
  const saveDraft = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const purchase = await post<Purchase>(`${inventoryPath}/purchases`, actor, {
        requestId: crypto.randomUUID(), warehouseId, supplierCariId: supplierId, documentNumber: documentNumber.trim(), documentDate,
        lines: lines.map((line) => ({ ingredientId: line.ingredientId, quantity: number(line.quantity), unitPriceMinor: Math.round(number(line.unitPrice) * 100), discountRateBps: Math.round(number(line.discountRate) * 100), taxRateBps: Math.round(number(line.taxRate) * 100) })),
      });
      setPurchases((current) => [purchase, ...current]); setDocumentNumber(""); setQuickTotal("");
      setLines([{ ...emptyLine(), ingredientId: ingredients[0]?.id ?? "" }]);
      setMessage("Mal kabul taslağı kaydedildi; stok ve cari henüz değişmedi.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const approve = async (purchase: Purchase) => {
    if (busy) return;
    setBusy(true); setError(""); setApprovalError(""); setMessage("");
    try {
      const approved = await post<Purchase>(`${inventoryPath}/purchases/${purchase.id}/approve`, actor, { requestId: crypto.randomUUID(), expectedVersion: purchase.version });
      setPurchases((current) => current.map((item) => item.id === approved.id ? approved : item));
      setMessage(`${purchase.documentNumber} onaylandı; stok girişleri ve tedarikçi borcu birlikte kaydedildi.`);
    } catch (reason) { setApprovalError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const returnDelivery = async (purchase: Purchase) => {
    const quantity = number(returnQuantity);
    if (busy || !returnLineId || quantity <= 0 || !returnDocumentNumber.trim() || returnReason.trim().length < 3) return;
    setBusy(true); setError(""); setApprovalError(""); setMessage("");
    try {
      const returned = await post<PurchaseReturn>(`${inventoryPath}/purchases/${purchase.id}/returns`, actor, {
        requestId: crypto.randomUUID(), purchaseLineId: returnLineId, documentNumber: returnDocumentNumber.trim(),
        documentDate: returnDocumentDate, quantity, reason: returnReason.trim(),
      });
      setPurchases((current) => current.map((item) => item.id === purchase.id
        ? { ...item, returns: [returned, ...(item.returns ?? [])] } : item));
      setReturnQuantity(""); setReturnDocumentNumber(""); setReturnReason("");
      setMessage(`${returned.documentNumber} numaralı tedarikçi iadesi işlendi; stok ve tedarikçi borcu birlikte azaltıldı.`);
    } catch (reason) { setApprovalError((reason as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <PageHeading eyebrow="STOK VE TEDARİK" title="Mal kabul"
      description={`${ctx.selectedBranch?.name ?? "Seçili şube"} · gelen hammaddeyi ve tedarikçi borç etkisini birlikte kontrol edin.`}
      action={<StatusPill tone="green">Çalışıyor</StatusPill>} />
    {!canWrite && <DemoNotice>Mal kabul özelliği bu şubede yeni işlemlere kapalı. Geçmiş belgeleri görebilirsiniz.</DemoNotice>}
    {error && <div className="notice" role="alert">{error}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {loading ? <div className="card generic-empty">Mal kabul sözlükleri yükleniyor…</div> : <>
      <section className="card content-card receiving-document">
        <div className="card-heading padded"><div><span className="card-kicker">BELGE BİLGİLERİ</span><h2>Gelen mal belgesi</h2></div></div>
        <div className="cari-form receiving-header">
          <label>Tedarikçi<select value={supplierId} disabled={!canWrite || busy} onChange={(event) => setSupplierId(event.target.value)}><option value="">Tedarikçi seçin</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
          <label>Depo<select value={warehouseId} disabled={!canWrite || busy} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label>İrsaliye / fatura no<input value={documentNumber} disabled={!canWrite || busy} onChange={(event) => setDocumentNumber(event.target.value)} maxLength={100} /></label>
          <label>Belge tarihi<input type="date" value={documentDate} disabled={!canWrite || busy} onChange={(event) => setDocumentDate(event.target.value)} /></label>
        </div>
      </section>

      <section className="card content-card receiving-lines">
        <div className="card-heading padded"><div><span className="card-kicker">HAMMADDELER</span><h2>Mal kabul satırları</h2></div>
          <button className="soft-button" disabled={!canWrite || busy} onClick={() => setLines((current) => [...current, { ...emptyLine(), ingredientId: ingredients[0]?.id ?? "" }])}><Plus size={15} /> Satır ekle</button></div>
        <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>MİKTAR</th><th>BİRİM FİYAT<br/><small>KDV HARİÇ</small></th><th>İSKONTO %</th><th>KDV %</th><th>NET</th><th>KDV</th><th>TOPLAM</th><th /></tr></thead>
          <tbody>{lines.map((line) => { const ingredient = ingredients.find((item) => item.id === line.ingredientId); const amount = lineAmounts(line); return <tr key={line.id}>
            <td data-label="Hammadde"><select aria-label="Hammadde" value={line.ingredientId} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { ingredientId: event.target.value })}>{ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td>
            <td data-label="Miktar"><div className="receiving-quantity"><input aria-label="Miktar" type="number" min="0.001" step="0.001" value={line.quantity} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { quantity: event.target.value })}/><span>{ingredient?.unit ?? "—"}</span></div></td>
            <td data-label="Birim fiyat"><input aria-label="KDV hariç birim fiyat" type="number" min="0.01" step="0.01" value={line.unitPrice} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}/></td>
            <td data-label="İskonto"><input aria-label="İskonto oranı" type="number" min="0" max="100" step="0.01" value={line.discountRate} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { discountRate: event.target.value })}/></td>
            <td data-label="KDV"><select aria-label="KDV oranı" value={line.taxRate} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { taxRate: event.target.value })}>{["0", "1", "10", "20"].map((rate) => <option key={rate} value={rate}>%{rate}</option>)}</select></td>
            <td data-label="Net">{money(amount.net)}</td><td data-label="KDV tutarı">{money(amount.tax)}</td><td data-label="Toplam"><strong>{money(amount.total)}</strong></td>
            <td className="receiving-line-action"><button className="icon-button" aria-label="Satırı sil" disabled={!canWrite || busy || lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><Trash2 size={15}/></button></td>
          </tr>; })}</tbody></table></div>
        <div className="receiving-quick"><label>KDV dahil hızlı toplam<input type="number" min="0.01" step="0.01" value={quickTotal} disabled={!canWrite || busy} onChange={(event) => setQuickTotal(event.target.value)} /></label><button className="soft-button" disabled={!canWrite || busy} onClick={applyQuickTotal}>Tek satıra uygula</button><small>Tek satırlı belgede seçili KDV oranına göre KDV hariç birim fiyatı hesaplar; iskonto sıfırlanır.</small></div>
      </section>

      <section className="card receiving-summary"><div><span>Ara toplam</span><strong>{money(totals.gross)}</strong></div><div><span>İskonto</span><strong>-{money(totals.discount)}</strong></div><div><span>KDV matrahı</span><strong>{money(totals.net)}</strong></div><div><span>KDV</span><strong>{money(totals.tax)}</strong></div><div className="receiving-grand-total"><span>Genel toplam / Cari borç</span><strong>{money(totals.total)}</strong></div></section>
      <div className="count-approval receiving-actions"><p>Taslak stok ve cariyi değiştirmez. Onayda stok girişleri ve tedarikçi borcu tek işlemde oluşur.</p><button className="primary-button" disabled={!canWrite || !valid || busy} onClick={() => void saveDraft()}><Truck size={16}/> {busy ? "İşleniyor…" : "Taslağı kaydet"}</button></div>
      {approvalError && <div className="notice receiving-approval-error" role="alert">{approvalError}</div>}
      <section className="card content-card receiving-lines"><div className="card-heading padded"><div><span className="card-kicker">BELGELER</span><h2>Mal kabul geçmişi</h2></div></div><div className="table-scroll"><table><thead><tr><th>BELGE</th><th>TARİH</th><th>TEDARİKÇİ</th><th>SATIR</th><th>TOPLAM</th><th>DURUM</th><th /></tr></thead><tbody>{purchases.length === 0 ? <tr><td colSpan={7}>Henüz mal kabul belgesi yok.</td></tr> : purchases.map((purchase) => <tr key={purchase.id}><td data-label="Belge"><strong>{purchase.documentNumber}</strong></td><td data-label="Tarih">{purchase.documentDate}</td><td data-label="Tedarikçi">{purchase.supplierName}</td><td data-label="Satır">{purchase.lines.length}</td><td data-label="Toplam">{money(purchase.totalMinor)}</td><td data-label="Durum"><StatusPill tone={purchase.status === "approved" ? "green" : "orange"}>{purchase.status === "approved" ? "Onaylandı" : "Taslak"}</StatusPill></td><td className="receiving-line-action"><button className="soft-button" onClick={() => setSelectedPurchaseId((current) => current === purchase.id ? null : purchase.id)}>{selectedPurchaseId === purchase.id ? "Kapat" : "Detay"}</button>{purchase.status === "draft" && <button className="soft-button" disabled={!canWrite || busy} onClick={() => void approve(purchase)}><Check size={15}/> Onayla</button>}</td></tr>)}</tbody></table></div></section>
      {selectedPurchase && <section className="card content-card receiving-detail">
        <div className="card-heading padded"><div><span className="card-kicker">BELGE DETAYI</span><h2>{selectedPurchase.documentNumber}</h2><p>{selectedPurchase.supplierName} · {selectedPurchase.documentDate}</p></div><StatusPill tone={selectedPurchase.status === "approved" ? "green" : "orange"}>{selectedPurchase.status === "approved" ? "Onaylandı" : "Taslak"}</StatusPill></div>
        <dl className="receiving-detail-meta"><div><dt>Depo</dt><dd>{warehouses.find((item) => item.id === selectedPurchase.warehouseId)?.name ?? "—"}</dd></div><div><dt>Oluşturan</dt><dd>{selectedPurchase.createdBy}</dd></div><div><dt>Onaylayan</dt><dd>{selectedPurchase.approvedBy ?? "Henüz onaylanmadı"}</dd></div></dl>
        <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>MİKTAR</th><th>BİRİM FİYAT</th><th>İSKONTO</th><th>KDV</th><th>TOPLAM</th></tr></thead><tbody>{selectedPurchase.lines.map((line) => <tr key={line.id}><td data-label="Hammadde">{line.ingredientName}</td><td data-label="Miktar">{line.quantity} {line.unit}</td><td data-label="Birim fiyat">{money(line.unitPriceMinor)}</td><td data-label="İskonto">%{line.discountRateBps / 100}</td><td data-label="KDV">%{line.taxRateBps / 100} · {money(line.taxMinor)}</td><td data-label="Toplam"><strong>{money(line.totalMinor)}</strong></td></tr>)}</tbody></table></div>
        <div className="receiving-detail-totals"><span>Ara toplam <strong>{money(selectedPurchase.subtotalMinor)}</strong></span><span>İskonto <strong>-{money(selectedPurchase.discountMinor)}</strong></span><span>KDV <strong>{money(selectedPurchase.taxMinor)}</strong></span><span>Genel toplam <strong>{money(selectedPurchase.totalMinor)}</strong></span></div>
        {selectedPurchase.status === "approved" && <div className="receiving-correction receiving-return">
          <div><span className="card-kicker">TEDARİKÇİYE İADE</span><h3>İade irsaliyesi</h3><p>Depoya alınmış ürünün sonradan tedarikçiye gönderilmesini resmi belge numarasıyla kaydeder.</p></div>
          <div className="receiving-return-form">
            <label>Hammadde<select value={returnLineId} disabled={!canWrite || busy} onChange={(event) => setReturnLineId(event.target.value)}><option value="">Satır seçin</option>{selectedPurchase.lines.map((line) => { const removed = [...(selectedPurchase.corrections ?? []), ...(selectedPurchase.returns ?? [])].filter((item) => item.purchaseLineId === line.id).reduce((sum, item) => sum + item.quantity, 0); const remaining = line.quantity - removed; return remaining > 0 && <option key={line.id} value={line.id}>{line.ingredientName} · en fazla {remaining} {line.unit}</option>; })}</select></label>
            <label>İade irsaliye no<input value={returnDocumentNumber} maxLength={100} disabled={!canWrite || busy} onChange={(event) => setReturnDocumentNumber(event.target.value)} /></label>
            <label>İade tarihi<input type="date" value={returnDocumentDate} disabled={!canWrite || busy} onChange={(event) => setReturnDocumentDate(event.target.value)} /></label>
            <label>Miktar<input type="number" min="0.001" step="0.001" value={returnQuantity} disabled={!canWrite || busy} onChange={(event) => setReturnQuantity(event.target.value)} /></label>
            <label className="receiving-return-reason">İade nedeni<input value={returnReason} maxLength={500} placeholder="Örn. Ürün nemli olduğu için iade edildi" disabled={!canWrite || busy} onChange={(event) => setReturnReason(event.target.value)} /></label>
            <button className="soft-button" disabled={!canWrite || busy || !returnLineId || !returnDocumentNumber.trim() || number(returnQuantity) <= 0 || returnReason.trim().length < 3} onClick={() => void returnDelivery(selectedPurchase)}>İadeyi kaydet</button>
          </div>
          {(selectedPurchase.returns ?? []).length > 0 && <div className="receiving-correction-history"><strong>İade geçmişi</strong>{selectedPurchase.returns.map((item) => <span key={item.id}>{item.documentNumber} · {item.documentDate} · {item.quantity} {item.unit} · -{money(item.totalMinor)} · {item.reason}</span>)}</div>}
        </div>}
      </section>}
    </>}
  </>;
}
