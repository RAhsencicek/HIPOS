import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Kind = "customer" | "supplier";
type EntryType = "customer_charge" | "customer_collection" | "supplier_debt" | "supplier_payment" | "adjustment_increase" | "adjustment_decrease" | "legacy_manual";
type Movement = { id: string; kind: Kind; entryType: EntryType; deltaMinor: number; description: string; reference?: string;
  effectiveDate: string; source: string; isDemo: boolean; createdAt: string };
type Party = { id: string; name: string; types: Kind[]; phone?: string; email?: string; note?: string; isActive: boolean; version: number;
  customerBalanceMinor: number; supplierBalanceMinor: number; movementCount: number; movements: Movement[] };
type Statement = { partyId: string; from: string; to: string; timeZone: string;
  openingCustomerBalanceMinor: number; openingSupplierBalanceMinor: number;
  periodCustomerDeltaMinor: number; periodSupplierDeltaMinor: number;
  closingCustomerBalanceMinor: number; closingSupplierBalanceMinor: number; movements: Movement[] };
type Summary = { source: string; activeCustomers: number; activeSuppliers: number; customerReceivableMinor: number;
  customerCreditMinor: number; supplierPayableMinor: number; supplierAdvanceMinor: number;
  recentMovements: Array<Movement & { partyId: string; partyName: string }>;
  capabilities: { managementWritesEnabled: boolean } };

const money = (minor: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(minor / 100);
const entryLabel = (type: EntryType) => ({
  customer_charge: "Veresiye satış / alacak",
  customer_collection: "Tahsilat kaydı",
  supplier_debt: "Tedarikçi borç kaydı",
  supplier_payment: "Tedarikçi ödeme kaydı",
  adjustment_increase: "Bakiye artırma düzeltmesi",
  adjustment_decrease: "Bakiye azaltma düzeltmesi",
  legacy_manual: "Eski manuel bakiye hareketi",
})[type];
const sourceLabel = (source: string) => ({
  manual: "Elle girildi", integration: "Entegrasyon", sales: "Satış", purchase: "Satın alma",
  opening_balance: "Açılış bakiyesi", adjustment: "Düzeltme",
} as Record<string, string>)[source] ?? source;
const customerBalanceLabel = (balance: number) => balance > 0 ? `Alacak ${money(balance)}`
  : balance < 0 ? `Müşteri avansı ${money(Math.abs(balance))}` : "Alacak yok";
const supplierBalanceLabel = (balance: number) => balance > 0 ? `Borç ${money(balance)}`
  : balance < 0 ? `Tedarikçi avansı ${money(Math.abs(balance))}` : "Borç yok";
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
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [newKind, setNewKind] = useState<Kind | "both">(kind === "supplier" ? "supplier" : "customer");
  const [movementKind, setMovementKind] = useState<Kind>("customer");
  const [entryType, setEntryType] = useState<EntryType>("customer_charge");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIstanbul);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editTypes, setEditTypes] = useState<Kind[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [fromDate, setFromDate] = useState(() => `${todayIstanbul().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIstanbul);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [statementError, setStatementError] = useState("");
  const [statementLoading, setStatementLoading] = useState(false);
  const scope = ctx.scenarioId === "single" && ctx.branchApiId
    ? `/api/v1/firms/${encodeURIComponent(ctx.firmId)}/branches/${encodeURIComponent(ctx.branchApiId)}/caris`
    : null;

  const reload = useCallback(async () => {
    if (!scope) { setParties([]); setHasLoaded(false); setLoading(false); return; }
    setLoading(true);
    try {
      const [result, summaryResult] = await Promise.all([
        api<{ items: Party[] }>(scope), api<Summary>(`${scope}/summary`),
      ]);
      setParties(result.items);
      setSummary(summaryResult);
      setHasLoaded(true);
      setError("");
    } catch (reason) {
      setHasLoaded(false);
      setError((reason as Error).message);
    } finally { setLoading(false); }
  }, [scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setNewKind(kind === "supplier" ? "supplier" : "customer"); }, [kind]);
  useEffect(() => { setEntryType(movementKind === "customer" ? "customer_charge" : "supplier_debt"); }, [movementKind]);
  const visible = parties.filter((party) => (kind === "all" || party.types.includes(kind)) &&
    (showInactive || party.isActive) && party.name.toLocaleLowerCase("tr-TR").includes(query.toLocaleLowerCase("tr-TR")));
  const selected = visible.find((party) => party.id === selectedId) ?? visible[0];
  const title = kind === "customer" ? "Müşteriler" : kind === "supplier" ? "Tedarikçiler" : "Cari hesaplar";
  const managementWrites = summary?.capabilities.managementWritesEnabled ?? false;
  const writableSelectedTypes = managementWrites ? selected?.types ?? [] : [];
  const canCreateParty = managementWrites;
  const canEditParty = managementWrites;

  useEffect(() => {
    setEditing(false);
    setEditName(selected?.name ?? "");
    setEditPhone(selected?.phone ?? "");
    setEditEmail(selected?.email ?? "");
    setEditNote(selected?.note ?? "");
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
      const types = newKind === "both" ? ["customer", "supplier"] : [newKind];
      const party = await api<Party>(scope, "POST", { name: name.trim(), types, phone: phone.trim(), email: email.trim(), note: note.trim() });
      setName(""); setPhone(""); setEmail(""); setNote(""); setSelectedId(party.id);
      const hiddenByFilter = kind === "customer" && !party.types.includes("customer") ||
        kind === "supplier" && !party.types.includes("supplier");
      setNotice(hiddenByFilter
        ? "Cari kartı PostgreSQL'e kaydedildi. Seçili liste filtresinde görünmediği için Cari Hesaplar listesine geçerek bulabilirsiniz."
        : "Cari kartı PostgreSQL'e kaydedildi.");
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
        requestId: crypto.randomUUID(), kind: movementKind, entryType, amountMinor,
        description: description.trim(), effectiveDate, reference: reference.trim() || null, expectedVersion: selected.version,
      });
      setAmount(""); setDescription(""); setReference("");
      setNotice("Cari hareketi kaydedildi. Tahsilat/ödeme, banka veya POS'tan değil elle girilmiş bir işletme kaydıdır.");
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
        phone: editPhone.trim(), email: editEmail.trim(), note: editNote.trim(),
      });
      setEditing(false);
      if (!editActive) setShowInactive(true);
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
      description="Müşteri alacaklarını ve tedarikçi borçlarını tek şubede, izlenebilir hesap hareketleriyle takip edin."
      action={<StatusPill tone={!scope ? "orange" : loading ? "neutral" : hasLoaded ? "green" : "orange"}>
        {!scope ? "Bu senaryoda etkin değil" : loading ? "Yükleniyor" : hasLoaded ? "PostgreSQL · kalıcı kayıt" : "Kurulum gerekiyor"}
      </StatusPill>} />
    <DemoNotice>Başlangıç kayıtları kurgusal demo verisidir; yeni kayıtlar PostgreSQL'e yazılır. Tahsilat ve ödeme kayıtları işletme tarafından elle girilir; banka/POS işlemi, fatura veya yasal muhasebe kaydı oluşturmaz. X-Demo-Actor üretim kimlik doğrulaması değildir.</DemoNotice>
    {!scope && <div className="card generic-empty">Kalıcı cari görünümü yalnız Mahalle Fırını · Kadıköy Şubesi için açıldı.</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {scope && loading && <div className="card generic-empty" role="status">Cari kayıtları yükleniyor…</div>}
    {scope && !loading && hasLoaded && <>
      <div className="cari-summary-grid">
        <article className="card cari-kpi"><span>MÜŞTERİLERDEN ALACAK</span><strong>{money(summary?.customerReceivableMinor ?? 0)}</strong><small>{summary?.activeCustomers ?? 0} aktif hesap · müşteri avansı {money(summary?.customerCreditMinor ?? 0)}</small></article>
        <article className="card cari-kpi"><span>TEDARİKÇİLERE BORÇ</span><strong>{money(summary?.supplierPayableMinor ?? 0)}</strong><small>{summary?.activeSuppliers ?? 0} aktif hesap · tedarikçi avansı {money(summary?.supplierAdvanceMinor ?? 0)}</small></article>
        <article className="card cari-kpi"><span>HESAP KAPSAMI</span><strong>1 şube</strong><small>Bakiyeler hareketlerden hesaplanır</small></article>
      </div>
      {!!summary?.recentMovements.length && <section className="card cari-recent-card">
        <div><span className="card-kicker">SON HAREKETLER</span><h2>İşletme hesaplarında en son neler oldu?</h2></div>
        <div className="cari-recent-list">{summary.recentMovements.slice(0, 5).map((movement) => <div className="cari-recent-row" key={movement.id}>
          <div><strong>{movement.partyName}</strong><small>{entryLabel(movement.entryType)} · {movement.effectiveDate} · {movement.isDemo ? "Örnek demo" : sourceLabel(movement.source)}</small></div>
          <strong className={movement.deltaMinor >= 0 ? "cari-amount-positive" : "cari-amount-negative"}>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</strong>
        </div>)}</div>
      </section>}
      {!managementWrites && <div className="notice" role="status">Cari Hesap Yönetimi kapalı. Kartlar, hareketler, ekstreler ve bakiyeler okunabilir; manuel değişiklik için modülü <strong>Ayarlar → Modüller ve Özellikler</strong> bölümünden açın.</div>}
      <div className="cari-workspace">
        <section className="card content-card cari-list-card">
          <div className="card-heading padded"><div><span className="card-kicker">ŞUBE CARİLERİ</span><h2>{title}</h2></div><span className="cari-record-count">{visible.length} kayıt</span></div>
          <div className="cari-list-tools">
            <label className="cari-search">Cari ara<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ad veya unvan yazın" /></label>
            <label className="cari-check"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Pasifleri göster</label>
          </div>
          <div className="table-scroll"><table><thead><tr><th>CARİ</th><th>HAREKET</th><th>BAKİYE</th><th>DURUM</th></tr></thead>
            <tbody>{visible.map((party) => <tr key={party.id} className={selected?.id === party.id ? "cari-row-selected" : ""}>
              <td><button type="button" className="cari-party-select" onClick={() => { setSelectedId(party.id); setMovementKind(party.types[0]); }}><strong>{party.name}</strong><small>{party.types.map((type) => type === "customer" ? "Müşteri" : "Tedarikçi").join(" · ")}</small></button></td>
              <td>{party.movementCount}</td>
              <td>{party.types.includes("customer") && <span>{customerBalanceLabel(party.customerBalanceMinor)}<br /></span>}
                {party.types.includes("supplier") && <span>{supplierBalanceLabel(party.supplierBalanceMinor)}</span>}</td>
              <td><StatusPill tone={party.isActive ? "green" : "neutral"}>{party.isActive ? "Aktif" : "Pasif"}</StatusPill></td>
            </tr>)}</tbody>
          </table>{visible.length === 0 && <p className="cari-empty">Bu filtrede cari bulunamadı.</p>}</div>
        </section>
        <section className="card content-card padded cari-create-card">
          <span className="card-kicker">YENİ CARİ KARTI</span><h2>İşletme bağlantısı ekle</h2>
          <p className="card-note">Liste filtresi kart türünü kısıtlamaz. Aynı işletme hem müşteri hem tedarikçi olabilir.</p>
          <form className="cari-form" onSubmit={createParty}>
            <label>Ad / unvan <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={160} required /></label>
            <label>Hesap türü <select value={newKind} onChange={(event) => setNewKind(event.target.value as Kind | "both")}>
              <option value="customer">Müşteri</option><option value="supplier">Tedarikçi</option>
              <option value="both">Müşteri ve tedarikçi</option>
            </select></label>
            <label>Telefon <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={32} placeholder="İsteğe bağlı" /></label>
            <label>E-posta <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} placeholder="İsteğe bağlı" /></label>
            <label className="cari-wide-field">İç not <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} placeholder="Örn. haftalık toplu sipariş" /></label>
            <button className="primary-button" type="submit" disabled={busy || !canCreateParty}>Cari kartı kaydet</button>
          </form>
          {!canCreateParty && <small className="cari-disabled-hint">Manuel cari yönetimi kapalı; hesap türünden bağımsız olarak kart yazımı durduruldu.</small>}
        </section>
      </div>
      {selected && <section className="card content-card padded">
        <span className="card-kicker">CARİ HAREKETLERİ</span><h2>{selected.name}</h2>
        <p className="card-note">{selected.phone ?? "Telefon eklenmemiş"}{selected.email ? ` · ${selected.email}` : ""}</p>
        {selected.note && <p className="card-note">{selected.note}</p>}
        <button type="button" className="subtle-link" disabled={!canEditParty} onClick={() => setEditing((value) => !value)}>
          {editing ? "Düzenlemeyi kapat" : "Cari kartını düzenle"}
        </button>
        {!canEditParty && <p className="cari-disabled-hint">Cari Hesap Yönetimi kapalı; kart salt okunur.</p>}
        {editing && <form className="cari-form" onSubmit={updateParty}>
          <label>Unvan <input value={editName} onChange={(event) => setEditName(event.target.value)} minLength={2} maxLength={160} required /></label>
          <label>Telefon <input value={editPhone} onChange={(event) => setEditPhone(event.target.value)} maxLength={32} /></label>
          <label>E-posta <input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} maxLength={160} /></label>
          <label className="cari-wide-field">İç not <textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} maxLength={500} rows={2} /></label>
          <label className="cari-check"><input type="checkbox" checked={editTypes.includes("customer")} onChange={() => toggleEditType("customer")} /> Müşteri</label>
          <label className="cari-check"><input type="checkbox" checked={editTypes.includes("supplier")} onChange={() => toggleEditType("supplier")} /> Tedarikçi</label>
          <label className="cari-check"><input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} /> Aktif</label>
          <button className="primary-button" type="submit" disabled={busy}>Kart değişikliklerini kaydet</button>
        </form>}
        <div className="cari-balance-strip">
          {selected.types.includes("customer") && <div><small>MÜŞTERİ ALACAĞI</small><strong>{money(selected.customerBalanceMinor)}</strong></div>}
          {selected.types.includes("supplier") && <div><small>TEDARİKÇİ BORCU</small><strong>{money(selected.supplierBalanceMinor)}</strong></div>}
        </div>
        {selected.isActive && writableSelectedTypes.length > 0 && <form className="cari-form cari-entry-form" onSubmit={addMovement}>
          <label>Hesap türü <select value={movementKind} onChange={(event) => setMovementKind(event.target.value as Kind)}>
            {writableSelectedTypes.map((type) => <option key={type} value={type}>{type === "customer" ? "Müşteri hesabı" : "Tedarikçi hesabı"}</option>)}
          </select></label>
          <label>İşlem türü <select value={entryType} onChange={(event) => setEntryType(event.target.value as EntryType)}>
            {movementKind === "customer" ? <>
              <option value="customer_charge">Veresiye satış / alacak kaydı · artırır</option>
              <option value="customer_collection">Tahsilat kaydı · azaltır</option>
            </> : <>
              <option value="supplier_debt">Borç kaydı · artırır</option>
              <option value="supplier_payment">Ödeme kaydı · azaltır</option>
            </>}
            <option value="adjustment_increase">Bakiye artırma düzeltmesi</option>
            <option value="adjustment_decrease">Bakiye azaltma düzeltmesi</option>
          </select></label>
          <label>Tutar (₺) <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
          <label>İşlem tarihi <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required /></label>
          <label>Referans <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={80} placeholder="İsteğe bağlı belge / fiş no" /></label>
          <label>Açıklama <input value={description} onChange={(event) => setDescription(event.target.value)} minLength={3} maxLength={500} required placeholder="İşlemin nedenini yazın" /></label>
          <button className="primary-button" type="submit" disabled={busy}>Hareketi kaydet</button>
        </form>}
        {selected.isActive && writableSelectedTypes.length === 0 && <p className="cari-disabled-hint">Cari Hesap Yönetimi kapalı; kayıt ve ekstre salt okunur.</p>}
        {!selected.isActive && <p className="cari-disabled-hint">Pasif cari kartına yeni hareket eklenemez. Önce kartı yeniden etkinleştirin.</p>}
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
                <td>{movement.effectiveDate}</td>
                <td>{movement.kind === "customer" ? "Müşteri alacağı" : "Tedarikçi borcu"}</td>
                <td><strong>{entryLabel(movement.entryType)}</strong><br />{movement.description}{movement.reference && <small> · Ref: {movement.reference}</small>}</td><td>{movement.isDemo ? "Örnek demo" : sourceLabel(movement.source)}</td>
                <td>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</td>
              </tr>)}</tbody>
            </table></div> : <p>Bu tarihlerde hareket yok. Devir bakiyesi önceki hareketleri içerir.</p>}
          </>}
        </div>
        <h3>Tüm hareketler</h3>
        <div className="table-scroll"><table><thead><tr><th>TARİH</th><th>HESAP</th><th>AÇIKLAMA</th><th>KAYNAK</th><th>ETKİ</th></tr></thead>
          <tbody>{selected.movements.map((movement) => <tr key={movement.id}>
            <td>{movement.effectiveDate}</td>
            <td>{movement.kind === "customer" ? "Müşteri alacağı" : "Tedarikçi borcu"}</td>
            <td><strong>{entryLabel(movement.entryType)}</strong><br />{movement.description}{movement.reference && <small> · Ref: {movement.reference}</small>}</td><td>{movement.isDemo ? "Örnek demo" : sourceLabel(movement.source)}</td>
            <td>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </>}
  </>;
}
