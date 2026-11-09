import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Search, UserRound, UsersRound } from "lucide-react";
import { Link } from "react-router";
import type { ViewContext } from "../../app/context";
import { DemoNotice, PageHeading, StatusPill } from "../../shared/ui";

type Department = "management" | "kitchen" | "service" | "cashier" | "support";
type Employee = {
  id: string;
  name: string;
  department: Department;
  jobTitle: string;
  phone: string | null;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  role?: "owner" | "cashier" | "waiter" | "chef" | null;
  hasPin?: boolean;
  pin?: string | null;
};
type Draft = {
  name: string;
  department: Department;
  jobTitle: string;
  phone: string;
  isActive: boolean;
  pin: string;
};
const departments: Array<{ id: Department; title: string; note: string }> = [
  { id: "management", title: "Şube Yönetimi", note: "Şube müdürü ve yönetim kadrosu" },
  { id: "kitchen", title: "Şefler", note: "Mutfak sorumluluğu ve şef rolleri", chefs: true } as { id: Department; title: string; note: string; chefs: boolean },
  { id: "kitchen", title: "Mutfak Ekibi", note: "Hazırlık, sıcak/soğuk istasyon ve bulaşık", chefs: false } as { id: Department; title: string; note: string; chefs: boolean },
  { id: "service", title: "Servis Ekibi", note: "Garson, barista ve karşılama" },
  { id: "cashier", title: "Kasa Ekibi", note: "Kasiyer ve kasa sorumlusu" },
  { id: "support", title: "Destek Ekibi", note: "Temizlik, depo ve diğer destek görevleri" },
];
const blankDraft = (): Draft => ({
  name: "",
  department: "service",
  jobTitle: "Garson",
  phone: "",
  isActive: true,
  pin: "",
});

async function personnelApi<T>(path: string, actor: string, method: "GET" | "POST" | "PUT" = "GET", body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
      method, headers: { "X-Demo-Actor": actor, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error("Yerel personel API'sine bağlanılamadı. API'nin çalıştığını kontrol edin."); }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(problem.detail ?? `Personel isteği başarısız (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function isChef(employee: Employee) {
  return employee.department === "kitchen" && /şef|chef/i.test(employee.jobTitle);
}

export function ServicePersonnelPage({ ctx, source, canWrite }: { ctx: ViewContext; source: "http" | "mock"; canWrite: boolean }) {
  const [people, setPeople] = useState<Employee[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [query, setQuery] = useState("");
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
    setError("");
    if (source !== "http" || !scope) { setPeople([]); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await personnelApi<{ source: "postgres"; items: Employee[] }>(`${scope}/employees`, actor);
      if (serial === requestSerial.current) setPeople(result.items);
    } catch (reason) { if (serial === requestSerial.current) setError((reason as Error).message); }
    finally { if (serial === requestSerial.current) setLoading(false); }
  }, [scope, actor, source]);

  useEffect(() => { setEditing(null); setDraft(blankDraft()); void reload();
    return () => { requestSerial.current++; };
  }, [reload]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    return people.filter((person) => !needle || `${person.name} ${person.jobTitle} ${person.phone ?? ""}`.toLocaleLowerCase("tr-TR").includes(needle));
  }, [people, query]);

  function beginEdit(person: Employee) {
    setEditing(person);
    setDraft({
      name: person.name,
      department: person.department,
      jobTitle: person.jobTitle,
      phone: person.phone ?? "",
      isActive: person.isActive,
      pin: "",
    });
    setNotice(""); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!scope || busy || !canWrite) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = {
        name: draft.name.trim(),
        department: draft.department,
        jobTitle: draft.jobTitle.trim(),
        phone: draft.phone.trim() || null,
        pin: draft.pin.trim() || null,
        isActive: draft.isActive,
      };

      if (editing) {
        await personnelApi(`${scope}/employees/${encodeURIComponent(editing.id)}`, actor, "PUT", {
          expectedVersion: editing.version,
          ...payload,
        });
        setNotice(
          draft.pin.trim()
            ? `${draft.name.trim()} personel kartı ve yeni terminal PIN kodu başarıyla güncellendi.`
            : `${draft.name.trim()} personel kartı güncellendi.`
        );
      } else {
        await personnelApi(`${scope}/employees`, actor, "POST", {
          requestId: crypto.randomUUID(),
          ...payload,
        });
        setNotice(
          draft.pin.trim()
            ? `${draft.name.trim()} yeni personel ve 4 haneli PIN kodu başarıyla kaydedildi.`
            : `${draft.name.trim()} personel kartı kaydedildi.`
        );
      }
      setEditing(null); setDraft(blankDraft()); await reload();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <PageHeading eyebrow="MUTFAK VE SERVİS · EKİP" title="Personel"
      description="Ekibinizi bölüm ve görevlerine göre düzenleyin. Aradığınız çalışan bilgisine kolayca ulaşın."
      action={<StatusPill tone={source === "http" ? "green" : "purple"}>{source === "http" ? "Ekip kayıtları" : "Örnek gösterim"}</StatusPill>} />
    {source === "http" ? <DemoNotice>Personel kartlarını ve terminal erişim PIN kodlarını bu ekrandan yönetin. Yöneticiler buradan personelin 4 haneli PIN kodunu belirleyebilir veya sıfırlayabilir.</DemoNotice>
      : <div className="notice" role="status">Personel kayıtlarını yönetmek için servis bağlantısının kurulması gerekiyor.</div>}
    {!scope && <div className="card generic-empty">Personel işlemleri için önce bir şube seçin.</div>}
    {error && <div className="notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {scope && source === "http" && <div className="personnel-layout">
      <section className="card content-card padded personnel-form-card">
        <div className="service-waiters-heading"><div><span className="card-kicker">PERSONEL KARTI</span><h2>{editing ? "Kartı düzenle" : "Yeni çalışan"}</h2>
          <p>Bir çalışanı doğru bölüme kaydedin ve 4 haneli terminal PIN'ini belirleyin.</p></div></div>
        {!canWrite && <div className="notice" role="status">Personel kayıt modülü salt okunur. Yeni kayıt ve düzenleme için modülü etkinleştirin.</div>}
        <form className="personnel-form" onSubmit={(event) => void submit(event)}>
          <label>Ad soyad<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} minLength={2} maxLength={160} required disabled={!canWrite || busy} /></label>
          <label>Bölüm<select value={draft.department} onChange={(event) => {
            const department = event.target.value as Department;
            const title = department === "service" ? "Garson" : department === "kitchen" ? "Mutfak personeli" : department === "management" ? "Şube müdürü" : department === "cashier" ? "Kasiyer" : "Destek personeli";
            setDraft({ ...draft, department, jobTitle: title });
          }} disabled={!canWrite || busy}>
            <option value="management">Şube Yönetimi</option><option value="kitchen">Mutfak</option><option value="service">Servis</option><option value="cashier">Kasa</option><option value="support">Destek</option>
          </select></label>
          <label>Görev / unvan<input value={draft.jobTitle} onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })} minLength={2} maxLength={80} required disabled={!canWrite || busy} placeholder="Örn. Baş aşçı, Garson, Kasiyer" /></label>
          <label>Telefon <span className="personnel-optional">isteğe bağlı</span><input type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} maxLength={40} disabled={!canWrite || busy} placeholder="05xx xxx xx xx" /></label>
          
          <label>
            {editing && editing.hasPin ? "Terminal PIN Sıfırla (4 hane)" : "Terminal PIN Kodu (4 hane)"}
            <span className="personnel-optional">
              {editing && editing.pin
                ? `Mevcut PIN: ${editing.pin} · değiştirmeyecekseniz boş bırakın`
                : editing && editing.hasPin
                ? "boş bırakırsanız mevcut PIN korunur"
                : "POS / Garson kilit açma için"}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={draft.pin}
              onChange={(event) => setDraft({ ...draft, pin: event.target.value.replace(/\D/g, "") })}
              disabled={!canWrite || busy}
              placeholder={editing && editing.pin ? `Yeni PIN girin (mevcut: ${editing.pin})` : editing && editing.hasPin ? "Yeni PIN girin" : "Örn. 4444"}
              autoComplete="off"
            />
          </label>

          {editing && <label className="personnel-active-toggle"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} disabled={!canWrite || busy} />Aktif çalışan</label>}
          <div className="personnel-form-actions"><button className="primary-button" type="submit" disabled={!canWrite || busy}>{busy ? "Kaydediliyor…" : editing ? "Değişiklikleri kaydet" : "Personel kaydet"}</button>
            {editing && <button className="soft-button" type="button" onClick={() => { setEditing(null); setDraft(blankDraft()); setError(""); }}>Vazgeç</button>}</div>
        </form>
      </section>

      <section className="personnel-directory" aria-label="Bölümlere göre personel">
        <div className="personnel-directory-heading"><div><span className="card-kicker">ŞUBE EKİBİ</span><h2>{ctx.selectedBranch?.name} · {visible.length} kişi</h2></div>
          <label className="personnel-search"><Search size={16} /><input aria-label="Personel ara" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="İsim veya görev ara" /></label>
        </div>
        {loading && <div className="notice" role="status">Personel kayıtları yükleniyor…</div>}
        {!loading && query && visible.length === 0 && <div className="card generic-empty"><UsersRound size={21} />Aramanızla eşleşen personel yok.</div>}
        {departments.map((group, index) => {
          const groupPeople = visible.filter((person) => person.department === group.id &&
            (group.id !== "kitchen" || ("chefs" in group ? group.chefs ? isChef(person) : !isChef(person) : true)));
          if (query && groupPeople.length === 0) return null;
          return <section className={`card personnel-group personnel-group-${group.id} ${"chefs" in group && group.chefs ? "personnel-chef-group" : ""}`} key={`${group.id}-${index}`}>
            <header><div><span className="card-kicker">{String(groupPeople.length).padStart(2, "0")} KİŞİ</span><h3>{group.title}</h3><p>{group.note}</p></div><StatusPill tone="blue">{groupPeople.length}</StatusPill></header>
            {groupPeople.length ? <div className="personnel-grid">{groupPeople.map((person) => <article className={`personnel-card ${!person.isActive ? "inactive" : ""}`} key={person.id}>
              <div className="personnel-card-top">
                <span className={`personnel-avatar avatar-${person.department}`}><UserRound size={18} /></span>
                <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                  {person.pin ? (
                    <StatusPill tone="green">🔑 PIN: {person.pin}</StatusPill>
                  ) : person.hasPin ? (
                    <StatusPill tone="green">🔑 PIN Aktif</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">PIN Tanımsız</StatusPill>
                  )}
                  <StatusPill tone={person.isActive ? "blue" : "neutral"}>{person.isActive ? "Aktif" : "Pasif"}</StatusPill>
                </div>
              </div>
              <h4>{person.name}</h4>
              <strong>{person.jobTitle}</strong>
              {person.phone && <a href={`tel:${person.phone}`} className="personnel-phone">{person.phone}</a>}
              <button className="soft-button personnel-edit-button" type="button" onClick={() => beginEdit(person)} disabled={!canWrite}>
                {person.hasPin ? "Kartı & PIN'i Düzenle" : "PIN Tanımla & Düzenle"}
              </button>
            </article>)}</div> : <p className="personnel-group-empty">Bu bölümde henüz personel kartı yok.</p>}
          </section>;
        })}
        <Link to="/admin/branches/tables" className="subtle-link personnel-back-link"><ArrowLeft size={15} />Masa planına dön</Link>
      </section>
    </div>}
  </>;
}
