import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Line = { productId: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number };
type Assignment = { id: string; orderId: string; waiterId: string | null; waiterName: string | null;
  openedAt: string; orderCreatedAt: string; orderStatus: string; paymentStatus: string;
  totalMinor: number; version: number; items: Line[] };
type Table = { id: string; number: number; name: string; isActive: boolean; assignment?: Assignment | null };
type Waiter = { id: string; name: string; isActive: boolean };
type TableResponse = { source: "postgres"; tablesEnabled: boolean; waitersEnabled: boolean; items: Table[] };

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
}).format(new Date(value));

async function serviceApi<T>(path: string, actor: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180"}${path}`, {
      method, headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Yerel masa servisi API'sine bağlanılamadı. API'nin çalıştığını kontrol edin.");
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(problem.detail ?? `Masa servisi isteği başarısız (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function ServiceTablesPage({ ctx, source }: { ctx: ViewContext; source: "http" | "mock" }) {
  const [data, setData] = useState<TableResponse | null>(null);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWaiterId, setSelectedWaiterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSerial = useRef(0);
  const scope = ctx.selectedBranch?.apiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.selectedBranch.apiId)}/service`
    : null;
  const actor = ctx.isMulti ? "manager-multi" : "manager-single";

  const reload = useCallback(async () => {
    const serial = ++requestSerial.current;
    if (source !== "http") { setData(null); setWaiters([]); setLoading(false); setError(""); return; }
    if (!scope) { setData(null); setWaiters([]); return; }
    setLoading(true); setError(""); setData(null);
    try {
      const [tables, people] = await Promise.all([
        serviceApi<TableResponse>(`${scope}/tables`, actor),
        serviceApi<{ items: Waiter[] }>(`${scope}/waiters`, actor),
      ]);
      if (serial === requestSerial.current) { setData(tables); setWaiters(people.items); }
    } catch (reason) { if (serial === requestSerial.current) setError((reason as Error).message); }
    finally { if (serial === requestSerial.current) setLoading(false); }
  }, [scope, actor, source]);

  useEffect(() => {
    setSelectedId(null); setSelectedWaiterId(null); void reload();
    return () => { requestSerial.current++; };
  }, [reload]);
  const selected = data?.items.find((table) => table.id === selectedId) ?? null;
  const activeTables = data?.items.filter((table) => table.isActive) ?? [];
  const lastTable = activeTables.at(-1) ?? null;
  const canAddTable = !lastTable || lastTable.number < 999;
  const occupied = activeTables.filter((table) => Boolean(table.assignment)).length;
  const selectedWaiter = waiters.find((waiter) => waiter.id === selectedWaiterId) ?? null;
  const waiterTableCount = (waiterId: string) => activeTables.filter((table) => table.assignment?.waiterId === waiterId).length;

  function selectWaiter(waiterId: string | null) {
    setSelectedWaiterId((current) => current === waiterId ? null : waiterId);
    if (!waiterId || selectedWaiterId === waiterId) return;
    const firstAssignedTable = data?.items.find((table) => table.assignment?.waiterId === waiterId);
    if (firstAssignedTable) setSelectedId(firstAssignedTable.id);
  }

  async function createTable() {
    if (!scope || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await serviceApi<{ id: string; number: number; name: string }>(`${scope}/tables`, actor, "POST", { name: null });
      setSelectedId(created.id ?? null);
      setNotice(`${created.name ?? `Masa ${created.number}`} eklendi.`); await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function removeLastTable() {
    if (!scope || !lastTable || lastTable.assignment || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await serviceApi(`${scope}/tables/${encodeURIComponent(lastTable.id)}`, actor, "DELETE");
      if (selectedId === lastTable.id) setSelectedId(null);
      setNotice(`${lastTable.name} kaldırıldı. Eski masa/adisyon geçmişi korundu.`); await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
      <PageHeading eyebrow="MASA SERVİSİ" title="Masa planı"
      description="Masa-adisyon bağını ve servis sorumlusunu şube bazında inceleyin. Satış adisyonları masa servisinden bağımsızdır."
      action={<div className="service-actions"><StatusPill tone={error ? "orange" : data?.tablesEnabled ? "green" : "neutral"}>
        {loading ? "Yükleniyor" : source !== "http" ? "Sağlayıcı gerekli" : error ? "Kurulum gerekiyor" : data?.tablesEnabled ? "PostgreSQL · etkin" : "Masa servisi kapalı"}
      </StatusPill><button type="button" className="service-refresh" onClick={() => void reload()} disabled={!scope || loading}>Yenile</button></div>} />
    <DemoNotice>Bu görünüm yerel PostgreSQL kayıtlarını okur; başlangıç siparişleri kurgusal demodur. Yönetim paneli adisyon veya ödeme durumunu değiştirmez. X-Demo-Actor üretim kimlik doğrulaması değildir.</DemoNotice>
    {source !== "http" && <div className="notice" role="status">Masa planı şube listesinden ayrıdır ve servis API’sinden beslenir. Yerel servis ekranı için VITE_SERVICE_PROVIDER=http ayarını yapıp paneli yeniden başlatın.</div>}
    {!scope && <div className="card generic-empty">Bu şube için API kapsamı seçilmedi.</div>}
    {loading && <div className="card generic-empty" role="status">Masa ve adisyonlar yükleniyor…</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {data && <>
      {!data.tablesEnabled && <div className="notice" role="status">Masa servisi kapalı. Geçmiş masa kayıtları okunabilir; yeni masa veya masa-adisyon bağı oluşturulamaz. Adisyon modülü etkilenmez.</div>}
      {!data.waitersEnabled && <div className="notice" role="status">Garson servisi kapalı. Yeni garson kartı veya garsonlu masa bağı oluşturulamaz; geçmiş atamalar okunabilir.</div>}
      <div className="branch-detail-grid service-layout">
        <section className="card table-plan-card">
          <div className="card-heading"><div><span className="card-kicker">VERİTABANINA BAĞLI MASA PLANI</span><h2>{ctx.selectedBranch?.name}</h2></div>
            <span className="service-summary">{occupied}/{activeTables.length} masada açık bağ</span></div>
          {activeTables.length ? <div className={`table-plan service-table-plan ${selectedWaiterId ? "has-waiter-filter" : ""}`}>
            {activeTables.map((table) => <button key={table.id} type="button"
              className={`restaurant-table service-table ${table.assignment ? "occupied" : ""} ${selectedId === table.id ? "selected" : ""} ${selectedWaiterId && table.assignment?.waiterId === selectedWaiterId ? "waiter-match" : ""} ${selectedWaiterId && table.assignment?.waiterId !== selectedWaiterId ? "waiter-dimmed" : ""}`}
              onClick={() => setSelectedId(table.id)} aria-pressed={selectedId === table.id}
              aria-label={`${table.name}, ${table.assignment ? "açık adisyon var" : "açık adisyon yok"}`}>
              <span className="service-table-number"><LayoutGrid size={14} />{String(table.number).padStart(2, "0")}</span>
              {table.assignment && <><span className="service-table-waiter">{table.assignment.waiterName ?? "Garson atanmamış"}</span><span className="service-table-total">{money(table.assignment.totalMinor)}</span></>}
            </button>)}
          </div> : <p>Bu şubede aktif masa yok. “Masa ekle” ile ilk masayı oluşturabilirsiniz.</p>}
          <p className="card-note">Dolu durumu açık masa-adisyon bağından hesaplanır. Garson filtresi sorumlu olduğu masaları vurgular; self-servis adisyonlar masa doluluğuna eklenmez.</p>
          {data.tablesEnabled && <div className="service-table-actions">
            <div className="service-table-actions-copy"><span className="card-kicker">MASA DÜZENİ</span><strong>{activeTables.length} aktif masa</strong><small>{lastTable ? `Son masa: ${lastTable.name}` : "Henüz masa yok"}</small></div>
            <div className="service-table-action-buttons">
              <button className="primary-button" type="button" disabled={busy || !canAddTable} onClick={() => void createTable()}>Masa ekle</button>
              <button className="soft-button danger-soft-button" type="button" disabled={busy || !lastTable || Boolean(lastTable.assignment)} onClick={() => void removeLastTable()}>Masa sil</button>
            </div>
            {lastTable?.assignment && <div className="service-table-warning" role="status"><strong>{lastTable.name} silinemez.</strong> Bu masada açık adisyon var; önce adisyonu kapatın. Masa numaraları sondan geriye doğru kaldırılır.</div>}
            {!canAddTable && <div className="service-table-warning" role="status">Bu şubede masa numarası sınırına ulaşıldı.</div>}
            {canAddTable && <small className="service-table-next-number">Masa ekle, sıradaki numarayı otomatik verir{lastTable ? `: ${lastTable.number + 1}` : ": 1"}.</small>}
          </div>}
        </section>
        <section className="card branch-side-card service-detail" aria-live="polite">
          <span className="card-kicker">MASA DETAYI</span>
          {!selected ? <><h2>Masa seçin</h2><p>Adisyon, sipariş zamanı, ürünler ve sorumlu garson için bir masaya tıklayın.</p></> : <>
            <h2>{selected.name}</h2>
            {!selected.isActive && <StatusPill tone="orange">Masa pasif</StatusPill>}
            {!selected.assignment ? <p>Bu masada açık adisyon yok.</p> : <>
              {!data.tablesEnabled && <p className="service-historical">Masa servisi kapalı · geçmiş bağ</p>}
              <div className="side-stat"><span>Adisyon</span><strong title={selected.assignment.orderId}>{selected.assignment.orderId.slice(0, 8)}…{selected.assignment.orderId.slice(-4)}</strong></div>
              <div className="side-stat"><span>Sipariş zamanı</span><strong>{dateTime(selected.assignment.orderCreatedAt)}</strong></div>
              <div className="side-stat"><span>Masaya bağlanma</span><strong>{dateTime(selected.assignment.openedAt)}</strong></div>
              <div className="side-stat"><span>Sorumlu garson</span><strong>{selected.assignment.waiterName ?? "Garson atanmamış"}</strong></div>
              {selected.assignment.waiterName && !data.waitersEnabled && <small className="service-historical">Geçmiş atama; garson servisi şu anda kapalı.</small>}
              <div className="side-stat"><span>Ödeme durumu</span><strong>{selected.assignment.paymentStatus === "unpaid" ? "Ödenmedi" : selected.assignment.paymentStatus}</strong></div>
              <h3>Sipariş edilenler</h3>
              <ul className="service-lines">{selected.assignment.items.map((line, index) => <li key={`${line.productId}-${index}`}>
                <span>{line.quantity} × {line.productName}</span><strong>{money(line.lineTotalMinor)}</strong>
              </li>)}</ul>
              <div className="side-stat"><span>Adisyon toplamı</span><strong>{money(selected.assignment.totalMinor)}</strong></div>
              <Link to="/admin/sales/open" className="subtle-link">Adisyonları incele <ArrowRight size={15} /></Link>
            </>}
          </>}
        </section>
      </div>
      <section className="card content-card padded service-waiters">
        <div className="service-waiters-heading"><div><span className="card-kicker">SERVİS EKİBİ</span><h2>Garsonlar ve masa sorumluluğu</h2>
          <p>Bir garsonu seçin: ilgilendiği masalar parlar, diğer masalar geri planda kalır. Çalışma süresi veya performans hesabı yapılmaz.</p></div>
          {selectedWaiter && <StatusPill tone="blue">{selectedWaiter.name} · {waiterTableCount(selectedWaiter.id)} masa</StatusPill>}
        </div>
        {waiters.length ? <div className="service-waiter-list" aria-label="Garson masa filtresi">
          <button type="button" className={`service-waiter-chip ${selectedWaiterId === null ? "active" : ""}`} aria-pressed={selectedWaiterId === null} onClick={() => selectWaiter(null)}>
            <span className="waiter-chip-name">Tüm masalar</span><strong>{occupied}</strong><small>açık masa</small>
          </button>
          {waiters.map((person) => <button key={person.id} type="button"
            className={`service-waiter-chip ${selectedWaiterId === person.id ? "active" : ""} ${!person.isActive ? "inactive" : ""}`}
            aria-pressed={selectedWaiterId === person.id} onClick={() => selectWaiter(person.id)}>
            <span className="waiter-chip-name">{person.name}{!person.isActive ? " · pasif" : ""}</span>
            <strong>{waiterTableCount(person.id)}</strong><small>ilgili masa</small>
          </button>)}
        </div> : <p>Bu şubede garson kartı bulunmuyor.</p>}
        {selectedWaiter && waiterTableCount(selectedWaiter.id) === 0 && <div className="notice" role="status">{selectedWaiter.name} için açık masa ataması yok.</div>}
        <Link to="/admin/kitchen/personnel" className="subtle-link service-personnel-link">Personel yönetimine git <ArrowRight size={15} /></Link>
      </section>
    </>}
  </>;
}
