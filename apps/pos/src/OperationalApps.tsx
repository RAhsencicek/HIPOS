import { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaymentSimulatorPanel, type TestOrder } from "./PaymentSimulatorPanel";
import { createRequestId } from "./requestId";
import "./operational.css";

const firmId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
type ApiProblem = { detail?: string };
type Product = { id: string; name: string; status: string; isActive: boolean; channels: string[]; price: { amountMinor: number; currency: string } };
type Waiter = { id: string; name: string; isActive: boolean };
type Table = { id: string; number: number; name: string; isActive: boolean; assignment?: { waiterId: string | null; waiterName: string | null } | null };
type Order = { id: string; source: string; status: string; paymentStatus: string; totalMinor: number; createdAt: string; tableName?: string; waiterName?: string; items: Array<{ productName: string; quantity: number; lineTotalMinor: number }> };
type ActiveTable = { name: string; assignment?: { orderId: string; waiterName: string | null } | null };

async function request<T>(path: string, actor: string, body?: unknown): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(`${apiBase}${path}`, { method: body ? "POST" : "GET", signal: controller.signal,
      headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    if (controller.signal.aborted)
      throw new Error("Sunucu 15 saniyede yanıt vermedi. Sipariş kaydedilmiş olabilir; yeniden deneyin, aynı sipariş kimliği kullanılacak.");
    throw new Error("Yerel HIPOS sunucusuna ulaşılamadı. Cihazların aynı Wi-Fi ağına bağlı olduğunu kontrol edin.");
  } finally { window.clearTimeout(timeout); }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as ApiProblem;
    throw new Error(problem.detail ?? `İstek başarısız (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

const servicePath = `/api/v1/firms/${firmId}/branches/${branchId}/service`;
const catalogPath = `/api/v1/firms/${firmId}/catalog/products?branchId=${branchId}&page=1&pageSize=100`;
const ordersPath = `/api/v1/firms/${firmId}/sales/orders?branchId=${branchId}`;

export function WaiterApp() {
  const [products, setProducts] = useState<Product[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [tableId, setTableId] = useState("");
  const [waiterId, setWaiterId] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastOrderId, setLastOrderId] = useState("");
  const [activeOrder, setActiveOrder] = useState<TestOrder | null>(null);
  const [retryOrderId, setRetryOrderId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [catalog, tableResult, waiterResult] = await Promise.all([
        request<{ items: Product[] }>(catalogPath, "pos-single"),
        request<{ items: Table[] }>(`${servicePath}/tables`, "pos-single"),
        request<{ items: Waiter[] }>(`${servicePath}/waiters`, "pos-single"),
      ]);
      setProducts(catalog.items.filter((item) => item.status === "published" && item.isActive && item.channels.includes("pos") && item.price.amountMinor > 0));
      setTables(tableResult.items.filter((item) => item.isActive));
      setWaiters(waiterResult.items.filter((item) => item.isActive));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Veriler yüklenemedi."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload, refreshTick]);

  const selectedTable = tables.find((item) => item.id === tableId);
  const waiter = waiters.find((item) => item.id === waiterId);
  const cartRows = useMemo(() => products.filter((item) => cart[item.id]).map((item) => ({ ...item, quantity: cart[item.id] })), [products, cart]);
  const total = cartRows.reduce((sum, item) => sum + item.price.amountMinor * item.quantity, 0);

  function add(productId: string, delta: number) {
    setRetryOrderId(null);
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[productId] ?? 0) + delta;
      if (quantity <= 0) delete next[productId]; else next[productId] = quantity;
      return next;
    });
  }

  async function sendOrder() {
    if (!selectedTable || !waiter || cartRows.length === 0 || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const orderId = retryOrderId ?? createRequestId();
      setRetryOrderId(orderId);
      const result = await request<{ order: TestOrder; table: string; waiter: string }>(
        `${servicePath}/tables/${encodeURIComponent(selectedTable.id)}/orders`, "pos-single",
        { orderId, waiterId: waiter.id, items: cartRows.map((item) => ({ productId: item.id, quantity: item.quantity })) });
      setCart({}); setRetryOrderId(null); setLastOrderId(result.order.id); setActiveOrder(result.order);
      setNotice(`${result.table} siparişi yönetim ekranına gönderildi. Mutfak kuyruğuna eklendi.`);
      setRefreshTick((tick) => tick + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sipariş gönderilemedi."); }
    finally { setSaving(false); }
  }

  return <main className="ops-shell waiter-shell">
    <header className="ops-header"><a href="/waiter" className="ops-brand">HIPOS <span>GARSON</span></a><a className="ops-link" href="/">POS simülatörü</a></header>
    <section className="ops-intro"><span className="ops-eyebrow">YEREL RESTORAN DEMOSU</span><h1>Yeni sipariş</h1><p>Garson telefonu, yönetim ekranı ve mutfak kuyruğu aynı HIPOS sunucusunu kullanır.</p></section>
    <section className="ops-selection">
      <label>Garson<select value={waiterId} onChange={(event) => { setWaiterId(event.target.value); setRetryOrderId(null); }}><option value="">Garson seçin</option>{waiters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <label>Masa<select value={tableId} onChange={(event) => { setTableId(event.target.value); setRetryOrderId(null); }}><option value="">Masa seçin</option>{tables.map((item) => <option value={item.id} key={item.id}>{item.name}{item.assignment ? ` · ${item.assignment.waiterName ?? "dolu"}` : " · boş"}</option>)}</select></label>
    </section>
    {loading && <p className="ops-message">Menü ve masalar yükleniyor…</p>}
    {error && <p className="ops-error" role="alert">{error}</p>}
    {!loading && products.length === 0 && !error && <p className="ops-message">Satışa açık ürün bulunamadı. Yönetim panelinde ürünleri POS kanalına yayınlayın.</p>}
    <section className="ops-product-grid" aria-label="Ürünler">{products.map((product) => <article className="ops-product" key={product.id}>
      <div><strong>{product.name}</strong><span>{money(product.price.amountMinor)}</span></div>
      <div className="ops-quantity"><button aria-label={`${product.name} azalt`} onClick={() => add(product.id, -1)}>−</button><b>{cart[product.id] ?? 0}</b><button aria-label={`${product.name} ekle`} onClick={() => add(product.id, 1)}>+</button></div>
    </article>)}</section>
    <section className="ops-cart"><div><span>Sepet</span><strong>{money(total)}</strong></div>
      {cartRows.length ? <ul>{cartRows.map((item) => <li key={item.id}>{item.quantity} × {item.name}<span>{money(item.quantity * item.price.amountMinor)}</span></li>)}</ul> : <p>Ürün ekleyerek sipariş oluşturun.</p>}
      <button className="ops-primary" disabled={!tableId || !waiterId || !cartRows.length || saving} onClick={() => void sendOrder()}>{saving ? "Gönderiliyor…" : "Siparişi mutfağa gönder"}</button>
      {notice && <p className="ops-success" role="status">{notice}{lastOrderId && <small> Sipariş: {lastOrderId.slice(0, 8)}</small>}</p>}
    </section>
    {activeOrder && <PaymentSimulatorPanel key={activeOrder.id}
      scope={{ firmId, branchId, actor: "pos-single" }} order={activeOrder} onOrderChange={setActiveOrder} />}
    <footer className="ops-footer">İnternet kesilse bile bu demo, restoranın yerel ağı ve HIPOS ana bilgisayarı çalıştığı sürece kullanılabilir.</footer>
  </main>;
}

export function KitchenApp() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Order | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try {
      const [result, tableResult] = await Promise.all([
        request<{ items: Order[] }>(ordersPath, "manager-single"),
        request<{ items: ActiveTable[] }>(`${servicePath}/tables`, "manager-single"),
      ]);
      const tableByOrder = new Map(tableResult.items.flatMap((table) => table.assignment
        ? [[table.assignment.orderId, { tableName: table.name, waiterName: table.assignment.waiterName ?? undefined }] as const]
        : []));
      setOrders(result.items.filter((order) => order.source === "waiter_web" && order.status === "open")
        .map((order) => ({ ...order, ...tableByOrder.get(order.id) })));
      setError(""); setLastRefresh(new Date());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mutfak kuyruğu alınamadı."); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(timer); }, [load]);
  return <main className="ops-shell kitchen-shell">
    <header className="ops-header"><a href="/kitchen" className="ops-brand">HIPOS <span>MUTFAK</span></a><a className="ops-link" href="/waiter">Garson ekranı</a></header>
    <section className="ops-intro"><span className="ops-eyebrow">SİPARİŞ KUYRUĞU</span><h1>Mutfak fişleri</h1><p>Yeni garson siparişleri yerel sunucudan otomatik olarak yenilenir.</p></section>
    <div className="kitchen-toolbar"><span className={error ? "offline-dot" : "online-dot"} />{error ? "Sunucuya ulaşılamıyor" : `Bağlı · son yenileme ${lastRefresh?.toLocaleTimeString("tr-TR") ?? "—"}`}<button onClick={() => void load()}>Yenile</button></div>
    {error && <p className="ops-error" role="alert">{error}</p>}
    {orders.length === 0 && !error && <div className="kitchen-empty">Yeni sipariş bekleniyor.</div>}
    <section className="kitchen-grid">{orders.map((order) => <article className={`kitchen-ticket ${selected?.id === order.id ? "print-target" : ""}`} key={order.id}>
      <header><div><span>{order.tableName ?? "MASA SİPARİŞİ"}{order.waiterName ? ` · ${order.waiterName}` : ""}</span><h2>{order.id.slice(0, 8).toUpperCase()}</h2></div><time>{new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time></header>
      <ul>{order.items.map((item, index) => <li key={`${item.productName}-${index}`}><strong>{item.quantity}×</strong><span>{item.productName}</span></li>)}</ul>
      <footer><span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} ürün</span><button onClick={() => { setSelected(order); window.setTimeout(() => window.print(), 50); }}>Mutfak fişi yazdır</button></footer>
    </article>)}</section>
    <p className="ops-footer">Yazdır düğmesi cihazın tarayıcı baskı penceresini açar. Gerçek otomatik yazdırma için mutfak yazıcısının modeli ve sürücüsü ayrıca gerekir.</p>
  </main>;
}

export function mountOperationalApp() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path !== "/waiter" && path !== "/kitchen") return false;
  createRoot(document.getElementById("root")!).render(path === "/waiter" ? <WaiterApp /> : <KitchenApp />);
  return true;
}
