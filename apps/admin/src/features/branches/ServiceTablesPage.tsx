import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Line = { productId: string; productName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number };
type Assignment = { id: string; orderId: string; waiterId: string | null; waiterName: string | null;
  openedAt: string; orderCreatedAt: string; orderStatus: string; paymentStatus: string;
  totalMinor: number; version: number; items: Line[] };
type Table = { id: string; number: number; name: string; isActive: boolean; floor: string | null; version: number; group?: { tableNames: string[]; guestCount: number } | null; assignment?: Assignment | null };
type Waiter = { id: string; name: string; isActive: boolean };
type TableResponse = { source: "postgres"; tablesEnabled: boolean; waitersEnabled: boolean; floors?: string[]; items: Table[] };

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const dateTime = (value: string) => new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul",
}).format(new Date(value));

const normalizeFloor = (floor: string | null | undefined): string | null => {
  if (!floor) return null;
  const trimmed = floor.trim();
  if (!trimmed) return null;
  if (trimmed === "lower") return "Alt kat";
  if (trimmed === "upper") return "Üst kat";
  return trimmed;
};

async function serviceApi<T>(path: string, actor: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
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
  const [selectedFloorFilter, setSelectedFloorFilter] = useState<string | null>(null);
  const [newFloorName, setNewFloorName] = useState("");
  const [editingFloor, setEditingFloor] = useState<string | null>(null);
  const [editingFloorValue, setEditingFloorValue] = useState("");
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
    setLoading(true); setError("");
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
    setSelectedId(null); setSelectedWaiterId(null); setSelectedFloorFilter(null); void reload();
    return () => { requestSerial.current++; };
  }, [reload]);

  // SSE Canlı Masa Eşzamanlılığı
  useEffect(() => {
    const branchApiId = ctx.selectedBranch?.apiId;
    if (source !== "http" || !branchApiId) return;
    const base = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180";
    const token = localStorage.getItem("hipos_token");
    const sseUrl = `${base}/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(branchApiId)}/events/stream?actor=${actor}${
      token ? `&token=${encodeURIComponent(token)}` : ""
    }`;
    let eventSource: EventSource | null = null;
    let timer: number | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      try {
        eventSource = new EventSource(sseUrl);
        const handleEvent = () => {
          void reload();
        };
        eventSource.addEventListener("table.updated", handleEvent);
        eventSource.addEventListener("check.created", handleEvent);
        eventSource.addEventListener("check.closed", handleEvent);
        eventSource.addEventListener("check.cancelled", handleEvent);
        eventSource.onerror = () => {
          if (disposed) return;
          eventSource?.close();
          timer = window.setTimeout(connect, 4000);
        };
      } catch {
        if (!disposed) timer = window.setTimeout(connect, 5000);
      }
    }
    connect();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      eventSource?.close();
    };
  }, [source, scope, actor, reload]);

  const selected = data?.items.find((table) => table.id === selectedId) ?? null;
  const activeTables = data?.items.filter((table) => table.isActive) ?? [];
  const floors = Array.from(new Set([
    ...(data?.floors ?? []).map((f) => normalizeFloor(f)).filter((f): f is string => Boolean(f)),
    ...activeTables.map((t) => normalizeFloor(t.floor)).filter((f): f is string => Boolean(f)),
  ]));
  const visibleTables = selectedFloorFilter === null
    ? activeTables
    : selectedFloorFilter === "__unassigned__"
      ? activeTables.filter((t) => !normalizeFloor(t.floor))
      : activeTables.filter((t) => normalizeFloor(t.floor) === selectedFloorFilter);
  const lastTable = activeTables.at(-1) ?? null;
  const canAddTable = !lastTable || lastTable.number < 999;
  const occupied = activeTables.filter((table) => Boolean(table.assignment || table.group)).length;
  const selectedWaiter = waiters.find((waiter) => waiter.id === selectedWaiterId) ?? null;
  const waiterTableCount = (waiterId: string) => activeTables.filter((table) => table.assignment?.waiterId === waiterId).length;
  const floorTableCount = (floorName: string) => activeTables.filter((table) => normalizeFloor(table.floor) === floorName).length;
  const unassignedTableCount = activeTables.filter((table) => !normalizeFloor(table.floor)).length;

  function selectWaiter(waiterId: string | null) {
    setSelectedWaiterId((current) => current === waiterId ? null : waiterId);
    if (!waiterId || selectedWaiterId === waiterId) return;
    const firstAssignedTable = data?.items.find((table) => table.assignment?.waiterId === waiterId);
    if (firstAssignedTable) setSelectedId(firstAssignedTable.id);
  }

  async function createTable() {
    if (!scope || busy) return;
    setBusy(true); setError(""); setNotice("");
    const initialFloor = selectedFloorFilter && selectedFloorFilter !== "__unassigned__" ? selectedFloorFilter : null;
    try {
      const created = await serviceApi<{ id: string; number: number; name: string }>(`${scope}/tables`, actor, "POST", { name: null, floor: initialFloor });
      setSelectedId(created.id ?? null);
      setNotice(`${created.name ?? `Masa ${created.number}`} eklendi${initialFloor ? ` (${initialFloor})` : ""}.`);
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function changeFloor(floor: string | null) {
    if (!scope || !selected || busy || !data?.tablesEnabled) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await serviceApi(`${scope}/tables/${encodeURIComponent(selected.id)}/floor`, actor, "PUT", { floor, expectedVersion: selected.version });
      setNotice(`${selected.name} için kat bilgisi ${floor ? `"${floor}" olarak` : ""} kaydedildi.`);
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function addFloor(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = newFloorName.trim();
    if (!scope || !trimmed || busy || !data?.tablesEnabled) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await serviceApi(`${scope}/floors`, actor, "POST", { name: trimmed });
      setNewFloorName("");
      setNotice(`"${trimmed}" katı eklendi. Masaları bu kata atayabilirsiniz.`);
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function saveFloorRename(oldName: string) {
    const trimmed = editingFloorValue.trim();
    if (!scope || !trimmed || busy || !data?.tablesEnabled) return;
    if (trimmed === oldName) { setEditingFloor(null); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await serviceApi(`${scope}/floors`, actor, "PUT", { oldName, newName: trimmed });
      if (selectedFloorFilter === oldName) setSelectedFloorFilter(trimmed);
      setEditingFloor(null);
      setEditingFloorValue("");
      setNotice(`"${oldName}" katının adı "${trimmed}" olarak güncellendi.`);
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function removeFloor(name: string) {
    if (!scope || busy || !data?.tablesEnabled) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await serviceApi(`${scope}/floors/delete`, actor, "POST", { name });
      if (selectedFloorFilter === name) setSelectedFloorFilter(null);
      if (editingFloor === name) setEditingFloor(null);
      setNotice(`"${name}" katı kaldırıldı.`);
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function removeLastTable() {
    if (!scope || !lastTable || lastTable.assignment || lastTable.group || busy) return;
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
      description="Masalarınızı, kat/bölge adlarını ve servis sorumlularını takip edin; salonun durumunu tek bakışta görün."
      action={<div className="service-actions"><StatusPill tone={error ? "orange" : data?.tablesEnabled ? "green" : "neutral"}>
        {loading ? "Yükleniyor" : source !== "http" ? "Bağlantı gerekli" : error ? "Kurulum gerekiyor" : data?.tablesEnabled ? "Masa servisi etkin" : "Masa servisi kapalı"}
      </StatusPill><button type="button" className="service-refresh" onClick={() => void reload()} disabled={!scope || loading}>Yenile</button></div>} />
    <DemoNotice>Masa düzenini, kat/bölge adlarını ve servis sorumlularını buradan yönetebilirsiniz. Adisyon ve ödeme bilgileri bu ekranda yalnızca görüntülenir.</DemoNotice>
    {source !== "http" && <div className="notice" role="status">Masa planını kullanabilmek için servis bağlantısının kurulması gerekiyor.</div>}
    {!scope && <div className="card generic-empty">Masa planını görmek için bir şube seçin.</div>}
    {loading && !data && <div className="card generic-empty" role="status">Masa ve adisyonlar yükleniyor…</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {data && <>
      {!data.tablesEnabled && <div className="notice" role="status">Masa servisi kapalı. Geçmiş masa kayıtları okunabilir; yeni masa veya masa-adisyon bağı oluşturulamaz. Adisyon modülü etkilenmez.</div>}
      {!data.waitersEnabled && <div className="notice" role="status">Garson servisi kapalı. Yeni garson kartı veya garsonlu masa bağı oluşturulamaz; geçmiş atamalar okunabilir.</div>}

      <section className="card content-card padded" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
          <div>
            <span className="card-kicker">KAT VE BÖLGE YÖNETİMİ</span>
            <h2 style={{ margin: "2px 0 4px" }}>Katlar ({floors.length})</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              İstediğiniz kadar kat veya salon bölgesi (ör. Zemin Kat, 1. Kat, Teras, Bahçe, VIP) ekleyebilir, adlarını değiştirebilir veya silebilirsiniz.
            </p>
          </div>
          {data.tablesEnabled && (
            <form onSubmit={(e) => void addFloor(e)} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                maxLength={80}
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder="Yeni kat adı yazın (ör. Teras, 2. Kat)…"
                disabled={busy}
                style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line-strong, #cbd5e1)", fontSize: 13, minWidth: 230 }}
              />
              <button type="submit" className="primary-button" disabled={busy || !newFloorName.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={15} /> Kat ekle
              </button>
            </form>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} role="group" aria-label="Kat filtreleri ve yönetimi">
          <button
            type="button"
            className={`service-waiter-chip ${selectedFloorFilter === null ? "active" : ""}`}
            onClick={() => setSelectedFloorFilter(null)}
            style={{ padding: "8px 12px" }}
          >
            <span className="waiter-chip-name">Tüm katlar</span>
            <strong>{activeTables.length}</strong>
            <small>masa</small>
          </button>

          {floors.map((floorName) => {
            const isEditing = editingFloor === floorName;
            const count = floorTableCount(floorName);
            return (
              <div
                key={floorName}
                className={`service-waiter-chip ${selectedFloorFilter === floorName ? "active" : ""}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px" }}
              >
                {isEditing ? (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="text"
                      maxLength={80}
                      value={editingFloorValue}
                      onChange={(e) => setEditingFloorValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); void saveFloorRename(floorName); }
                        if (e.key === "Escape") { setEditingFloor(null); }
                      }}
                      autoFocus
                      disabled={busy}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line-strong, #cbd5e1)", fontSize: 13, width: 140 }}
                    />
                    <button
                      type="button"
                      title="Kaydet"
                      disabled={busy || !editingFloorValue.trim()}
                      onClick={() => void saveFloorRename(floorName)}
                      style={{ border: "none", background: "#166534", color: "#fff", borderRadius: 6, padding: "4px 6px", cursor: "pointer", display: "inline-flex" }}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      title="Vazgeç"
                      disabled={busy}
                      onClick={() => setEditingFloor(null)}
                      style={{ border: "none", background: "#e2e8f0", color: "#334155", borderRadius: 6, padding: "4px 6px", cursor: "pointer", display: "inline-flex" }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setSelectedFloorFilter((curr) => curr === floorName ? null : floorName)}
                      style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 6, color: "inherit", font: "inherit" }}
                    >
                      <span className="waiter-chip-name">{floorName}</span>
                      <strong>{count}</strong>
                      <small>masa</small>
                    </button>
                    {data.tablesEnabled && (
                      <span style={{ display: "inline-flex", gap: 4, marginLeft: 4 }}>
                        <button
                          type="button"
                          title={`"${floorName}" adını düzenle`}
                          disabled={busy}
                          onClick={() => { setEditingFloor(floorName); setEditingFloorValue(floorName); }}
                          style={{ border: "none", background: "rgba(15,23,42,0.06)", color: "inherit", borderRadius: 5, padding: 4, cursor: "pointer", display: "inline-flex" }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          title={`"${floorName}" katını sil`}
                          disabled={busy}
                          onClick={() => void removeFloor(floorName)}
                          style={{ border: "none", background: "rgba(220,38,38,0.1)", color: "#b91c1c", borderRadius: 5, padding: 4, cursor: "pointer", display: "inline-flex" }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {unassignedTableCount > 0 && (
            <button
              type="button"
              className={`service-waiter-chip ${selectedFloorFilter === "__unassigned__" ? "active" : ""}`}
              onClick={() => setSelectedFloorFilter((curr) => curr === "__unassigned__" ? null : "__unassigned__")}
              style={{ padding: "8px 12px" }}
            >
              <span className="waiter-chip-name">Katı seçilmemiş</span>
              <strong>{unassignedTableCount}</strong>
              <small>masa</small>
            </button>
          )}
        </div>
      </section>

      <div className="branch-detail-grid service-layout">
        <section className="card table-plan-card">
          <div className="card-heading"><div><span className="card-kicker">VERİTABANINA BAĞLI MASA PLANI</span><h2>{ctx.selectedBranch?.name}{selectedFloorFilter ? ` · ${selectedFloorFilter === "__unassigned__" ? "Katı seçilmemiş" : selectedFloorFilter}` : ""}</h2></div>
            <span className="service-summary">{occupied}/{activeTables.length} masada açık bağ</span></div>
          {visibleTables.length ? <div className={`table-plan service-table-plan ${selectedWaiterId ? "has-waiter-filter" : ""}`}>
            {visibleTables.map((table) => {
              const tableFloor = normalizeFloor(table.floor);
              return <button key={table.id} type="button"
                className={`restaurant-table service-table ${table.assignment || table.group ? "occupied" : ""} ${selectedId === table.id ? "selected" : ""} ${selectedWaiterId && table.assignment?.waiterId === selectedWaiterId ? "waiter-match" : ""} ${selectedWaiterId && table.assignment?.waiterId !== selectedWaiterId ? "waiter-dimmed" : ""}`}
                onClick={() => setSelectedId(table.id)} aria-pressed={selectedId === table.id}
                aria-label={`${table.name}, ${tableFloor ?? "kat atanmamış"}, ${table.group ? "masa grubunda" : table.assignment ? "açık adisyon var" : "açık adisyon yok"}`}>
                <span className="service-table-number"><LayoutGrid size={14} />{String(table.number).padStart(2, "0")}</span>
                {tableFloor && <span className="service-table-waiter" style={{ fontSize: 11, opacity: 0.85 }}>{tableFloor}</span>}
                {table.group && <span className="service-table-waiter">{table.group.tableNames.join(" + ")} · {table.group.guestCount} kişi</span>}
                {table.assignment && <><span className="service-table-waiter">{table.assignment.waiterName ?? "Garson atanmamış"}</span><span className="service-table-total">{money(table.assignment.totalMinor)}</span></>}
              </button>;
            })}
          </div> : <p>{activeTables.length ? "Seçili kat filtresinde masa bulunmuyor." : "Bu şubede aktif masa yok. “Masa ekle” ile ilk masayı oluşturabilirsiniz."}</p>}
          <p className="card-note">Dolu durumu açık masa-adisyon bağı veya aktif masa grubundan hesaplanır. Garson filtresi sorumlu olduğu masaları vurgular; self-servis adisyonlar masa doluluğuna eklenmez.</p>
          {data.tablesEnabled && <div className="service-table-actions">
            <div className="service-table-actions-copy"><span className="card-kicker">MASA DÜZENİ</span><strong>{activeTables.length} aktif masa</strong><small>{lastTable ? `Son masa: ${lastTable.name}` : "Henüz masa yok"}</small></div>
            <div className="service-table-action-buttons">
              <button className="primary-button" type="button" disabled={busy || !canAddTable} onClick={() => void createTable()}>
                Masa ekle{selectedFloorFilter && selectedFloorFilter !== "__unassigned__" ? ` (${selectedFloorFilter})` : ""}
              </button>
              <button className="soft-button danger-soft-button" type="button" disabled={busy || !lastTable || Boolean(lastTable.assignment || lastTable.group)} onClick={() => void removeLastTable()}>Masa sil</button>
            </div>
            {lastTable?.group && <div className="service-table-warning" role="status">Bu masa bir gruba bağlı; kaldırmadan önce garson ekranından grubu ayırın.</div>}
            {lastTable?.assignment && <div className="service-table-warning" role="status"><strong>{lastTable.name} silinemez.</strong> Bu masada açık adisyon var; önce adisyonu kapatın. Masa numaraları sondan geriye doğru kaldırılır.</div>}
            {!canAddTable && <div className="service-table-warning" role="status">Bu şubede masa numarası sınırına ulaşıldı.</div>}
            {canAddTable && <small className="service-table-next-number">Masa ekle, sıradaki numarayı otomatik verir{lastTable ? `: ${lastTable.number + 1}` : ": 1"}.</small>}
          </div>}
        </section>
        <section className="card branch-side-card service-detail" aria-live="polite">
          <span className="card-kicker">MASA DETAYI</span>
          {!selected ? <><h2>Masa seçin</h2><p>Kat ataması, adisyon, sipariş zamanı, ürünler ve sorumlu garson için bir masaya tıklayın.</p></> : <>
            <h2>{selected.name}</h2>
            <label className="service-floor-field">Kat / Bölge
              <select
                value={normalizeFloor(selected.floor) ?? ""}
                disabled={busy || !data.tablesEnabled}
                onChange={(event) => void changeFloor(event.target.value || null)}
              >
                <option value="">Kat seçilmedi</option>
                {floors.map((floorName) => (
                  <option key={floorName} value={floorName}>{floorName}</option>
                ))}
              </select>
            </label>
            <p className="service-floor-hint">Bu seçim garson ve kasiyer ekranlarındaki kat gruplamasını belirler.</p>
            {selected.group && <p>Masa grubu: {selected.group.tableNames.join(" + ")} · {selected.group.guestCount} kişi. Ortak hesap ana masada tutulur.</p>}
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
