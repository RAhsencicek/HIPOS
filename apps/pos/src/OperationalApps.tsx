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
type KitchenTask = { id: string; orderId: string; orderLineId: number; productName: string; quantity: number;
  notes?: string;
  status: "submitted" | "preparing" | "ready" | "served" | "cancelled"; version: number; submittedAt: string;
  preparedAt?: string; readyAt?: string; servedAt?: string; tableName?: string; waiterName?: string;
  cancelledAt?: string; cancellationReason?: string; cancelledBy?: string;
  stationId?: string; stationCode: string; stationName: string };
type KitchenStation = { id: string; code: string; name: string };

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
  const [tasks, setTasks] = useState<KitchenTask[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [stationFilter, setStationFilter] = useState("all");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<KitchenTask | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [savingTaskId, setSavingTaskId] = useState("");
  const load = useCallback(async () => {
    try {
      const [result, stationResult] = await Promise.all([
        request<{ items: KitchenTask[] }>(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks?status=all`, "manager-single"),
        request<{ items: KitchenStation[] }>(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/stations`, "manager-single"),
      ]);
      setTasks(result.items); setStations(stationResult.items);
      setError(""); setLastRefresh(new Date());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Mutfak kuyruğu alınamadı."); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => { void load(); }, 3000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  async function changeStatus(task: KitchenTask) {
    const nextStatus = task.status === "submitted" ? "preparing" : task.status === "preparing" ? "ready" : "served";
    setSavingTaskId(task.id); setError("");
    try {
      await request(`/api/v1/firms/${firmId}/branches/${branchId}/kitchen/tasks/${task.id}/status`, "manager-single",
        { requestId: createRequestId(), nextStatus, expectedVersion: task.version });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Görev durumu değiştirilemedi."); }
    finally { setSavingTaskId(""); }
  }

  function taskAge(task: KitchenTask) {
    const minutes = Math.max(0, Math.floor((now - new Date(task.submittedAt).getTime()) / 60_000));
    return { minutes, level: minutes >= 20 ? "late" : minutes >= 10 ? "warning" : "normal" };
  }

  const visibleTasks = tasks.filter((task) => stationFilter === "all" || task.stationCode === stationFilter);
  const activeTasks = visibleTasks.filter((task) => task.status === "submitted" || task.status === "preparing");
  const readyTasks = visibleTasks.filter((task) => task.status === "ready");
  const servedTasks = visibleTasks
    .filter((task) => task.status === "served")
    .sort((left, right) => new Date(right.servedAt!).getTime() - new Date(left.servedAt!).getTime())
    .slice(0, 6);
  const cancelledTasks = visibleTasks.filter((task) => task.status === "cancelled").slice(-6).reverse();

  function printTicket(task: KitchenTask) {
    const printItems = tasks.filter((item) => item.orderId === task.orderId && item.stationCode === task.stationCode && item.status !== "cancelled");
    return <div className="kitchen-print-ticket">
      <div className="kitchen-print-double-rule" />
      <h1>MUTFAK SİPARİŞİ</h1>
      <div className="kitchen-print-double-rule" />
      <div className="kitchen-print-meta">
        <div><b>Masa:</b><span>{task.tableName ?? "—"}</span></div>
        <div><b>Saat:</b><span>{new Date(task.submittedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div>
        <div><b>Garson:</b><span>{task.waiterName ?? "—"}</span></div>
        <div><b>Fiş No:</b><span>#{task.orderId.slice(0, 8).toUpperCase()}</span></div>
      </div>
      <div className="kitchen-print-rule" />
      <div className="kitchen-print-columns"><b>Adet</b><b>Ürün</b><b>Not</b></div>
      <div className="kitchen-print-rule" />
      <div className="kitchen-print-items">{printItems.map((item) => <div className="kitchen-print-item" key={item.id}>
        <strong>{item.quantity}x</strong><span>{item.productName}</span><span>{item.notes ?? "—"}</span>
      </div>)}</div>
      <div className="kitchen-print-double-rule" />
      <p className="kitchen-print-device-line">[BİP SESİ] - [OTOMATİK KAĞIT KESME]</p>
    </div>;
  }

  function ticket(task: KitchenTask, ready = false) {
    const age = taskAge(task);
    return <article className={`kitchen-ticket ${ready ? "kitchen-ready" : `kitchen-${age.level}`} ${selected?.id === task.id ? "print-target" : ""}`} key={task.id}>
      <div className="kitchen-screen-ticket-content">
        <header><div><span>{task.tableName ?? "MASA SİPARİŞİ"}{task.waiterName ? ` · ${task.waiterName}` : ""}</span><h2>{task.orderId.slice(0, 8).toUpperCase()}</h2></div><time>{new Date(task.submittedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</time></header>
        <div className="kitchen-station-label">{task.stationName}</div>
        <div className="kitchen-ticket-status"><b>{task.status === "submitted" ? "BEKLİYOR" : task.status === "preparing" ? "HAZIRLANIYOR" : "SERVİSE HAZIR"}</b><span>{age.minutes} dk</span></div>
        <ul><li><strong>{task.quantity}×</strong><span>{task.productName}</span></li></ul>
        <div className="kitchen-actions">
          <button className="kitchen-status-button" disabled={savingTaskId === task.id} onClick={() => void changeStatus(task)}>
            {savingTaskId === task.id ? "Kaydediliyor…" : task.status === "submitted" ? "Hazırlamaya başla" : task.status === "preparing" ? "Hazır" : "Servis edildi"}
          </button>
          <button className="kitchen-print-button" onClick={() => setSelected(task)}>Fiş yazdır</button>
        </div>
      </div>
      <div aria-hidden="true">{printTicket(task)}</div>
    </article>;
  }

  return <main className="ops-shell kitchen-shell">
    <header className="ops-header"><a href="/kitchen" className="ops-brand">HIPOS <span>MUTFAK</span></a><a className="ops-link" href="/waiter">Garson ekranı</a></header>
    <section className="ops-intro"><span className="ops-eyebrow">SİPARİŞ KUYRUĞU</span><h1>Mutfak fişleri</h1><p>Yeni garson siparişleri yerel sunucudan otomatik olarak yenilenir.</p></section>
    <div className="kitchen-toolbar"><span className={error ? "offline-dot" : "online-dot"} />{error ? "Sunucuya ulaşılamıyor" : `Bağlı · son yenileme ${lastRefresh?.toLocaleTimeString("tr-TR") ?? "—"}`}<button onClick={() => void load()}>Yenile</button></div>
    <nav className="kitchen-filters" aria-label="Mutfak istasyonları">
      <button className={stationFilter === "all" ? "active" : ""} onClick={() => setStationFilter("all")}>Tümü</button>
      {[...stations].sort((a, b) => ["hot", "oven", "bar", "cold"].indexOf(a.code) - ["hot", "oven", "bar", "cold"].indexOf(b.code)).map((station) => <button className={stationFilter === station.code ? "active" : ""} key={station.id} onClick={() => setStationFilter(station.code)}>{station.name}</button>)}
      <button className={stationFilter === "unassigned" ? "active" : ""} onClick={() => setStationFilter("unassigned")}>Atanmamış</button>
    </nav>
    {error && <p className="ops-error" role="alert">{error}</p>}
    {activeTasks.length === 0 && !error && <div className="kitchen-empty">Aktif hazırlık görevi yok. Yeni sipariş bekleniyor.</div>}
    <section className="kitchen-grid">{activeTasks.map((task) => ticket(task))}</section>
    {readyTasks.length > 0 && <section className="kitchen-section"><div className="kitchen-section-title"><span>SERVİSE HAZIR</span><b>{readyTasks.length}</b></div><div className="kitchen-grid">{readyTasks.map((task) => ticket(task, true))}</div></section>}
    {cancelledTasks.length > 0 && <section className="kitchen-section kitchen-cancelled"><div className="kitchen-section-title"><span>İPTAL EDİLENLER</span><b>{cancelledTasks.length}</b></div><ul>{cancelledTasks.map((task) => <li key={task.id}><span><strong>{task.quantity}× {task.productName}</strong><small>{task.tableName ?? task.orderId.slice(0, 8).toUpperCase()} · {task.cancellationReason}</small></span><time>{task.cancelledAt ? new Date(task.cancelledAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"}</time></li>)}</ul></section>}
    {servedTasks.length > 0 && <section className="kitchen-section kitchen-history"><div className="kitchen-section-title"><span>SON SERVİS EDİLENLER</span><b>{servedTasks.length}</b></div><ul>{servedTasks.map((task) => <li key={task.id}><span><strong>{task.quantity}× {task.productName}</strong><small>{task.tableName ?? task.orderId.slice(0, 8).toUpperCase()}</small></span><time>{task.servedAt ? new Date(task.servedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"}</time></li>)}</ul></section>}
    {selected && <div className="kitchen-print-preview" role="dialog" aria-modal="true" aria-label="Mutfak fişi önizlemesi">
      <div className="kitchen-print-preview-panel">
        <div className="kitchen-print-preview-header"><strong>80 mm fiş önizlemesi</strong><button onClick={() => setSelected(null)} aria-label="Önizlemeyi kapat">×</button></div>
        <div className="kitchen-print-preview-paper">{printTicket(selected)}</div>
        <div className="kitchen-print-preview-actions"><button onClick={() => setSelected(null)}>Kapat</button><button className="kitchen-print-confirm" onClick={() => window.print()}>Yazdır</button></div>
      </div>
    </div>}
    <p className="ops-footer">Yazdır düğmesi cihazın tarayıcı baskı penceresini açar. Gerçek otomatik yazdırma için mutfak yazıcısının modeli ve sürücüsü ayrıca gerekir.</p>
  </main>;
}

export function mountOperationalApp() {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path !== "/waiter" && path !== "/kitchen") return false;
  createRoot(document.getElementById("root")!).render(path === "/waiter" ? <WaiterApp /> : <KitchenApp />);
  return true;
}
