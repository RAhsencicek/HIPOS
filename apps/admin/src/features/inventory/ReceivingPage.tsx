import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Plus, Trash2, Truck, X } from "lucide-react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Warehouse = { id: string; name: string; isActive: boolean };
type Ingredient = { id: string; name: string; unit: string; isActive: boolean };
type Supplier = { id: string; name: string; types: string[]; isActive: boolean };
type Line = { id: string; ingredientId: string; quantity: string; unitPrice: string };
type PurchaseLine = { id: string; ingredientName: string; quantity: number; unit: string; unitPriceMinor: number; discountRateBps: number; taxRateBps: number; netMinor: number; taxMinor: number; totalMinor: number };
type PurchaseCorrection = { id: string; purchaseLineId: string; quantity: number; unit: string; reason: string; totalMinor: number; createdAt: string; createdBy: string };
type PurchaseReturn = PurchaseCorrection & { documentNumber: string; documentDate: string };
type Purchase = { id: string; warehouseId: string; supplierName: string; documentNumber: string; documentDate: string; purchaseOrderId?: string | null; status: "draft" | "approved"; subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number; version: number; createdAt: string; createdBy: string; approvedAt?: string; approvedBy?: string; lines: PurchaseLine[]; corrections: PurchaseCorrection[]; returns: PurchaseReturn[] };

type PurchaseOrderLine = { id: string; ingredientId: string; ingredientName: string; quantity: number; unit: string };
type PurchaseOrder = { id: string; warehouseId: string; supplierCariId: string; supplierName: string; orderNumber: string; orderDate: string; status: "draft" | "approved" | "completed"; version: number; createdAt: string; createdBy: string; approvedAt?: string; approvedBy?: string; lines: PurchaseOrderLine[] };

type CashRegister = { id: string; code: string; name: string; isActive: boolean };
type CashShift = { id: string; registerId: string; status: "open" | "closed"; expectedCashMinor: number | null };
type CashOpenShift = { shift: CashShift; cashInMinor: number; cashOutMinor: number };
type CashOverview = { registers: CashRegister[]; openShifts: CashOpenShift[] };

const amountMinor = (value: string) => {
  const trimmed = value.trim().replace(/\s/g, "");
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)
    ? trimmed.replaceAll(".", "").replace(",", ".")
    : trimmed.replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
};

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const emptyLine = (): Line => ({ id: crypto.randomUUID(), ingredientId: "", quantity: "", unitPrice: "" });
const number = (value: string) => Number.isFinite(Number(value)) ? Number(value) : 0;
const lineTotal = (line: Line) => Math.round(number(line.quantity) * number(line.unitPrice) * 100);

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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentDate, setDocumentDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [message, setMessage] = useState("");
  const [correctionLineId, setCorrectionLineId] = useState("");
  const [correctionQuantity, setCorrectionQuantity] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [returnLineId, setReturnLineId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnDocumentNumber, setReturnDocumentNumber] = useState("");
  const [returnDocumentDate, setReturnDocumentDate] = useState(today);
  const [returnReason, setReturnReason] = useState("");

  useEffect(() => {
    setCorrectionLineId("");
    setCorrectionQuantity("");
    setCorrectionReason("");
    setReturnLineId("");
    setReturnQuantity("");
    setReturnDocumentNumber("");
    setReturnDocumentDate(today());
    setReturnReason("");
  }, [selectedPurchaseId]);

  // Onay ve Ödeme Modalı Durumları
  const [approvingPurchase, setApprovingPurchase] = useState<Purchase | null>(null);
  const [paymentMode, setPaymentMode] = useState<"on_account" | "immediate_cash">("on_account");
  const [cashAllocations, setCashAllocations] = useState<Record<string, string>>({});
  const [cashOverview, setCashOverview] = useState<CashOverview | null>(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalModalError, setApprovalModalError] = useState("");

  // Yeni Satın Alma Siparişi Formu Modalı
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [newOrderNumber, setNewOrderNumber] = useState("");
  const [newOrderSupplierId, setNewOrderSupplierId] = useState("");
  const [newOrderWarehouseId, setNewOrderWarehouseId] = useState("");
  const [newOrderDate, setNewOrderDate] = useState(today);
  const [newOrderLines, setNewOrderLines] = useState<{ id: string; ingredientId: string; quantity: string }[]>([
    { id: crypto.randomUUID(), ingredientId: "", quantity: "10" },
  ]);

  const inventoryPath = branchId ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/inventory` : "";

  const reloadOrders = useCallback(async () => {
    if (!inventoryPath) return;
    try {
      const orderResult = await get<{ items: PurchaseOrder[] }>(`${inventoryPath}/purchase-orders`, actor);
      setPurchaseOrders(orderResult.items);
    } catch {
      // Hata durumunda sessiz kal
    }
  }, [actor, inventoryPath]);

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
      get<{ items: PurchaseOrder[] }>(`${inventory}/purchase-orders`, actor),
    ]).then(([warehouseResult, ingredientResult, supplierResult, purchaseResult, orderResult]) => {
      const activeIngredients = ingredientResult.items.filter((item) => item.isActive);
      const activeSuppliers = supplierResult.items.filter((item) => item.isActive && item.types.includes("supplier"));
      const activeWarehouses = warehouseResult.items.filter((item) => item.isActive);
      setWarehouses(activeWarehouses);
      setIngredients(activeIngredients);
      setSuppliers(activeSuppliers);
      setPurchases(purchaseResult.items);
      setPurchaseOrders(orderResult.items);
      setWarehouseId(activeWarehouses[0]?.id ?? "");
      setSupplierId(activeSuppliers[0]?.id ?? "");
      setLines([{ ...emptyLine(), ingredientId: activeIngredients[0]?.id ?? "" }]);
    }).catch((reason) => setError((reason as Error).message)).finally(() => setLoading(false));
  }, [actor, branchId, ctx.firmId]);

  const approvedOrders = useMemo(() => purchaseOrders.filter((order) => order.status === "approved"), [purchaseOrders]);
  const selectedOrder = useMemo(() => purchaseOrders.find((order) => order.id === selectedOrderId), [purchaseOrders, selectedOrderId]);

  const onSelectOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    if (!orderId) {
      // Sipariş seçimi temizlendiğinde varsayılan boş satıra dön
      setLines([{ ...emptyLine(), ingredientId: ingredients[0]?.id ?? "" }]);
      return;
    }
    const order = purchaseOrders.find((item) => item.id === orderId);
    if (!order) return;
    setWarehouseId(order.warehouseId);
    setSupplierId(order.supplierCariId);
    // Siparişteki tüm kalemleri ve miktarları otomatik doldur
    setLines(order.lines.map((line) => ({
      id: crypto.randomUUID(),
      ingredientId: line.ingredientId,
      quantity: String(line.quantity),
      unitPrice: "",
    })));
    setMessage(`${order.orderNumber} numaralı siparişteki kalemler aktarıldı. Mal kabul kuralı gereğince siparişteki ürünler tam miktarlarıyla teslim alınır. Lütfen fatura/irsaliye no ve birim fiyatları girin.`);
  };

  const openNewOrderModal = () => {
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    setNewOrderNumber(`SIP-${new Date().getFullYear()}-${randomSuffix}`);
    setNewOrderSupplierId(suppliers[0]?.id ?? "");
    setNewOrderWarehouseId(warehouses[0]?.id ?? "");
    setNewOrderDate(today());
    setNewOrderLines([
      { id: crypto.randomUUID(), ingredientId: ingredients[0]?.id ?? "", quantity: "10" },
    ]);
    setShowOrderModal(true);
  };

  const createAndApproveOrder = async () => {
    if (!inventoryPath || busy) return;
    const orderLines = newOrderLines.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: number(line.quantity),
    })).filter((line) => line.ingredientId && line.quantity > 0);

    if (!newOrderNumber.trim() || !newOrderSupplierId || !newOrderWarehouseId || orderLines.length === 0) {
      setError("Lütfen sipariş numarası, tedarikçi, depo ve geçerli hammadde satırlarını doldurun.");
      return;
    }

    setBusy(true); setError(""); setMessage("");
    try {
      const orderId = crypto.randomUUID();
      // 1. Siparişi Taslak Olarak Aç
      await post<PurchaseOrder>(`${inventoryPath}/purchase-orders`, actor, {
        requestId: orderId,
        warehouseId: newOrderWarehouseId,
        supplierCariId: newOrderSupplierId,
        orderNumber: newOrderNumber.trim(),
        orderDate: newOrderDate,
        lines: orderLines,
      });

      // 2. Siparişi Onayla
      await post<PurchaseOrder>(`${inventoryPath}/purchase-orders/${orderId}/approve`, actor, {
        requestId: crypto.randomUUID(),
        expectedVersion: 1,
      });

      await reloadOrders();
      setShowOrderModal(false);
      onSelectOrder(orderId);
      setMessage(`${newOrderNumber.trim()} numaralı satın alma siparişi oluşturuldu ve onaylandı; mal kabul formuna aktarıldı!`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);
  const valid = Boolean(warehouseId && supplierId && documentNumber.trim() && lines.length &&
    lines.every((line) => line.ingredientId && number(line.quantity) > 0 && number(line.unitPrice) > 0));
  const selectedPurchase = purchases.find((purchase) => purchase.id === selectedPurchaseId);

  const updateLine = (id: string, patch: Partial<Line>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));

  const saveDraft = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const purchase = await post<Purchase>(`${inventoryPath}/purchases`, actor, {
        requestId: crypto.randomUUID(),
        warehouseId,
        supplierCariId: supplierId,
        documentNumber: documentNumber.trim(),
        documentDate,
        purchaseOrderId: selectedOrderId || undefined,
        lines: lines.map((line) => ({
          ingredientId: line.ingredientId,
          quantity: number(line.quantity),
          unitPriceMinor: Math.round(number(line.unitPrice) * 100),
          discountRateBps: 0,
          taxRateBps: 0,
        })),
      });
      setPurchases((current) => [purchase, ...current]);
      setDocumentNumber("");
      setSelectedOrderId("");
      setLines([{ ...emptyLine(), ingredientId: ingredients[0]?.id ?? "" }]);
      setMessage(selectedOrderId
        ? `${purchase.documentNumber} mal kabul taslağı siparişe bağlı olarak kaydedildi. Onaylandığında sipariş tamamlanacaktır.`
        : "Mal kabul taslağı kaydedildi; stok ve cari henüz değişmedi.");
      await reloadOrders();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const openApproveModal = async (purchase: Purchase) => {
    setApprovingPurchase(purchase);
    setPaymentMode("on_account");
    setCashAllocations({});
    setApprovalModalError("");
    const cashPath = branchId ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchId)}/cash` : "";
    if (cashPath) {
      setCashLoading(true);
      try {
        const overview = await get<CashOverview>(`${cashPath}/overview`, actor);
        setCashOverview(overview);
      } catch {
        setCashOverview(null);
      } finally {
        setCashLoading(false);
      }
    }
  };

  const confirmApproval = async () => {
    if (!approvingPurchase || approvalBusy) return;
    setApprovalBusy(true);
    setApprovalModalError("");
    try {
      const payload: {
        requestId: string;
        expectedVersion: number;
        paymentMode: "on_account" | "immediate_cash";
        cashPayments?: Array<{ registerId: string; amountMinor: number }>;
      } = {
        requestId: crypto.randomUUID(),
        expectedVersion: approvingPurchase.version,
        paymentMode,
      };

      if (paymentMode === "immediate_cash") {
        const payments = Object.entries(cashAllocations)
          .map(([registerId, val]) => ({ registerId, amountMinor: amountMinor(val) }))
          .filter((p) => p.amountMinor > 0);

        if (payments.length === 0) {
          throw new Error("Lütfen en az bir kasadan ödenecek tutar girin veya 'Borç Olarak Yaz' seçeneğini işaretleyin.");
        }

        const totalCashMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);
        if (totalCashMinor > approvingPurchase.totalMinor) {
          throw new Error(`Kasalardan çekilecek tutarlar toplamı (${money(totalCashMinor)}), belge tutarından (${money(approvingPurchase.totalMinor)}) fazla olamaz.`);
        }

        for (const p of payments) {
          const shift = cashOverview?.openShifts.find((s) => s.shift.registerId === p.registerId);
          const avail = shift?.shift.expectedCashMinor ?? 0;
          if (p.amountMinor > avail) {
            const reg = cashOverview?.registers.find((r) => r.id === p.registerId);
            throw new Error(`'${reg?.name ?? "Kasa"}' çekmecesindeki mevcut nakitten (${money(avail)}) fazla tutar girilemez.`);
          }
        }

        payload.cashPayments = payments;
      }

      const approved = await post<Purchase>(
        `${inventoryPath}/purchases/${approvingPurchase.id}/approve`,
        actor,
        payload
      );

      setPurchases((current) => current.map((item) => (item.id === approved.id ? approved : item)));
      if (paymentMode === "immediate_cash") {
        const totalCashMinor = payload.cashPayments?.reduce((sum, p) => sum + p.amountMinor, 0) ?? 0;
        const remainder = Math.max(0, approvingPurchase.totalMinor - totalCashMinor);
        if (remainder === 0) {
          setMessage(`${approvingPurchase.documentNumber} onaylandı; stok girişi yapıldı, ${money(totalCashMinor)} kasalardan nakit düşüldü ve tedarikçi borcu kapatıldı.`);
        } else {
          setMessage(`${approvingPurchase.documentNumber} onaylandı; stok girişi yapıldı, ${money(totalCashMinor)} kasalardan ödendi, kalan ${money(remainder)} tedarikçinin cari hesabına borç yazıldı.`);
        }
      } else {
        setMessage(`${approvingPurchase.documentNumber} onaylandı; stok girişleri ve tedarikçi borcu (${money(approvingPurchase.totalMinor)}) birlikte kaydedildi.`);
      }
      setApprovingPurchase(null);
      await reloadOrders();
    } catch (reason) {
      setApprovalModalError((reason as Error).message);
    } finally {
      setApprovalBusy(false);
    }
  };

  const correctDelivery = async (purchase: Purchase) => {
    const quantity = number(correctionQuantity);
    if (busy || !correctionLineId || quantity <= 0 || correctionReason.trim().length < 3) return;
    setBusy(true); setError(""); setApprovalError(""); setMessage("");
    try {
      const correction = await post<PurchaseCorrection>(`${inventoryPath}/purchases/${purchase.id}/corrections`, actor, {
        requestId: crypto.randomUUID(), purchaseLineId: correctionLineId, quantity, reason: correctionReason.trim(),
      });
      setPurchases((current) => current.map((item) => item.id === purchase.id
        ? { ...item, corrections: [correction, ...(item.corrections ?? [])] } : item));
      setCorrectionLineId(""); setCorrectionQuantity(""); setCorrectionReason("");
      setMessage(`${purchase.documentNumber} belgesine eksik teslim düzeltmesi işlendi; stok ve tedarikçi borcu birlikte azaltıldı.`);
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
      description={`${ctx.selectedBranch?.name ?? "Seçili şube"} · gelen hammaddeyi, satın alma siparişini ve tedarikçi borç etkisini birlikte kontrol edin.`}
      action={<StatusPill tone="green">Çalışıyor</StatusPill>} />
    {!canWrite && <DemoNotice>Mal kabul özelliği bu şubede yeni işlemlere kapalı. Geçmiş belgeleri görebilirsiniz.</DemoNotice>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {message && <div className="notice success" role="status">{message}</div>}
    {loading ? <div className="card generic-empty">Mal kabul sözlükleri yükleniyor…</div> : <>
      <section className="card content-card receiving-document">
        <div className="card-heading padded">
          <div><span className="card-kicker">BELGE BİLGİLERİ</span><h2>Gelen mal belgesi (Fiyatsız sipariş taslağı)</h2></div>
          <button className="soft-button" disabled={!canWrite || busy} onClick={openNewOrderModal}>
            <FileText size={15} /> Yeni Satın Alma Siparişi
          </button>
        </div>
        <div className="cari-form receiving-header">
          <label>Bağlı sipariş (satın alma)
            <select value={selectedOrderId} disabled={!canWrite || busy} onChange={(event) => onSelectOrder(event.target.value)}>
              <option value="">Siparişsiz / Doğrudan Alım</option>
              {approvedOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} · {order.supplierName} ({order.lines.length} kalem)
                </option>
              ))}
            </select>
          </label>
          <label>Tedarikçi
            <select value={supplierId} disabled={!canWrite || busy || Boolean(selectedOrderId)} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Tedarikçi seçin</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>Depo
            <select value={warehouseId} disabled={!canWrite || busy || Boolean(selectedOrderId)} onChange={(event) => setWarehouseId(event.target.value)}>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </label>
          <label>İrsaliye / fatura no
            <input value={documentNumber} placeholder="Örn. IRS-2026-00482" disabled={!canWrite || busy} onChange={(event) => setDocumentNumber(event.target.value)} maxLength={100} />
          </label>
          <label>Belge tarihi
            <input type="date" value={documentDate} disabled={!canWrite || busy} onChange={(event) => setDocumentDate(event.target.value)} />
          </label>
        </div>
        {selectedOrder && <div style={{ padding: "0 20px 16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#4f46e5", fontSize: "13px" }}>
          <span>📦 <strong>{selectedOrder.orderNumber}</strong> numaralı sipariş seçildi ({selectedOrder.lines.length} kalem). Hammaddeler ve miktarlar siparişten aktarıldı.</span>
          <button className="soft-button" style={{ padding: "3px 8px", fontSize: "12px" }} onClick={() => onSelectOrder("")}>
            Sipariş Bağlantısını Kaldır
          </button>
        </div>}
      </section>

      <section className="card content-card receiving-lines">
        <div className="card-heading padded">
          <div>
            <span className="card-kicker">HAMMADDELER</span>
            <h2>Mal kabul satırları</h2>
          </div>
          <button className="soft-button" disabled={!canWrite || busy || Boolean(selectedOrderId)} title={selectedOrderId ? "Siparişe bağlı mal kabulde satır eklenemez" : undefined} onClick={() => setLines((current) => [...current, { ...emptyLine(), ingredientId: ingredients[0]?.id ?? "" }])}>
            <Plus size={15} /> Satır ekle
          </button>
        </div>
        <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>MİKTAR</th><th>BİRİM FİYAT</th><th>TOPLAM</th><th /></tr></thead>
          <tbody>{lines.map((line) => {
            const ingredient = ingredients.find((item) => item.id === line.ingredientId);
            return <tr key={line.id}>
              <td data-label="Hammadde" className="cell-ingredient">
                <select aria-label="Hammadde" value={line.ingredientId} disabled={!canWrite || busy || Boolean(selectedOrderId)} onChange={(event) => updateLine(line.id, { ingredientId: event.target.value })}>
                  {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </td>
              <td data-label="Miktar" className="cell-quantity">
                <div className="receiving-quantity">
                  <input aria-label="Miktar" type="number" min="0.001" step="0.001" value={line.quantity} disabled={!canWrite || busy || Boolean(selectedOrderId)} onChange={(event) => updateLine(line.id, { quantity: event.target.value })}/>
                  <span>{ingredient?.unit ?? "—"}</span>
                </div>
              </td>
              <td data-label="Birim fiyat" className="cell-price">
                <input aria-label="Birim fiyat" type="number" min="0.01" step="0.01" placeholder="0.00 TL" value={line.unitPrice} disabled={!canWrite || busy} onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}/>
              </td>
              <td data-label="Toplam" className="cell-total"><strong>{money(lineTotal(line))}</strong></td>
              <td className="receiving-line-action">
                <button className="icon-button" aria-label="Satırı sil" disabled={!canWrite || busy || lines.length === 1 || Boolean(selectedOrderId)} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>
                  <Trash2 size={15}/>
                </button>
              </td>
            </tr>; })}
          </tbody></table>
        </div>
      </section>

      <section className="card receiving-summary">
        <div className="receiving-grand-total">
          <span>Genel toplam / Cari borç</span>
          <strong>{money(total)}</strong>
        </div>
      </section>

      <div className="count-approval receiving-actions">
        <p>
          {selectedOrderId
            ? "Siparişe bağlı mal kabul: Onaylandığında sipariş otomatik olarak 'Tamamlandı' yapılacak, stoklar artacak ve cari borç işlenecektir."
            : "Taslak stok ve cariyi değiştirmez. Onayda stok girişleri ve tedarikçi borcu tek işlemde oluşur."}
        </p>
        <button className="primary-button" disabled={!canWrite || !valid || busy} onClick={() => void saveDraft()}>
          <Truck size={16}/> {busy ? "İşleniyor…" : selectedOrderId ? "Siparişi Teslim Al ve Taslağı Kaydet" : "Taslağı kaydet"}
        </button>
      </div>

      {approvalError && <div className="notice receiving-approval-error" role="alert">{approvalError}</div>}

      <section className="card content-card receiving-history">
        <div className="card-heading padded"><div><span className="card-kicker">BELGELER</span><h2>Mal kabul geçmişi</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>BELGE</th><th>TARİH</th><th>TEDARİKÇİ</th><th>SATIR</th><th>TOPLAM</th><th>DURUM</th><th /></tr></thead><tbody>{purchases.length === 0 ? <tr><td colSpan={7}>Henüz mal kabul belgesi yok.</td></tr> : purchases.map((purchase) => {
          const matchedOrder = purchaseOrders.find((o) => o.id === purchase.purchaseOrderId);
          return <tr key={purchase.id}>
            <td data-label="Belge">
              <div className="receiving-cell-value">
                <strong>{purchase.documentNumber}</strong>
                {purchase.purchaseOrderId && <div style={{ fontSize: "11px", color: "#6366f1", marginTop: "2px" }}>
                  📦 {matchedOrder?.orderNumber ?? "Siparişli"}
                </div>}
              </div>
            </td>
            <td data-label="Tarih"><span className="receiving-cell-value">{purchase.documentDate}</span></td>
            <td data-label="Tedarikçi"><span className="receiving-cell-value">{purchase.supplierName}</span></td>
            <td data-label="Satır"><span className="receiving-cell-value">{purchase.lines.length} kalem</span></td>
            <td data-label="Toplam"><strong className="receiving-cell-value">{money(purchase.totalMinor)}</strong></td>
            <td data-label="Durum"><div className="receiving-cell-value"><StatusPill tone={purchase.status === "approved" ? "green" : "orange"}>{purchase.status === "approved" ? "Onaylandı" : "Taslak"}</StatusPill></div></td>
            <td className="receiving-line-action">
              <button className="soft-button" onClick={() => setSelectedPurchaseId((current) => current === purchase.id ? null : purchase.id)}>{selectedPurchaseId === purchase.id ? "Kapat" : "Detay"}</button>
              {purchase.status === "draft" && <button className="soft-button" disabled={!canWrite || busy} onClick={() => void openApproveModal(purchase)}><Check size={15}/> Onayla</button>}
            </td>
          </tr>; })}</tbody></table></div>
      </section>

      {selectedPurchase && <section className="card content-card receiving-detail">
        <div className="card-heading padded">
          <div>
            <span className="card-kicker">BELGE DETAYI</span>
            <h2>{selectedPurchase.documentNumber}</h2>
            <p>{selectedPurchase.supplierName} · {selectedPurchase.documentDate}</p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <StatusPill tone={selectedPurchase.status === "approved" ? "green" : "orange"}>{selectedPurchase.status === "approved" ? "Onaylandı" : "Taslak"}</StatusPill>
            {selectedPurchase.status === "draft" && (
              <button className="primary-button" style={{ padding: "4px 10px", fontSize: "12px" }} disabled={!canWrite || busy} onClick={() => void openApproveModal(selectedPurchase)}>
                <Check size={14}/> Onayla
              </button>
            )}
          </div>
        </div>
        <dl className="receiving-detail-meta">
          <div><dt>Depo</dt><dd>{warehouses.find((item) => item.id === selectedPurchase.warehouseId)?.name ?? "—"}</dd></div>
          <div><dt>Bağlı Sipariş</dt><dd>{purchaseOrders.find((o) => o.id === selectedPurchase.purchaseOrderId)?.orderNumber ?? (selectedPurchase.purchaseOrderId ? "Sipariş #" + selectedPurchase.purchaseOrderId.slice(0, 8) : "Doğrudan Alım")}</dd></div>
          <div><dt>Oluşturan</dt><dd>{selectedPurchase.createdBy}</dd></div>
          <div><dt>Onaylayan</dt><dd>{selectedPurchase.approvedBy ?? "Henüz onaylanmadı"}</dd></div>
        </dl>
        <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>MİKTAR</th><th>BİRİM FİYAT</th><th>TOPLAM</th></tr></thead><tbody>{selectedPurchase.lines.map((line) => <tr key={line.id}><td data-label="Hammadde">{line.ingredientName}</td><td data-label="Miktar">{line.quantity} {line.unit}</td><td data-label="Birim fiyat">{money(line.unitPriceMinor)}</td><td data-label="Toplam"><strong>{money(line.totalMinor)}</strong></td></tr>)}</tbody></table></div>
        <div className="receiving-detail-totals"><span>Genel toplam <strong>{money(selectedPurchase.totalMinor)}</strong></span></div>
        {selectedPurchase.status === "approved" && <div className="receiving-correction">
          <div><span className="card-kicker">EKSİK TESLİM</span><h3>Düzeltme fişi</h3><p>Onaylı belge korunur; fiziksel olarak eksik teslim edilen miktar stoktan ve tedarikçi borcundan aynı anda düşer.</p></div>
          <div className="receiving-correction-form">
            <label>Hammadde<select value={correctionLineId} disabled={!canWrite || busy} onChange={(event) => setCorrectionLineId(event.target.value)}><option value="">Satır seçin</option>{selectedPurchase.lines.map((line) => { const removed = [...(selectedPurchase.corrections ?? []), ...(selectedPurchase.returns ?? [])].filter((item) => item.purchaseLineId === line.id).reduce((sum, item) => sum + item.quantity, 0); const remaining = line.quantity - removed; return remaining > 0 && <option key={line.id} value={line.id}>{line.ingredientName} · en fazla {remaining} {line.unit}</option>; })}</select></label>
            <label>Eksik miktar<input type="number" min="0.001" step="0.001" value={correctionQuantity} placeholder="0.000" disabled={!canWrite || busy} onChange={(event) => setCorrectionQuantity(event.target.value)} /></label>
            <label>Açıklama / gerekçe<input value={correctionReason} maxLength={500} placeholder="Örn. 5 kg eksik teslim edildi" disabled={!canWrite || busy} onChange={(event) => setCorrectionReason(event.target.value)} /></label>
            <button className="soft-button" disabled={!canWrite || busy || !correctionLineId || number(correctionQuantity) <= 0 || correctionReason.trim().length < 3} onClick={() => void correctDelivery(selectedPurchase)}>Düzeltmeyi kaydet</button>
          </div>
          {(selectedPurchase.corrections ?? []).length > 0 && <div className="receiving-correction-history"><strong>Düzeltme geçmişi</strong>{selectedPurchase.corrections.map((item) => <span key={item.id}>{item.quantity} {item.unit} · -{money(item.totalMinor)} · {item.reason}</span>)}</div>}
        </div>}
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

      {/* Satın Alma Siparişi Oluşturma Modalı */}
      {showOrderModal && <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
        <div className="card content-card" style={{ maxWidth: "600px", width: "100%", maxHeight: "90vh", overflowY: "auto", background: "#fff", padding: "24px", borderRadius: "12px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <span className="card-kicker">ÖN SİPARİŞ</span>
              <h2 style={{ margin: "4px 0 0 0" }}>Yeni Satın Alma Siparişi</h2>
            </div>
            <button className="icon-button" onClick={() => setShowOrderModal(false)}><X size={20} /></button>
          </div>
          <p style={{ color: "#6b7280", fontSize: "13px", marginBottom: "16px" }}>
            Toptancıya verilecek fiyatsız malzeme siparişini oluşturun. Onaylanan sipariş mal kabul ekranında seçilebilir.
          </p>
          <div className="cari-form" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <label>Sipariş No<input value={newOrderNumber} onChange={(e) => setNewOrderNumber(e.target.value)} maxLength={100} /></label>
            <label>Sipariş Tarihi<input type="date" value={newOrderDate} onChange={(e) => setNewOrderDate(e.target.value)} /></label>
            <label>Tedarikçi
              <select value={newOrderSupplierId} onChange={(e) => setNewOrderSupplierId(e.target.value)}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Depo
              <select value={newOrderWarehouseId} onChange={(e) => setNewOrderWarehouseId(e.target.value)}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <strong style={{ fontSize: "13px" }}>İstenen Hammaddeler</strong>
              <button className="soft-button" onClick={() => setNewOrderLines((cur) => [...cur, { id: crypto.randomUUID(), ingredientId: ingredients[0]?.id ?? "", quantity: "10" }])}>
                <Plus size={14} /> Kalem Ekle
              </button>
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              {newOrderLines.map((line) => {
                const ing = ingredients.find((i) => i.id === line.ingredientId);
                return <div key={line.id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select style={{ flex: 1, minHeight: "36px", borderRadius: "6px", border: "1px solid #d1d5db", padding: "4px 8px" }} value={line.ingredientId} onChange={(e) => setNewOrderLines((cur) => cur.map((item) => item.id === line.id ? { ...item, ingredientId: e.target.value } : item))}>
                    {ingredients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <input type="number" min="0.001" step="0.001" style={{ width: "90px", minHeight: "36px", borderRadius: "6px", border: "1px solid #d1d5db", padding: "4px 8px" }} value={line.quantity} onChange={(e) => setNewOrderLines((cur) => cur.map((item) => item.id === line.id ? { ...item, quantity: e.target.value } : item))} />
                  <span style={{ fontSize: "12px", color: "#6b7280", width: "40px" }}>{ing?.unit ?? ""}</span>
                  <button className="icon-button" disabled={newOrderLines.length === 1} onClick={() => setNewOrderLines((cur) => cur.filter((item) => item.id !== line.id))}><Trash2 size={16} /></button>
                </div>;
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button className="soft-button" onClick={() => setShowOrderModal(false)}>İptal</button>
            <button className="primary-button" disabled={busy} onClick={() => void createAndApproveOrder()}>
              {busy ? "Oluşturuluyor…" : "Siparişi Kaydet ve Onayla"}
            </button>
          </div>
        </div>
      </div>}

      {/* Mal Kabul Onay ve Ödeme Modalı */}
      {approvingPurchase && (
        <div style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(15, 23, 42, 0.65)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "16px",
        }}>
          <div style={{
            backgroundColor: "#fff",
            borderRadius: "14px",
            padding: "24px",
            maxWidth: "640px",
            width: "100%",
            maxHeight: "92vh",
            overflowY: "auto",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            border: "1px solid #e2e8f0",
          }}>
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px", borderBottom: "1px solid #f1f5f9", paddingBottom: "12px" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.05em", color: "#6366f1", textTransform: "uppercase" }}>
                  ONAY VE ÖDEME YÖNTEMİ
                </span>
                <h2 style={{ fontSize: "18px", margin: "4px 0 2px 0", color: "#0f172a" }}>
                  {approvingPurchase.documentNumber}
                </h2>
                <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                  {approvingPurchase.supplierName} · {approvingPurchase.documentDate}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setApprovingPurchase(null)}
                style={{ cursor: "pointer", background: "none", border: "none", color: "#94a3b8" }}
              >
                <X size={20} />
              </button>
            </div>

            {approvalModalError && (
              <div className="notice error" style={{ marginBottom: "16px", fontSize: "13px" }} role="alert">
                {approvalModalError}
              </div>
            )}

            {/* Belge Tutar Özeti */}
            <div style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "10px",
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "20px",
            }}>
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 500 }}>Toplam Belge Tutarı</div>
                <div style={{ fontSize: "13px", color: "#334155" }}>{approvingPurchase.lines.length} hammadde kalemi</div>
              </div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a" }}>
                {money(approvingPurchase.totalMinor)}
              </div>
            </div>

            {/* Ödeme Tercihi Kartları */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "10px" }}>
                Tedarikçi Ödemesi Nasıl Yapılsın?
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
                {/* 1. Borç Olarak Yaz */}
                <div
                  onClick={() => setPaymentMode("on_account")}
                  style={{
                    border: paymentMode === "on_account" ? "2px solid #6366f1" : "1px solid #cbd5e1",
                    backgroundColor: paymentMode === "on_account" ? "#f5f3ff" : "#fff",
                    borderRadius: "10px",
                    padding: "14px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <input
                      type="radio"
                      name="paymentMode"
                      checked={paymentMode === "on_account"}
                      onChange={() => setPaymentMode("on_account")}
                    />
                    <strong style={{ fontSize: "14px", color: "#1e1b4b" }}>Borç Olarak Yaz</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "#475569", lineHeight: "1.4" }}>
                    Kasadan para çıkışı yapılmaz. Tutarın tamamı tedarikçinin cari hesabına borç (veresiye) işlenir.
                  </p>
                </div>

                {/* 2. Hemen Ödensin */}
                <div
                  onClick={() => setPaymentMode("immediate_cash")}
                  style={{
                    border: paymentMode === "immediate_cash" ? "2px solid #10b981" : "1px solid #cbd5e1",
                    backgroundColor: paymentMode === "immediate_cash" ? "#ecfdf5" : "#fff",
                    borderRadius: "10px",
                    padding: "14px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <input
                      type="radio"
                      name="paymentMode"
                      checked={paymentMode === "immediate_cash"}
                      onChange={() => setPaymentMode("immediate_cash")}
                    />
                    <strong style={{ fontSize: "14px", color: "#064e3b" }}>Hemen Ödensin</strong>
                  </div>
                  <p style={{ margin: 0, fontSize: "12px", color: "#475569", lineHeight: "1.4" }}>
                    Toptancıya elden nakit verilir. İstenen kasalardan para çekilir ve cari borç anında kapatılır.
                  </p>
                </div>
              </div>
            </div>

            {/* Hemen Ödensin Seçildiğinde Kasa Listesi ve Dağıtımı */}
            {paymentMode === "immediate_cash" && (
              <div style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "20px",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <strong style={{ fontSize: "13px", color: "#0f172a" }}>Kasalardan Ödenecek Miktarlar</strong>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>Şube Kasaları ve Açık Vardiyalar</span>
                </div>

                {cashLoading ? (
                  <div style={{ fontSize: "13px", color: "#64748b", padding: "12px 0" }}>Kasa bilgileri alınıyor…</div>
                ) : !cashOverview?.registers || cashOverview.registers.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "#ef4444", padding: "8px 0" }}>
                    Bu şubede tanımlı kasa bulunamadı.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: "10px" }}>
                    {cashOverview.registers.map((reg) => {
                      const openShift = cashOverview.openShifts.find((s) => s.shift.registerId === reg.id && s.shift.status === "open");
                      const isShiftOpen = Boolean(openShift);
                      const expectedCash = openShift?.shift.expectedCashMinor ?? 0;
                      const currentVal = cashAllocations[reg.id] ?? "";
                      const currentValMinor = amountMinor(currentVal);
                      const isExcess = currentValMinor > expectedCash;

                      return (
                        <div
                          key={reg.id}
                          style={{
                            background: "#fff",
                            border: isExcess ? "1px solid #ef4444" : "1px solid #cbd5e1",
                            borderRadius: "8px",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <strong style={{ fontSize: "13px", color: "#1e293b" }}>{reg.name}</strong>
                              <span style={{ fontSize: "11px", color: "#64748b", background: "#f1f5f9", padding: "2px 6px", borderRadius: "4px" }}>
                                {reg.code}
                              </span>
                              {isShiftOpen ? (
                                <span style={{ fontSize: "11px", color: "#059669", fontWeight: 600 }}>● Açık Vardiya</span>
                              ) : (
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>○ Kapalı</span>
                              )}
                            </div>
                            <div style={{ fontSize: "12px", color: isShiftOpen ? "#047857" : "#94a3b8" }}>
                              Çekmecede: <strong>{money(expectedCash)}</strong>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <div style={{ position: "relative", flex: 1 }}>
                              <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#64748b", fontSize: "13px" }}>₺</span>
                              <input
                                type="text"
                                disabled={!isShiftOpen || approvalBusy}
                                placeholder="0,00"
                                value={currentVal}
                                onChange={(e) => setCashAllocations((prev) => ({ ...prev, [reg.id]: e.target.value }))}
                                style={{
                                  width: "100%",
                                  padding: "6px 8px 6px 26px",
                                  borderRadius: "6px",
                                  border: "1px solid #cbd5e1",
                                  fontSize: "13px",
                                  backgroundColor: isShiftOpen ? "#fff" : "#f1f5f9",
                                }}
                              />
                            </div>
                            {isShiftOpen && (
                              <button
                                type="button"
                                className="soft-button"
                                style={{ fontSize: "12px", padding: "6px 10px", whiteSpace: "nowrap" }}
                                onClick={() => {
                                  const otherAllocated = Object.entries(cashAllocations)
                                    .filter(([id]) => id !== reg.id)
                                    .reduce((sum, [, val]) => sum + amountMinor(val), 0);
                                  const neededMinor = Math.max(0, approvingPurchase.totalMinor - otherAllocated);
                                  const fillMinor = Math.min(neededMinor, expectedCash);
                                  setCashAllocations((prev) => ({ ...prev, [reg.id]: (fillMinor / 100).toFixed(2) }));
                                }}
                              >
                                Kalanı Doldur
                              </button>
                            )}
                          </div>
                          {isExcess && (
                            <div style={{ fontSize: "11px", color: "#dc2626" }}>
                              Çekmecedeki nakitten ({money(expectedCash)}) fazla çekilemez.
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Dağıtım Durumu ve Kalan Borç Hesaplaması */}
                {(() => {
                  const totalPaid = Object.values(cashAllocations).reduce((sum, val) => sum + amountMinor(val), 0);
                  const remainder = Math.max(0, approvingPurchase.totalMinor - totalPaid);
                  const isOver = totalPaid > approvingPurchase.totalMinor;

                  return (
                    <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px solid #e2e8f0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                        <span style={{ color: "#475569" }}>Kasalardan Ödenecek Toplam:</span>
                        <strong style={{ color: isOver ? "#dc2626" : "#0f172a" }}>{money(totalPaid)}</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "8px" }}>
                        <span style={{ color: "#475569" }}>Cariye Borç Kalacak Tutar:</span>
                        <strong style={{ color: remainder > 0 ? "#d97706" : "#059669" }}>{money(remainder)}</strong>
                      </div>

                      {isOver ? (
                        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "8px 12px", borderRadius: "6px", fontSize: "12px" }}>
                          Girilen kasa tutarları toplamı belge tutarından fazladır!
                        </div>
                      ) : remainder === 0 && totalPaid > 0 ? (
                        <div style={{ background: "#ecfdf5", color: "#065f46", padding: "8px 12px", borderRadius: "6px", fontSize: "12px" }}>
                          ✓ Fatura bedelinin tamamı kasalardan ödenecek; toptancıya borç kalmayacak.
                        </div>
                      ) : totalPaid > 0 ? (
                        <div style={{ background: "#fef3c7", color: "#92400e", padding: "8px 12px", borderRadius: "6px", fontSize: "12px" }}>
                          ℹ️ Kısmi Ödeme: {money(totalPaid)} kasalardan peşin ödenecek, kalan {money(remainder)} tedarikçinin cari hesabına borç kaydedilecek.
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Modal Butonları */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
              <button
                type="button"
                className="soft-button"
                disabled={approvalBusy}
                onClick={() => setApprovingPurchase(null)}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={approvalBusy}
                onClick={() => void confirmApproval()}
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <Check size={16} />
                {approvalBusy ? "İşleniyor…" : "Mal Kabulü ve Ödemeyi Onayla"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>}
  </>;
}
