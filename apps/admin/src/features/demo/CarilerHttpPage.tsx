import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Kind = "customer" | "supplier";
type Movement = { id: string; kind: Kind; deltaMinor: number; description: string; source: string; createdAt: string };
type Party = { id: string; name: string; types: Kind[]; isActive: boolean; version: number;
  customerBalanceMinor: number; supplierBalanceMinor: number; movementCount: number; movements: Movement[] };
type Statement = { partyId: string; from: string; to: string; timeZone: string;
  openingCustomerBalanceMinor: number; openingSupplierBalanceMinor: number;
  periodCustomerDeltaMinor: number; periodSupplierDeltaMinor: number;
  closingCustomerBalanceMinor: number; closingSupplierBalanceMinor: number; movements: Movement[] };

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const todayIstanbul = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

async function api<T>(path: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:5180"}${path}`, {
      method,
      headers: { "X-Demo-Actor": "manager-single", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Yerel cari API'sine bağlanılamadı. API'nin çalıştığını kontrol edin.");
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(problem.detail ?? `Cari işlemi başarısız (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function CarilerHttpPage({ ctx, kind }: { ctx: ViewContext; kind: Kind | "all" }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [newKind, setNewKind] = useState<Kind | "both">(kind === "supplier" ? "supplier" : "customer");
  const [movementKind, setMovementKind] = useState<Kind>("customer");
  const [direction, setDirection] = useState("increase");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editTypes, setEditTypes] = useState<Kind[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [fromDate, setFromDate] = useState(() => `${todayIstanbul().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIstanbul);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [statementError, setStatementError] = useState("");
  const [statementLoading, setStatementLoading] = useState(false);
  const scope = ctx.scenarioId === "single" && ctx.branchApiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/caris`
    : null;

  const reload = useCallback(async () => {
    if (!scope) { setParties([]); setHasLoaded(false); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await api<{ items: Party[] }>(scope);
      setParties(result.items);
      setHasLoaded(true);
      setError("");
    } catch (reason) {
      setHasLoaded(false);
      setError((reason as Error).message);
    } finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setNewKind(kind === "supplier" ? "supplier" : "customer"); }, [kind]);
  const visible = parties.filter((party) => kind === "all" || party.types.includes(kind));
  const selected = visible.find((party) => party.id === selectedId) ?? visible[0];
  const title = kind === "customer" ? "Müşteriler" : kind === "supplier" ? "Tedarikçiler" : "Cari hesaplar";

  useEffect(() => {
    setEditing(false);
    setEditName(selected?.name ?? "");
    setEditTypes(selected?.types ?? []);
    setEditActive(selected?.isActive ?? true);
  }, [selected?.id, selected?.version]);

  useEffect(() => {
    let cancelled = false;
    if (!scope || !selected || !fromDate || !toDate) { setStatement(null); return; }
    setStatementLoading(true);
    setStatement(null);
    setStatementError("");
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    void api<Statement>(`${scope}/${encodeURIComponent(selected.id)}/statement?${params}`)
      .then((value) => { if (!cancelled) setStatement(value); })
      .catch((reason) => { if (!cancelled) setStatementError((reason as Error).message); })
      .finally(() => { if (!cancelled) setStatementLoading(false); });
    return () => { cancelled = true; };
  }, [scope, selected?.id, selected?.version, fromDate, toDate]);

  async function createParty(event: FormEvent) {
    event.preventDefault();
    if (!scope || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const party = await api<Party>(scope, "POST", { name: name.trim(), types: newKind === "both" ? ["customer", "supplier"] : [newKind] });
      setName(""); setSelectedId(party.id);
      setNotice("Cari kartı PostgreSQL'e kaydedildi.");
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function addMovement(event: FormEvent) {
    event.preventDefault();
    if (!scope || !selected || busy) return;
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) { setError("Tutar pozitif olmalı."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`${scope}/${encodeURIComponent(selected.id)}/movements`, "POST", {
        requestId: crypto.randomUUID(), kind: selected.types.includes(movementKind) ? movementKind : selected.types[0],
        deltaMinor: direction === "increase" ? amountMinor : -amountMinor,
        description: description.trim(), expectedVersion: selected.version,
      });
      setAmount(""); setDescription("");
      setNotice("Elle girilen cari hareketi kaydedildi; bakiye hareketlerden yeniden hesaplandı. Bu gerçek tahsilat veya fatura değildir.");
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function updateParty(event: FormEvent) {
    event.preventDefault();
    if (!scope || !selected || busy) return;
    if (!editTypes.length) { setError("En az bir cari türü seçin."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`${scope}/${encodeURIComponent(selected.id)}`, "PUT", {
        name: editName.trim(), types: editTypes, isActive: editActive, expectedVersion: selected.version,
      });
      setEditing(false);
      setNotice("Cari kartı PostgreSQL'de güncellendi.");
      await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function toggleEditType(type: Kind) {
    setEditTypes((current) => current.includes(type) ? current.filter((item) => item !== type) : [...current, type]);
  }

  return <>
    <PageHeading eyebrow="CARİ VE MÜŞTERİLER" title={title}
      description="Tek şubede müşteri ve tedarikçi kartları; ayrı alacak/borç hareketleri ve hesaplanan bakiyeler."
      action={<StatusPill tone={!scope ? "orange" : loading ? "neutral" : hasLoaded ? "green" : "orange"}>
        {!scope ? "Bu senaryoda etkin değil" : loading ? "Yükleniyor" : hasLoaded ? "PostgreSQL · ilk dilim" : "Kurulum gerekiyor"}
      </StatusPill>} />
    <DemoNotice>Bu alan yerel geliştirme API'sine bağlıdır. Başlangıç kayıtları kurgusal demodur; yeni cari hareketi yalnız manuel bakiye kaydıdır, gerçek ödeme veya fatura oluşturmaz. X-Demo-Actor üretim kimlik doğrulaması değildir.</DemoNotice>
    {!scope && <div className="card generic-empty">Kalıcı cari görünümü yalnız Mahalle Fırını · Kadıköy Şubesi için açıldı.</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {scope && loading && <div className="card generic-empty" role="status">Cari kayıtları yükleniyor…</div>}
    {scope && !loading && hasLoaded && <>
      <section className="card content-card">
        <div className="card-heading padded"><div><span className="card-kicker">KALICI CARİ KARTLARI</span><h2>{title}</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>AD / UNVAN</th><th>TÜR</th><th>HAREKET</th><th>BAKİYE</th><th>DURUM</th></tr></thead>
          <tbody>{visible.map((party) => <tr key={party.id} onClick={() => { setSelectedId(party.id); setMovementKind(party.types[0]); }} style={{ cursor: "pointer" }}>
            <td><button type="button" className="subtle-link" onClick={() => { setSelectedId(party.id); setMovementKind(party.types[0]); }}>{party.name}</button></td>
            <td>{party.types.map((type) => type === "customer" ? "Müşteri" : "Tedarikçi").join(" / ")}</td>
            <td>{party.movementCount}</td>
            <td>{party.types.includes("customer") && <span>Alacak: {money(party.customerBalanceMinor)} </span>}
              {party.types.includes("supplier") && <span>Borç: {money(party.supplierBalanceMinor)}</span>}</td>
            <td>{party.isActive ? "Aktif" : "Pasif"}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section className="card content-card padded">
        <span className="card-kicker">YENİ KART</span><h2>Müşteri veya tedarikçi ekle</h2>
        <form className="cari-form" onSubmit={createParty}>
          <label>Ad / unvan <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} required /></label>
          <label>Tür <select value={newKind} disabled={kind !== "all"} onChange={(event) => setNewKind(event.target.value as Kind | "both")}>
            <option value="customer">Müşteri</option><option value="supplier">Tedarikçi</option>
            {kind === "all" && <option value="both">Müşteri ve tedarikçi</option>}
          </select></label>
          <button className="primary-button" type="submit" disabled={busy}>Cari kartı kaydet</button>
        </form>
      </section>
      {selected && <section className="card content-card padded">
        <span className="card-kicker">CARİ HAREKETLERİ</span><h2>{selected.name}</h2>
        <button type="button" className="subtle-link" onClick={() => setEditing((value) => !value)}>
          {editing ? "Düzenlemeyi kapat" : "Cari kartını düzenle"}
        </button>
        {editing && <form className="cari-form" onSubmit={updateParty}>
          <label>Unvan <input value={editName} onChange={(event) => setEditName(event.target.value)} minLength={2} maxLength={160} required /></label>
          <label className="cari-check"><input type="checkbox" checked={editTypes.includes("customer")} onChange={() => toggleEditType("customer")} /> Müşteri</label>
          <label className="cari-check"><input type="checkbox" checked={editTypes.includes("supplier")} onChange={() => toggleEditType("supplier")} /> Tedarikçi</label>
          <label className="cari-check"><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> Aktif</label>
          <button className="primary-button" type="submit" disabled={busy}>Kart değişikliklerini kaydet</button>
        </form>}
        <p className="card-note">Pozitif hareket müşteri alacağını veya tedarikçi borcunu artırır; kapama hareketi azaltır. Negatif bakiye fazla kapama anlamına gelebilir.</p>
        {selected.isActive && <form className="cari-form" onSubmit={addMovement}>
          <label>Hesap <select value={selected.types.includes(movementKind) ? movementKind : selected.types[0]} onChange={(event) => setMovementKind(event.target.value as Kind)}>
            {selected.types.map((type) => <option key={type} value={type}>{type === "customer" ? "Müşteri alacağı" : "Tedarikçi borcu"}</option>)}
          </select></label>
          <label>İşlem <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="increase">Bakiye artır</option><option value="decrease">Bakiye azalt / kapama</option>
          </select></label>
          <label>Tutar (₺) <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          <label>Açıklama <input value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={500} required /></label>
          <button className="primary-button" type="submit" disabled={busy}>Hareketi kaydet</button>
        </form>}
        <div className="cari-statement">
          <span className="card-kicker">TARİH ARALIKLI EKSTRE</span><h3>Devir, dönem ve kapanış</h3>
          <p className="card-note">Tarihler İstanbul saatine göre gün başından gün sonuna kadar değerlendirilir. Bakiye kullanıcı tarafından girilmez.</p>
          <div className="cari-form">
            <label>Başlangıç tarihi <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label>Bitiş tarihi <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
          </div>
          {statementError && <div className="notice" role="alert">{statementError}</div>}
          {statementLoading && <p role="status">Ekstre yükleniyor…</p>}
          {statement && <>
            <div className="table-scroll"><table><thead><tr><th>HESAP</th><th>DEVİR BAKİYESİ</th><th>DÖNEM HAREKETİ</th><th>KAPANIŞ BAKİYESİ</th></tr></thead>
              <tbody>
                {selected.types.includes("customer") && <tr><td>Müşteri alacağı</td><td>{money(statement.openingCustomerBalanceMinor)}</td><td>{money(statement.periodCustomerDeltaMinor)}</td><td>{money(statement.closingCustomerBalanceMinor)}</td></tr>}
                {selected.types.includes("supplier") && <tr><td>Tedarikçi borcu</td><td>{money(statement.openingSupplierBalanceMinor)}</td><td>{money(statement.periodSupplierDeltaMinor)}</td><td>{money(statement.closingSupplierBalanceMinor)}</td></tr>}
              </tbody>
            </table></div>
            <h3>Dönem hareketleri</h3>
            {statement.movements.length ? <div className="table-scroll"><table><thead><tr><th>TARİH</th><th>HESAP</th><th>AÇIKLAMA</th><th>KAYNAK</th><th>ETKİ</th></tr></thead>
              <tbody>{statement.movements.map((movement) => <tr key={movement.id}>
                <td>{new Date(movement.createdAt).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
                <td>{movement.kind === "customer" ? "Müşteri alacağı" : "Tedarikçi borcu"}</td>
                <td>{movement.description}</td><td>{movement.source === "demo_seed" ? "Demo seed" : "Elle girildi"}</td>
                <td>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</td>
              </tr>)}</tbody>
            </table></div> : <p>Bu tarihlerde hareket yok. Devir bakiyesi önceki hareketleri içerir.</p>}
          </>}
        </div>
        <h3>Tüm hareketler</h3>
        <div className="table-scroll"><table><thead><tr><th>TARİH</th><th>HESAP</th><th>AÇIKLAMA</th><th>KAYNAK</th><th>ETKİ</th></tr></thead>
          <tbody>{selected.movements.map((movement) => <tr key={movement.id}>
            <td>{new Date(movement.createdAt).toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })}</td>
            <td>{movement.kind === "customer" ? "Müşteri alacağı" : "Tedarikçi borcu"}</td>
            <td>{movement.description}</td><td>{movement.source === "demo_seed" ? "Demo seed" : "Elle girildi"}</td>
            <td>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </>}
  </>;
}
