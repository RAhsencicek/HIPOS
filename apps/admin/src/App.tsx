import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  ChefHat,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Filter,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  MoreHorizontal,
  Network,
  NotebookTabs,
  Package,
  PlugZap,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  TrendingUp,
  Truck,
  UsersRound,
  Wallet,
  X,
} from "lucide-react";
import {
  checks,
  features,
  formatMoney,
  initialEnabled,
  products,
  scenarios,
  sections,
} from "./data/catalog";
import type {
  DemoBranch,
  DemoProduct,
  Feature,
  NavSection,
} from "./data/catalog";

const iconMap: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  store: Store,
  "book-open": BookOpen,
  "receipt-text": ReceiptText,
  "users-round": UsersRound,
  wallet: Wallet,
  landmark: Landmark,
  boxes: Boxes,
  "chef-hat": ChefHat,
  "chart-no-axes-combined": ChartNoAxesCombined,
  network: Network,
  "settings-2": Settings2,
  tag: Tag,
  "layout-grid": LayoutGrid,
  "notebook-tabs": NotebookTabs,
  truck: Truck,
  "heart-handshake": HeartHandshake,
  "plug-zap": PlugZap,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = iconMap[name] ?? Package;
  return <Component size={size} strokeWidth={1.9} aria-hidden="true" />;
}

type ViewContext = {
  scenarioId: string;
  setScenarioId: (id: string) => void;
  branchId: string;
  setBranchId: (id: string) => void;
  branches: DemoBranch[];
  selectedBranch: DemoBranch | null;
  firm: string;
  brand: string | null;
  isMulti: boolean;
  enabled: Record<string, string[]>;
  setEnabled: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
};

const allSections = sections.flatMap((section) => [
  { label: section.label, path: `/${section.id}`, group: "Ana alan" },
  ...section.items.map((item) => ({
    label: item.label,
    path: `/${section.id}/${item.slug}`,
    group: section.label,
  })),
]);

function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`demo-badge ${compact ? "compact" : ""}`}>
      <span className="demo-dot" /> Örnek veri
    </span>
  );
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "purple" | "green" | "orange" | "red" | "neutral" | "blue";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow ?? "YÖNETİM PANELİ"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  foot,
  tone = "purple",
  to,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  foot: string;
  tone?: "purple" | "green" | "orange" | "blue";
  to?: string;
}) {
  const inner = (
    <>
      <div className="metric-top">
        <span>{title}</span>
        <MoreHorizontal size={18} />
      </div>
      <div className="metric-main">
        <div className={`metric-icon ${tone}`}>{icon}</div>
        <strong>{value}</strong>
      </div>
      <div className="metric-foot">{foot}</div>
    </>
  );
  return to ? (
    <Link className="metric-card" to={to}>
      {inner}
    </Link>
  ) : (
    <div className="metric-card">{inner}</div>
  );
}

function DemoNotice({
  children = "Bu ekrandaki rakamlar tasarım senaryosu için hazırlanmış örnek verilerdir.",
}: {
  children?: React.ReactNode;
}) {
  return (
    <div className="notice">
      <Sparkles size={16} />
      <span>{children}</span>
    </div>
  );
}

function Shell({
  ctx,
  children,
}: {
  ctx: ViewContext;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sectionId = location.pathname.split("/")[1] || "overview";
  const [expanded, setExpanded] = useState(sectionId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchResults = allSections
    .filter((item) =>
      item.label
        .toLocaleLowerCase("tr-TR")
        .includes(globalSearch.toLocaleLowerCase("tr-TR")),
    )
    .slice(0, 7);

  useEffect(() => {
    setExpanded(sectionId);
    setSidebarOpen(false);
    setSearchOpen(false);
  }, [sectionId, location.pathname]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <LayoutGrid size={20} />
            </span>
            <span>
              hipos<span className="brand-dot">.</span>
            </span>
          </Link>
          <button
            className="icon-button sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Menüyü kapat"
          >
            <X size={20} />
          </button>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-caption">YÖNETİM ALANLARI</div>
          <nav aria-label="Ana menü">
            {sections.map((section) => (
              <div className="nav-group" key={section.id}>
                <button
                  className={`nav-parent ${sectionId === section.id ? "active-parent" : ""}`}
                  onClick={() => {
                    setExpanded(expanded === section.id ? "" : section.id);
                    navigate(`/${section.id}`);
                  }}
                  aria-expanded={expanded === section.id}
                >
                  <Icon name={section.icon} size={19} />
                  <span>{section.label}</span>
                  <ChevronDown
                    size={15}
                    className={expanded === section.id ? "rotated" : ""}
                  />
                </button>
                {expanded === section.id && (
                  <div className="nav-children">
                    {section.items.map((item) => (
                      <Link
                        key={item.slug}
                        to={`/${section.id}/${item.slug}`}
                        className={
                          location.pathname === `/${section.id}/${item.slug}`
                            ? "active"
                            : ""
                        }
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-bottom-icon">
            <Sparkles size={17} />
          </div>
          <div>
            <strong>Yönetim önizlemesi</strong>
            <small>İlk frontend · örnek senaryo</small>
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="mobile-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="Menüyü kapat"
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu size={21} />
          </button>
          <div className="topbar-context">
            <span className="topbar-context-label">AKTİF KAPSAM</span>
            <div className="context-line">
              <span className="context-firm">{ctx.firm}</span>
              <ChevronRight size={14} />
              <span>{ctx.selectedBranch?.name ?? "Tüm şubeler"}</span>
            </div>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="Panelde ara"
              placeholder="Panelde ara..."
              value={globalSearch}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setGlobalSearch(e.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearchOpen(false);
                if (e.key === "Enter" && searchResults[0])
                  navigate(searchResults[0].path);
              }}
            />
            <kbd>⌘ K</kbd>
            {searchOpen && globalSearch && (
              <div className="search-results">
                {searchResults.length ? (
                  searchResults.map((result) => (
                    <button
                      key={result.path}
                      onClick={() => {
                        navigate(result.path);
                        setGlobalSearch("");
                        setSearchOpen(false);
                      }}
                    >
                      <Search size={15} />
                      <span>
                        {result.label}
                        <small>{result.group}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))
                ) : (
                  <p>Bu adla bir ekran bulunamadı.</p>
                )}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <DemoBadge compact />
            <button
              className="icon-button topbar-icon"
              title="Bildirimler"
              aria-label="Bildirimler"
              onClick={() => navigate("/overview/alerts")}
            >
              <Bell size={19} />
              <i />
            </button>
            <button
              className="icon-button topbar-icon"
              title="Yardım"
              aria-label="Yardım"
              onClick={() => navigate("/settings/modules")}
            >
              <CircleHelp size={19} />
            </button>
            <div className="user-avatar">YA</div>
          </div>
        </header>
        <main className="page-content">
          <div className="scope-bar">
            <div className="scope-bar-left">
              <span className="scope-label">Görünüm</span>
              <select
                aria-label="İşletme senaryosu"
                value={ctx.scenarioId}
                onChange={(e) => ctx.setScenarioId(e.target.value)}
              >
                <option value="single">Tek şubeli işletme</option>
                <option value="multi">Çok şubeli işletme</option>
              </select>
              <span className="scope-separator" />
              {ctx.brand && (
                <>
                  <span className="scope-brand">{ctx.brand}</span>
                  <ChevronRight size={14} />
                </>
              )}
              <select
                aria-label="Şube seçimi"
                value={ctx.branchId}
                onChange={(e) => ctx.setBranchId(e.target.value)}
              >
                {ctx.isMulti && <option value="all">Tüm şubeler</option>}
                {ctx.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="scope-hint">
              <span className="live-dot" /> Önizleme ortamı
            </span>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function Dashboard({ ctx }: { ctx: ViewContext }) {
  const [period, setPeriod] = useState("Son 7 gün");
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  const visibleChecks = checks.filter(
    (check) =>
      check.scenarioId === ctx.scenarioId &&
      (!ctx.selectedBranch || check.branchId === ctx.selectedBranch.id),
  );
  const sales = branches.reduce((sum, branch) => sum + branch.sales, 0);
  const openChecks = branches.reduce(
    (sum, branch) => sum + branch.openChecks,
    0,
  );
  const occupied = branches.reduce((sum, branch) => sum + branch.occupied, 0);
  const tables = branches.reduce((sum, branch) => sum + branch.tables, 0);
  const kitchen = branches.reduce((sum, branch) => sum + branch.kitchen, 0);
  const chart =
    period === "Bugün"
      ? [24, 31, 22, 40, 51, 72, 65, 83, 69, 76, 88, 94]
      : period === "Son 30 gün"
        ? [46, 57, 38, 65, 55, 76, 61, 82, 70, 91, 76, 98]
        : [32, 48, 41, 69, 54, 78, 87];
  return (
    <>
      <PageHeading
        eyebrow="PAZARTESİ, 5 EKİM 2026"
        title="İşletmenize genel bakış"
        description={`${ctx.selectedBranch?.name ?? `${branches.length} şube`} için güncel yönetim görünümü.`}
        action={
          <div className="heading-tools">
            <DemoBadge />
            <button className="soft-button" onClick={() => window.print()}>
              <CalendarDays size={16} /> Görünümü yazdır
            </button>
          </div>
        }
      />
      <DemoNotice />
      <div className="metric-grid">
        <MetricCard
          title="GÜNLÜK SATIŞ"
          value={formatMoney(sales)}
          foot="Bugün · örnek veri"
          icon={<Wallet size={25} />}
          tone="green"
          to="/reports/sales"
        />
        <MetricCard
          title="AÇIK ADİSYONLAR"
          value={String(openChecks)}
          foot="Şu anda açık"
          icon={<ReceiptText size={25} />}
          tone="blue"
          to="/sales/open"
        />
        <MetricCard
          title="DOLU MASALAR"
          value={`${occupied} / ${tables}`}
          foot={`%${Math.round((occupied / tables) * 100)} doluluk`}
          icon={<LayoutGrid size={25} />}
          tone="purple"
          to="/branches/tables"
        />
        <MetricCard
          title="MUTFAKTA BEKLEYEN"
          value={String(kitchen)}
          foot="İzleme · salt okunur"
          icon={<ChefHat size={25} />}
          tone="orange"
          to="/kitchen/jobs"
        />
      </div>
      <div className="dashboard-grid">
        <section className="card performance-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">PERFORMANS</span>
              <h2>Satış görünümü</h2>
            </div>
            <select
              aria-label="Grafik dönemi"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option>Bugün</option>
              <option>Son 7 gün</option>
              <option>Son 30 gün</option>
            </select>
          </div>
          <div className="chart-summary">
            <strong>{formatMoney(sales)}</strong>
            <span className="chart-change">
              <TrendingUp size={14} /> +%12,8
            </span>
            <small>Seçili kapsam için örnek toplam</small>
          </div>
          <div
            className="bar-chart"
            aria-label={`${period} örnek satış grafiği`}
          >
            {chart.map((height, i) => (
              <div className="bar-slot" key={i}>
                <div
                  className={`bar ${i === chart.length - 1 ? "highlight" : ""}`}
                  style={{ height: `${height}%` }}
                />
                <span>
                  {period === "Bugün"
                    ? `${i + 9}:00`
                    : period === "Son 30 gün"
                      ? `${i * 3 + 1}`
                      : ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"][i]}
                </span>
              </div>
            ))}
          </div>
          <div className="chart-legend">
            <span>
              <i className="legend-dot purple" /> Satış tutarı
            </span>
            <Link to="/reports/sales">
              Raporu aç <ArrowRight size={14} />
            </Link>
          </div>
        </section>
        <section className="card live-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">CANLI İZLEME</span>
              <h2>Şube durumu</h2>
            </div>
            <Link className="text-link" to="/branches/list">
              Tümünü gör <ArrowRight size={15} />
            </Link>
          </div>
          <div className="branch-list">
            {branches.map((branch) => (
              <Link className="branch-row" to="/branches/list" key={branch.id}>
                <div className="branch-symbol">
                  <Store size={19} />
                </div>
                <div className="branch-name">
                  <strong>{branch.name}</strong>
                  <small>{branch.district}</small>
                </div>
                <div className="branch-stats">
                  <strong>
                    {branch.occupied}/{branch.tables}
                  </strong>
                  <small>dolu masa</small>
                </div>
                <StatusPill
                  tone={branch.health === "busy" ? "orange" : "green"}
                >
                  {branch.health === "busy" ? "Yoğun" : "Normal"}
                </StatusPill>
              </Link>
            ))}
          </div>
          <div className="live-footer">
            <Activity size={16} />
            <span>Durumlar tasarım senaryosundan gelir.</span>
          </div>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="card table-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">SALT OKUNUR</span>
              <h2>Son adisyonlar</h2>
            </div>
            <Link className="text-link" to="/sales/checks">
              Adisyonlara git <ArrowRight size={15} />
            </Link>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ADİSYON / MASA</th>
                  <th>KANAL</th>
                  <th>DURUM</th>
                  <th>TUTAR</th>
                  <th>ZAMAN</th>
                </tr>
              </thead>
              <tbody>
                {visibleChecks.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <strong>{check.id}</strong>
                      <small>
                        {check.table} · {check.items}
                      </small>
                    </td>
                    <td>{check.channel}</td>
                    <td>
                      <StatusPill
                        tone={
                          check.status === "Hazırlanıyor"
                            ? "orange"
                            : check.status === "Ödeme bekliyor"
                              ? "purple"
                              : "green"
                        }
                      >
                        {check.status}
                      </StatusPill>
                    </td>
                    <td className="numeric">{formatMoney(check.total)}</td>
                    <td className="muted">{check.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visibleChecks.length === 0 && (
              <div className="empty-list">
                <ReceiptText size={24} />
                <strong>Bu şubede örnek adisyon yok</strong>
              </div>
            )}
          </div>
        </section>
        <section className="card quick-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">KISA YOLLAR</span>
              <h2>Sık kullanılanlar</h2>
            </div>
          </div>
          <div className="quick-links">
            <Link to="/catalog/products">
              <span className="quick-icon purple">
                <BookOpen size={19} />
              </span>
              <span>
                <strong>Ürünler ve Menü</strong>
                <small>Ürünleri, fiyatları ve yayını incele</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/inventory/summary">
              <span className="quick-icon orange">
                <Boxes size={19} />
              </span>
              <span>
                <strong>Stok ve Satın Alma</strong>
                <small>Kritik stokları ve talepleri gör</small>
              </span>
              <ArrowRight size={16} />
            </Link>
            <Link to="/settings/modules">
              <span className="quick-icon blue">
                <Settings2 size={19} />
              </span>
              <span>
                <strong>Modüller ve Özellikler</strong>
                <small>Şube kapsamlı özellikleri yönet</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function ProductsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Tümü");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtered = products.filter(
    (product) =>
      (category === "Tümü" || product.category === category) &&
      `${product.name} ${product.sku}`
        .toLocaleLowerCase("tr-TR")
        .includes(query.toLocaleLowerCase("tr-TR")),
  );
  const categories = [
    "Tümü",
    ...new Set(products.map((product) => product.category)),
  ];
  return (
    <>
      <PageHeading
        eyebrow="ÜRÜNLER VE MENÜ"
        title="Ürünler"
        description="Menünüzdeki ürünleri, fiyatları ve kanal görünürlüğünü tek yerden inceleyin."
        action={
          <button
            className="primary-button"
            onClick={() =>
              document
                .getElementById("prototype-product-notice")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <Plus size={17} /> Ürün ekleme akışı
          </button>
        }
      />
      <DemoNotice>
        Ürünler örnek veridir. Ürün ekleme ve kaydetme akışı henüz gerçek kayıt
        oluşturmaz.
      </DemoNotice>
      <div className="card content-card">
        <div className="tabs">
          <button className={category === "Tümü" ? "selected" : ""} onClick={() => setCategory("Tümü")}>
            Tüm ürünler <span>{products.length}</span>
          </button>
          <button className={category === "Pizzalar" ? "selected" : ""} onClick={() => setCategory("Pizzalar")}>Pizzalar</button>
          <button className={category === "Kahvaltı" ? "selected" : ""} onClick={() => setCategory("Kahvaltı")}>Kahvaltı</button>
        </div>
        <div className="table-toolbar">
          <button
            className={`soft-button ${filtersOpen ? "selected-filter" : ""}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Filter size={16} /> Filtreler <ChevronDown size={15} />
          </button>
          <div className="table-search">
            <Search size={17} />
            <input
              aria-label="Ürün ara"
              placeholder="Ürün adı veya stok koduyla ara..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="icon-button settings-button"
            aria-label="Liste ayarları"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
        {filtersOpen && (
          <div className="filter-panel">
            <span>Kategori</span>
            <select
              aria-label="Kategori filtresi"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              className="link-button"
              onClick={() => {
                setCategory("Tümü");
                setQuery("");
              }}
            >
              Filtreleri temizle
            </button>
          </div>
        )}
        <div className="table-scroll">
          <table className="products-table">
            <thead>
              <tr>
                <th>ÜRÜN</th>
                <th>KATEGORİ</th>
                <th>KANALLAR</th>
                <th>REÇETE</th>
                <th>DURUM</th>
                <th>FİYAT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="product-cell">
                      <div className="food-thumb">{product.image}</div>
                      <div>
                        <Link
                          to={`/catalog/products/${product.id}`}
                          className="product-link"
                        >
                          {product.name}
                        </Link>
                        <small>Stok kodu: {product.sku}</small>
                      </div>
                    </div>
                  </td>
                  <td>{product.category}</td>
                  <td>
                    <div className="channel-list">
                      {product.channels.map((channel) => (
                        <span key={channel}>{channel}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {product.recipe ? (
                      <StatusPill tone="green">Bağlı</StatusPill>
                    ) : (
                      <StatusPill>Eksik</StatusPill>
                    )}
                  </td>
                  <td>
                    <StatusPill
                      tone={product.status === "Yayında" ? "green" : "orange"}
                    >
                      {product.status}
                    </StatusPill>
                  </td>
                  <td className="numeric strong">
                    {formatMoney(product.price)}
                  </td>
                  <td>
                    <Link
                      aria-label={`${product.name} ayrıntısı`}
                      to={`/catalog/products/${product.id}`}
                      className="row-arrow"
                    >
                      <ArrowRight size={17} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="empty-list">
              <Search size={25} />
              <strong>Sonuç bulunamadı</strong>
              <span>Arama veya filtreleri değiştirmeyi deneyin.</span>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>{filtered.length} ürün gösteriliyor</span>
          <span>Örnek menü · sayfa 1 / 1</span>
        </div>
      </div>
      <div id="prototype-product-notice" className="prototype-box">
        <div className="prototype-icon">
          <Sparkles size={20} />
        </div>
        <div>
          <strong>Ürün ekleme akışı tasarlanıyor</strong>
          <p>
            Bu aşamada yeni ürün kaydı oluşturulmaz. Gelecek form; kategori,
            seçenek grubu, alerjen, fiyat, reçete ve kanal görünürlüğünü
            kapsayacak.
          </p>
        </div>
        <StatusPill tone="purple">Prototip</StatusPill>
      </div>
    </>
  );
}

function ProductDetail({ product }: { product: DemoProduct }) {
  return (
    <>
      <Link to="/catalog/products" className="back-link">
        <ArrowLeft size={16} /> Ürünler
      </Link>
      <PageHeading
        eyebrow="ÜRÜN AYRINTISI · ÖRNEK VERİ"
        title={product.name}
        description={`Stok kodu: ${product.sku} · ${product.category}`}
        action={<StatusPill tone="purple">Önizleme</StatusPill>}
      />
      <div className="detail-grid">
        <div className="detail-main">
          <section className="card detail-card">
            <div className="detail-card-head">
              <div className="detail-hero-icon">{product.image}</div>
              <div>
                <span className="card-kicker">TEMEL BİLGİLER</span>
                <h2>{product.name}</h2>
                <p>
                  Menü ürününün yönetim görünümü. Alanlar örnek veriden gelir.
                </p>
              </div>
            </div>
            <div className="info-grid">
              <div>
                <span>Kategori</span>
                <strong>{product.category}</strong>
              </div>
              <div>
                <span>Fiyat</span>
                <strong>{formatMoney(product.price)}</strong>
              </div>
              <div>
                <span>Stok kodu</span>
                <strong>{product.sku}</strong>
              </div>
              <div>
                <span>Alerjenler</span>
                <strong>
                  {product.category === "Pizzalar"
                    ? "Gluten, süt"
                    : "Tanımlanacak"}
                </strong>
              </div>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">GÖRÜNÜRLÜK</span>
            <h2>Kanallar ve şubeler</h2>
            <div className="detail-row">
              <span>Satış kanalları</span>
              <div className="channel-list">
                {product.channels.map((channel) => (
                  <span key={channel}>{channel}</span>
                ))}
              </div>
            </div>
            <div className="detail-row">
              <span>Şube kapsamı</span>
              <strong>Seçili işletme senaryosu</strong>
            </div>
          </section>
          <section className="card detail-card">
            <span className="card-kicker">İLİŞKİLER</span>
            <h2>Reçete ve seçenekler</h2>
            <div className="detail-row">
              <span>Reçete</span>
              <StatusPill tone={product.recipe ? "green" : "orange"}>
                {product.recipe ? "Bağlı · örnek" : "Kurulum gerekiyor"}
              </StatusPill>
            </div>
            <div className="detail-row">
              <span>Seçenek grupları</span>
              <strong>Bu senaryoda tanımlanmadı</strong>
            </div>
          </section>
        </div>
        <aside className="detail-aside">
          <section className="card aside-card">
            <span className="card-kicker">YAYIN DURUMU</span>
            <h3>{product.status}</h3>
            <p>Gerçek yayın işlemi henüz bağlı değil.</p>
            <StatusPill
              tone={product.status === "Yayında" ? "green" : "orange"}
            >
              {product.status} · örnek
            </StatusPill>
          </section>
          <section className="card aside-card">
            <span className="card-kicker">BU EKRANDA</span>
            <div className="aside-check">
              <Check size={16} /> Ürün ve fiyat görünümü
            </div>
            <div className="aside-check">
              <Check size={16} /> Kanal kapsamı
            </div>
            <div className="aside-check">
              <Check size={16} /> Reçete bağlantısı
            </div>
            <div className="aside-check muted">
              <Clock3 size={16} /> Gerçek kaydetme planlandı
            </div>
          </section>
          <section className="card aside-card muted-aside">
            <ShieldCheck size={21} />
            <p>
              Bu sayfa yalnızca tasarım önizlemesidir. Değişiklikler
              veritabanına kaydedilmez.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}

function BranchesPage({ ctx }: { ctx: ViewContext }) {
  const selected = ctx.selectedBranch;
  return (
    <>
      <PageHeading
        eyebrow="ŞUBELER VE CANLI DURUM"
        title="Şube durumu"
        description="Şube, masa ve mutfak durumlarını yönetsel kapsamda izleyin."
        action={<StatusPill tone="blue">Salt okunur</StatusPill>}
      />
      <DemoNotice />
      <div className="branch-overview-grid">
        {ctx.branches.map((branch) => (
          <button
            key={branch.id}
            className={`card branch-overview ${selected?.id === branch.id ? "chosen" : ""}`}
            onClick={() => ctx.setBranchId(branch.id)}
          >
            <div className="branch-overview-head">
              <span className="branch-symbol">
                <Store size={20} />
              </span>
              <StatusPill tone={branch.health === "busy" ? "orange" : "green"}>
                {branch.health === "busy" ? "Yoğun" : "Normal"}
              </StatusPill>
            </div>
            <strong>{branch.name}</strong>
            <small>{branch.district}</small>
            <div className="branch-overview-data">
              <span>
                <b>
                  {branch.occupied}/{branch.tables}
                </b>{" "}
                masa
              </span>
              <span>
                <b>{branch.openChecks}</b> açık adisyon
              </span>
            </div>
          </button>
        ))}
      </div>
      {!selected ? <div className="card select-branch-card"><Store size={25} /><strong>Masa planını görmek için bir şube seçin</strong><span>Yukarıdaki şube kartlarından birini seçebilirsiniz.</span></div> : <div className="branch-detail-grid">
        <section className="card table-plan-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">SALT OKUNUR MASA PLANI</span>
              <h2>{selected.name}</h2>
            </div>
            <div className="table-legend">
              <span>
                <i className="legend-dot purple" /> Dolu
              </span>
              <span>
                <i className="legend-dot pale" /> Boş
              </span>
            </div>
          </div>
          <div className="table-plan">
            {Array.from({ length: Math.min(selected.tables, 24) }, (_, i) => (
              <div
                key={i}
                className={`restaurant-table ${i < selected.occupied ? "occupied" : ""}`}
              >
                <LayoutGrid size={15} />
                <span>{String(i + 1).padStart(2, "0")}</span>
              </div>
            ))}
          </div>
          <p className="card-note">
            Masa taşıma ve servis işlemleri yönetim panelinde yapılmaz.
          </p>
        </section>
        <section className="card branch-side-card">
          <span className="card-kicker">ANLIK ÖZET</span>
          <h2>Operasyon görünümü</h2>
          <div className="side-stat">
            <span>Açık adisyon</span>
            <strong>{selected.openChecks}</strong>
          </div>
          <div className="side-stat">
            <span>Mutfakta bekleyen</span>
            <strong>{selected.kitchen}</strong>
          </div>
          <div className="side-stat">
            <span>Masa doluluğu</span>
            <strong>
              %{Math.round((selected.occupied / selected.tables) * 100)}
            </strong>
          </div>
          <div className="side-stat">
            <span>Günlük satış</span>
            <strong>{formatMoney(selected.sales)}</strong>
          </div>
          <Link to="/sales/open" className="subtle-link">
            Açık adisyonları incele <ArrowRight size={15} />
          </Link>
        </section>
      </div>}
    </>
  );
}

function SalesPage({ ctx }: { ctx: ViewContext }) {
  const [status, setStatus] = useState("Tümü");
  const scoped = checks.filter(
    (check) =>
      check.scenarioId === ctx.scenarioId &&
      (!ctx.selectedBranch || check.branchId === ctx.selectedBranch.id),
  );
  const visible =
    status === "Tümü"
      ? scoped
      : scoped.filter((check) => check.status === status);
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  return (
    <>
      <PageHeading
        eyebrow="SATIŞLAR VE ADİSYONLAR"
        title="Adisyon görünümü"
        description="Siparişleri, kanalları ve durumları inceleyin. Bu alan operasyon eylemi içermez."
        action={<StatusPill tone="blue">Salt okunur</StatusPill>}
      />
      <DemoNotice />
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<ReceiptText size={23} />}
          title="AÇIK ADİSYON"
          value={String(branches.reduce((sum, branch) => sum + branch.openChecks, 0))}
          foot="Örnek senaryo"
          tone="blue"
        />
        <MetricCard
          icon={<ChefHat size={23} />}
          title="HAZIRLANIYOR"
          value={String(branches.reduce((sum, branch) => sum + branch.kitchen, 0))}
          foot="Mutfak izleme"
          tone="orange"
        />
        <MetricCard
          icon={<CreditCard size={23} />}
          title="ÖDEME BEKLEYEN"
          value={String(scoped.filter((check) => check.status === "Ödeme bekliyor").length)}
          foot="Tahsilat yapılmaz"
          tone="purple"
        />
        <MetricCard
          icon={<TrendingUp size={23} />}
          title="GÜNLÜK SATIŞ"
          value={formatMoney(branches.reduce((sum, branch) => sum + branch.sales, 0))}
          foot="Örnek rapor verisi"
          tone="green"
        />
      </div>
      <div className="card content-card">
        <div className="card-heading padded">
          <div>
            <span className="card-kicker">SALT OKUNUR</span>
            <h2>Son adisyonlar</h2>
          </div>
          <select
            aria-label="Adisyon durum filtresi"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              "Tümü",
              "Hazırlanıyor",
              "Serviste",
              "Hazır",
              "Ödeme bekliyor",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ADİSYON</th>
                <th>MASA / KANAL</th>
                <th>İÇERİK</th>
                <th>DURUM</th>
                <th>TOPLAM</th>
                <th>AÇILIŞ</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((check) => (
                <tr key={check.id}>
                  <td>
                    <strong>{check.id}</strong>
                  </td>
                  <td>
                    {check.table}
                    <small>{check.channel}</small>
                  </td>
                  <td>{check.items}</td>
                  <td>
                    <StatusPill
                      tone={
                        check.status === "Hazırlanıyor"
                          ? "orange"
                          : check.status === "Ödeme bekliyor"
                            ? "purple"
                            : "green"
                      }
                    >
                      {check.status}
                    </StatusPill>
                  </td>
                  <td className="numeric strong">{formatMoney(check.total)}</td>
                  <td className="muted">{check.age}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          {visible.length} adisyon · örnek veri
        </div>
      </div>
    </>
  );
}

function InventoryPage() {
  const stock = [
    {
      name: "Mozzarella",
      amount: "4,2 kg",
      threshold: "5 kg",
      status: "Kritik",
    },
    {
      name: "Pizza unu",
      amount: "12 kg",
      threshold: "8 kg",
      status: "Yeterli",
    },
    {
      name: "Domates sosu",
      amount: "3,5 kg",
      threshold: "4 kg",
      status: "Kritik",
    },
    { name: "Zeytin", amount: "6 kg", threshold: "3 kg", status: "Yeterli" },
  ];
  return (
    <>
      <PageHeading
        eyebrow="STOK VE SATIN ALMA"
        title="Stok özeti"
        description="Hammadde, reçete ve satın alma görünümünün başlangıç noktası."
        action={<StatusPill tone="purple">Prototip akışı</StatusPill>}
      />
      <DemoNotice>
        Stok miktarları örnektir. Satın alma, sayım ve mal kabul işlemleri henüz
        gerçek kayıt oluşturmaz.
      </DemoNotice>
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<Boxes size={23} />}
          title="STOK KALEMİ"
          value="48"
          foot="3 depoda örnek veri"
          tone="blue"
        />
        <MetricCard
          icon={<Activity size={23} />}
          title="KRİTİK STOK"
          value="2"
          foot="Eşik altındaki kalemler"
          tone="orange"
        />
        <MetricCard
          icon={<Truck size={23} />}
          title="BEKLEYEN TALEP"
          value="4"
          foot="Akış tasarımı"
          tone="purple"
        />
        <MetricCard
          icon={<Wallet size={23} />}
          title="STOK DEĞERİ"
          value={formatMoney(184650)}
          foot="Örnek hesaplama"
          tone="green"
        />
      </div>
      <div className="dashboard-grid">
        <section className="card table-card">
          <div className="card-heading">
            <div>
              <span className="card-kicker">HAMMADDE</span>
              <h2>Stok durumu</h2>
            </div>
            <Link className="text-link" to="/inventory/ingredients">
              Tümünü gör <ArrowRight size={15} />
            </Link>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>HAMMADDE</th>
                  <th>MEVCUT</th>
                  <th>KRİTİK EŞİK</th>
                  <th>DURUM</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((item) => (
                  <tr key={item.name}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{item.amount}</td>
                    <td>{item.threshold}</td>
                    <td>
                      <StatusPill
                        tone={item.status === "Kritik" ? "orange" : "green"}
                      >
                        {item.status}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card process-card">
          <span className="card-kicker">YÖNETSEL AKIŞ</span>
          <h2>Satın alma yolu</h2>
          <p>İhtiyaçtan maliyet güncellemesine kadar izlenecek süreç.</p>
          {[
            "Talep oluştur",
            "Onaya gönder",
            "Sipariş hazırla",
            "Mal kabul",
            "Fatura bağla",
          ].map((step, i) => (
            <div className="process-step" key={step}>
              <span>{i + 1}</span>
              <strong>{step}</strong>
              <StatusPill tone="purple">Prototip</StatusPill>
            </div>
          ))}
          <Link className="subtle-link" to="/inventory/requests">
            Akış kapsamını gör <ArrowRight size={15} />
          </Link>
        </section>
      </div>
    </>
  );
}

function ReportsPage({ ctx }: { ctx: ViewContext }) {
  const branches = ctx.selectedBranch ? [ctx.selectedBranch] : ctx.branches;
  return (
    <>
      <PageHeading
        eyebrow="RAPORLAR"
        title="İşletme raporları"
        description="Satış, ürün, kanal ve şube performansını seçili kapsamda inceleyin."
        action={<StatusPill tone="purple">Örnek projeksiyon</StatusPill>}
      />
      <DemoNotice>
        Bu raporlar örnek veriden üretilir; gerçek ödeme veya satış raporu
        olarak kullanılmamalıdır.
      </DemoNotice>
      <div className="metric-grid compact-grid">
        <MetricCard
          icon={<Wallet size={23} />}
          title="TOPLAM SATIŞ"
          value={formatMoney(branches.reduce((n, b) => n + b.sales, 0))}
          foot="Örnek günlük toplam"
          tone="green"
        />
        <MetricCard
          icon={<ReceiptText size={23} />}
          title="ADİSYON"
          value={String(branches.reduce((n, b) => n + b.openChecks, 0))}
          foot="Açık adisyonlar"
          tone="blue"
        />
        <MetricCard
          icon={<Store size={23} />}
          title="ŞUBE"
          value={String(branches.length)}
          foot="Senaryo kapsamı"
          tone="purple"
        />
        <MetricCard
          icon={<TrendingUp size={23} />}
          title="ORTALAMA"
          value={formatMoney(386)}
          foot="Örnek sepet tutarı"
          tone="orange"
        />
      </div>
      <div className="card report-card">
        <div className="card-heading">
          <div>
            <span className="card-kicker">ŞUBE KARŞILAŞTIRMA</span>
            <h2>Günlük satış dağılımı</h2>
          </div>
          <StatusPill tone="blue">{ctx.selectedBranch ? "Seçili şube" : "Seçili firma"}</StatusPill>
        </div>
        {branches.map((branch) => (
          <div className="report-row" key={branch.id}>
            <strong>{branch.name}</strong>
            <div className="report-track">
              <span style={{ width: `${(branch.sales / 70000) * 100}%` }} />
            </div>
            <b>{formatMoney(branch.sales)}</b>
          </div>
        ))}
        <p className="card-note">
          Ödeme ve satış toplamlarının ortak hesap kuralı gerçek backend
          aşamasında tanımlanacak.
        </p>
      </div>
      <div className="report-links">
        {sections
          .find((s) => s.id === "reports")
          ?.items.slice(0, 8)
          .map((item) => (
            <Link key={item.slug} to={`/reports/${item.slug}`}>
              <ChartNoAxesCombined size={19} />
              <span>{item.label}</span>
              <ArrowRight size={16} />
            </Link>
          ))}
      </div>
    </>
  );
}

function ModulesPage({ ctx }: { ctx: ViewContext }) {
  const [category, setCategory] = useState("Tümü");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Feature | null>(null);
  const [notice, setNotice] = useState("");
  const categories = [
    "Tümü",
    ...new Set(features.map((feature) => feature.category)),
  ];
  const currentBranch = ctx.selectedBranch;
  const branchFeatures = currentBranch ? ctx.enabled[currentBranch.id] ?? initialEnabled : [];
  const filtered = features.filter(
    (feature) =>
      (category === "Tümü" || feature.category === category) &&
      `${feature.name} ${feature.description}`
        .toLocaleLowerCase("tr-TR")
        .includes(query.toLocaleLowerCase("tr-TR")),
  );
  const dependents = selected
    ? features.filter(
        (feature) =>
          branchFeatures.includes(feature.key) &&
          feature.dependencies.includes(selected.key),
      )
    : [];
  const missing = selected
    ? selected.dependencies
        .filter((key) => !branchFeatures.includes(key))
        .map(
          (key) => features.find((feature) => feature.key === key)?.name ?? key,
        )
    : [];
  const isEnabled = selected ? branchFeatures.includes(selected.key) : false;
  function toggleFeature() {
    if (!selected || !currentBranch) return;
    if (isEnabled && dependents.length) return;
    if (!isEnabled && missing.length) return;
    ctx.setEnabled((previous) => ({
      ...previous,
      [currentBranch.id]: isEnabled
        ? branchFeatures.filter((key) => key !== selected.key)
        : [...branchFeatures, selected.key],
    }));
    setNotice(
      `${selected.name} bu tarayıcıdaki önizlemede ${isEnabled ? "kapatıldı" : "açıldı"}. Gerçek işletme ayarı değişmedi.`,
    );
    setSelected(null);
  }
  return (
    <>
      <PageHeading
        eyebrow="AYARLAR"
        title="Modüller ve Özellikler"
        description="İhtiyacınız olan yönetim yeteneklerini şube bazında keşfedin ve önizleyin."
        action={
          <div className="module-count">
            <span>{features.length} özellik</span>
            <StatusPill tone="purple">Katalog</StatusPill>
          </div>
        }
      />
      <DemoNotice>
        Bu katalog tasarım önizlemesidir. Açma/kapama seçimleri yalnız bu
        oturumdaki görünümü etkiler; veritabanına kayıt yapılmaz.
      </DemoNotice>
      {!currentBranch && <div className="notice branch-pick-notice"><Store size={16} /><span>Modül ayarını değiştirmek için bir şube seçin.</span><select aria-label="Modül için şube seç" value="" onChange={e => ctx.setBranchId(e.target.value)}><option value="" disabled>Şube seçin</option>{ctx.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>}
      {notice && (
        <div className="inline-message">
          <Check size={17} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="Bildirimi kapat">
            <X size={15} />
          </button>
        </div>
      )}
      <div className="card module-toolbar">
        <div className="table-search">
          <Search size={17} />
          <input
            aria-label="Modül ara"
            placeholder="Modül veya özellik ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="category-scroll">
          {categories.map((c) => (
            <button
              className={category === c ? "chosen" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="modules-grid">
        {filtered.map((feature) => {
          const active = branchFeatures.includes(feature.key);
          return (
            <article className="card module-card" key={feature.key}>
              <div className="module-card-top">
                <div className="feature-icon">
                  <Icon name={feature.icon} size={21} />
                </div>
                <StatusPill
                  tone={
                    feature.availability === "Prototip" ? "purple" : "neutral"
                  }
                >
                  {feature.availability}
                </StatusPill>
              </div>
              <div className="module-category">{feature.category}</div>
              <h2>{feature.name}</h2>
              <p>{feature.description}</p>
              <div className="module-card-bottom">
                <div>
                  <span className={`small-state ${active && !feature.setup && feature.availability === "Prototip" ? "on" : ""}`}>
                    <i />
                    {!currentBranch ? "Şube seçin" : active ? feature.availability === "Planlandı" ? "Açık · planlandı" : feature.setup ? "Açık · kurulum gerekiyor" : "Önizlemede açık" : "Kapalı"}
                  </span>
                  <small>
                    {feature.setup
                      ? "Kurulum gerekiyor"
                      : feature.dependencies.length
                        ? `${feature.dependencies.length} bağımlılık`
                        : "Bağımsız özellik"}
                  </small>
                </div>
                <button
                  className={`toggle ${active ? "on" : ""}`}
                  role="switch"
                  aria-checked={active}
                  aria-label={`${feature.name} ${active ? "kapat" : "aç"}`}
                  disabled={!currentBranch}
                  onClick={() => setSelected(feature)}
                >
                  <span />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="empty-list card">
          <Search size={25} />
          <strong>Modül bulunamadı</strong>
          <span>Aramanızı veya kategoriyi değiştirin.</span>
        </div>
      )}
      {selected && currentBranch && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="module-dialog-title"
          >
            <div className="modal-top">
              <span className="feature-icon">
                <Icon name={selected.icon} size={23} />
              </span>
              <button
                className="icon-button"
                aria-label="Kapat"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </button>
            </div>
            <span className="card-kicker">
              {currentBranch.name.toLocaleUpperCase("tr-TR")} · ÖNİZLEME
            </span>
            <h2 id="module-dialog-title">
              {selected.name} {isEnabled ? "kapatılsın mı?" : "açılsın mı?"}
            </h2>
            <p>{selected.description}</p>
            <div className="activation-plan">
              <strong>Aktivasyon planı</strong>
              <div>
                <Check size={16} /> Kapsam: yalnız {currentBranch.name}
              </div>
              <div>
                <Check size={16} /> Diğer şubeler etkilenmez
              </div>
              {selected.dependencies.map((key) => (
                <div key={key}>
                  <span
                    className={
                      branchFeatures.includes(key) ? "plan-check" : "plan-warn"
                    }
                  >
                    {branchFeatures.includes(key) ? (
                      <Check size={16} />
                    ) : (
                      <Clock3 size={16} />
                    )}
                  </span>{" "}
                  {features.find((f) => f.key === key)?.name ?? key} bağımlılığı
                </div>
              ))}
              {selected.setup && (
                <div>
                  <Clock3 size={16} className="warn-icon" /> {selected.setup}
                </div>
              )}
              {selected.availability === "Planlandı" && (
                <div>
                  <Clock3 size={16} className="warn-icon" /> Gerçek işlem henüz
                  plan aşamasında
                </div>
              )}
              {isEnabled &&
                dependents.map((feature) => (
                  <div key={feature.key}>
                    <Clock3 size={16} className="warn-icon" /> {feature.name} bu
                    modüle bağlı ve açık
                  </div>
                ))}
            </div>
            <div className="modal-note">
              Gerçek kayıt oluşturulmaz. Modül kapatıldığında gelecekte yeni
              işler duracak, devam eden işler güvenle tamamlanacak ve geçmiş
              okunabilir kalacaktır.
            </div>
            <div className="modal-actions">
              <button className="soft-button" onClick={() => setSelected(null)}>
                Vazgeç
              </button>
              <button
                className="primary-button"
                disabled={
                  (!isEnabled && missing.length > 0) ||
                  (isEnabled && dependents.length > 0)
                }
                onClick={toggleFeature}
              >
                Önizlemede {isEnabled ? "kapat" : "aç"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function IntegrationsPage() {
  const groups = [
    {
      title: "Yemek platformları",
      names: ["Yemeksepeti", "GetirYemek", "Trendyol Yemek", "Migros Yemek"],
    },
    {
      title: "Ödeme ve mali",
      names: [
        "Banka / ödeme",
        "Sanal POS",
        "Yemek kartları",
        "ÖKC",
        "E-Fatura / E-Arşiv",
      ],
    },
    {
      title: "Cihaz ve operasyon",
      names: ["Yazıcı", "Terazi", "Caller ID", "Menuboard", "Muhasebe / ERP"],
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="AYARLAR"
        title="Entegrasyonlar"
        description="Harici sağlayıcı ve cihaz bağlantılarının planlanan kapsamı."
        action={<StatusPill tone="orange">Bağlantı kurulmadı</StatusPill>}
      />
      <DemoNotice>
        Bu aşamada hiçbir dış sağlayıcıya gerçek bağlantı kurulmamıştır.
      </DemoNotice>
      {groups.map((group) => (
        <section className="integration-section" key={group.title}>
          <h2>{group.title}</h2>
          <div className="integration-grid">
            {group.names.map((name) => (
              <article className="card integration-card" key={name}>
                <div className="integration-symbol">
                  <PlugZap size={20} />
                </div>
                <div>
                  <strong>{name}</strong>
                  <small>Gerçek sağlayıcı bağlantısı bekleniyor</small>
                </div>
                <StatusPill tone="orange">Sağlayıcı bekleniyor</StatusPill>
              </article>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function GenericPage({
  section,
  slug,
}: {
  section: NavSection;
  slug?: string;
}) {
  const item = section.items.find((entry) => entry.slug === slug);
  const title = item?.label ?? section.label;
  const readOnly = ["sales", "kitchen", "branches", "cash"].includes(
    section.id,
  );
  const planned = ["cash", "finance", "customers", "central"].includes(
    section.id,
  );
  return (
    <>
      <PageHeading
        eyebrow={section.label.toLocaleUpperCase("tr-TR")}
        title={title}
        description={`${section.label} alanındaki yönetim işleri ve bağlı ekranlar.`}
        action={
          <StatusPill tone={readOnly ? "blue" : planned ? "neutral" : "purple"}>
            {readOnly ? "Salt okunur" : planned ? "Planlandı" : "Prototip"}
          </StatusPill>
        }
      />
      <div className="generic-intro card">
        <div className="generic-intro-icon">
          <Icon name={section.icon} size={29} />
        </div>
        <div>
          <span className="card-kicker">ÜRÜN KAPSAMI</span>
          <h2>{title}</h2>
          <p>
            {readOnly
              ? "Bu alanda yönetici durumu izler. Sipariş, mutfak, servis veya tahsilat işlemi yapmaz."
              : planned
                ? "Bu alan ürün haritasında yer alır. Gerçek kayıt ve backend akışı henüz uygulanmamıştır."
                : "Bu alanın ekran ve akış tasarımı ilk frontend kapsamında görünür. Gerçek kaydetme henüz bağlı değildir."}
          </p>
          <div className="generic-tags">
            <StatusPill tone="purple">Yönetim paneli</StatusPill>
            <StatusPill tone="neutral">Şube kapsamı</StatusPill>
            <DemoBadge compact />
          </div>
        </div>
      </div>
      <div className="generic-section-title">
        <div>
          <span className="card-kicker">ALT EKRANLAR</span>
          <h2>Bu alanda neler var?</h2>
        </div>
        <span>{section.items.length} ekran</span>
      </div>
      <div className="generic-grid">
        {section.items.map((entry, i) => (
          <Link
            className={`card generic-tile ${entry.slug === slug ? "current" : ""}`}
            to={`/${section.id}/${entry.slug}`}
            key={entry.slug}
          >
            <span className="tile-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{entry.label}</strong>
              <small>
                {readOnly
                  ? "İzleme ekranı"
                  : planned
                    ? "Planlanan yönetim akışı"
                    : "Ekran / akış tasarımı"}
              </small>
            </div>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
      <div className="prototype-box">
        <div className="prototype-icon">
          <ShieldCheck size={20} />
        </div>
        <div>
          <strong>Gerçek işlem durumu açıkça gösterilir</strong>
          <p>
            Bu ekrandaki planlı işlevler kayıt oluşturmaz. Backend bağlantısı
            eklendiğinde gerçek işlem, hata ve yetki durumları aynı ürün
            sözleşmesine göre çalışacaktır.
          </p>
        </div>
      </div>
    </>
  );
}

function FeatureClosedPage({ section, feature, branch }: { section: NavSection; feature: Feature; branch: DemoBranch }) {
  return <>
    <PageHeading eyebrow={section.label.toLocaleUpperCase('tr-TR')} title={section.label} description={`${branch.name} için bu yönetim alanı kapalı.`} action={<StatusPill tone="neutral">Modül kapalı</StatusPill>} />
    <div className="card closed-feature-card"><div className="closed-feature-icon"><Icon name={feature.icon} size={28} /></div><span className="card-kicker">{branch.name.toLocaleUpperCase('tr-TR')}</span><h2>{feature.name} bu şubede kapalı</h2><p>Alan ve alt özellikler katalogda görünür kalır. Bu şube için işlem başlatılamaz; geçmiş veriler gerçek backend eklendiğinde salt okunur erişilebilir olacaktır.</p><Link to="/settings/modules" className="primary-button">Modüller ve Özellikler <ArrowRight size={16} /></Link></div>
    <div className="generic-section-title"><div><span className="card-kicker">ALAN KAPSAMI</span><h2>İlgili ekranlar</h2></div><span>{section.items.length} ekran</span></div>
    <div className="generic-grid">{section.items.map((entry, index) => <div className="card generic-tile disabled-tile" key={entry.slug}><span className="tile-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{entry.label}</strong><small>Bu şubede kapalı</small></div></div>)}</div>
  </>
}

function RouteView({ ctx }: { ctx: ViewContext }) {
  const { section, item, productId } = useParams();
  const featureKeyBySection: Record<string, string> = { catalog: 'catalog.products', branches: 'branches.tables', sales: 'sales.monitoring', inventory: 'inventory.items', kitchen: 'kitchen.monitoring', reports: 'reports.sales' }
  const foundSection = sections.find(s => s.id === section)
  const controllingFeature = section ? features.find(feature => feature.key === featureKeyBySection[section]) : undefined
  if (foundSection && controllingFeature && ctx.selectedBranch && !(ctx.enabled[ctx.selectedBranch.id] ?? initialEnabled).includes(controllingFeature.key)) return <FeatureClosedPage section={foundSection} feature={controllingFeature} branch={ctx.selectedBranch} />
  if (productId) {
    const product = products.find((p) => p.id === productId);
    return product ? (
      <ProductDetail product={product} />
    ) : (
      <GenericPage section={sections[2]} slug="products" />
    );
  }
  if (!section || (section === "overview" && (!item || item === "daily")))
    return <Dashboard ctx={ctx} />;
  if (section === "catalog" && item === "products") return <ProductsPage />;
  if (section === "branches" && (!item || ["list", "tables"].includes(item)))
    return <BranchesPage ctx={ctx} />;
  if (
    section === "sales" &&
    (!item || ["summary", "checks", "open"].includes(item))
  )
    return <SalesPage ctx={ctx} />;
  if (section === "inventory" && (!item || item === "summary"))
    return <InventoryPage />;
  if (
    section === "reports" &&
    (!item || item === "sales" || item === "branches")
  )
    return <ReportsPage ctx={ctx} />;
  if (section === "settings" && (!item || item === "modules"))
    return <ModulesPage ctx={ctx} />;
  if (section === "settings" && item === "integrations")
    return <IntegrationsPage />;
  const found = sections.find((s) => s.id === section);
  return found ? (
    <GenericPage section={found} slug={item} />
  ) : (
    <Dashboard ctx={ctx} />
  );
}

export default function App() {
  const [scenarioId, setScenarioId] = useState("multi");
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? scenarios[0];
  const [branchId, setBranchId] = useState("all");
  const [enabled, setEnabled] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      scenarios.flatMap((s) =>
        s.branches.map((b) => [b.id, [...initialEnabled]]),
      ),
    ),
  );
  const validBranchId = scenario.branches.some((b) => b.id === branchId)
    ? branchId
    : scenario.branches.length > 1
      ? "all"
      : scenario.branches[0].id;
  const selectedBranch = useMemo(
    () => scenario.branches.find((b) => b.id === validBranchId) ?? null,
    [scenario, validBranchId],
  );
  const ctx: ViewContext = {
    scenarioId,
    setScenarioId: (id) => {
      setScenarioId(id);
      setBranchId(id === "single" ? "kadikoy" : "all");
    },
    branchId: validBranchId,
    setBranchId,
    branches: scenario.branches,
    selectedBranch,
    firm: scenario.firm,
    brand: scenario.brand,
    isMulti: scenario.branches.length > 1,
    enabled,
    setEnabled,
  };
  return (
    <Shell ctx={ctx}>
      <Routes>
        <Route path="/" element={<Dashboard ctx={ctx} />} />
        <Route path="/:section" element={<RouteView ctx={ctx} />} />
        <Route path="/:section/:item" element={<RouteView ctx={ctx} />} />
        <Route
          path="/catalog/products/:productId"
          element={<RouteView ctx={ctx} />}
        />
        <Route path="*" element={<Dashboard ctx={ctx} />} />
      </Routes>
    </Shell>
  );
}
