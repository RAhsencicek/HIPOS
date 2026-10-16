import { useEffect, useState } from "react";
import type * as React from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowRight,
  Bell,
  Building2,
  ChevronDown,
  Clock3,
  CircleHelp,
  LayoutGrid,
  Menu,
  Search,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import { sections } from "../data/catalog";
import { isFutureSidebarItem } from "../data/featurePresentation";
import type { ViewContext } from "../app/context";
import { Icon } from "../shared/ui";

const allSections = sections.flatMap((section) => [
  { label: section.label, path: `/admin/${section.id}`, group: "Ana alan" },
  ...section.items.map((item) => ({
    label: item.label,
    path: `/admin/${section.id}/${item.slug}`,
    group: section.label,
  })),
]);

export function Shell({
  ctx,
  children,
}: {
  ctx: ViewContext;
  children: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const sectionId = location.pathname.split("/")[2] || "overview";
  const itemSlug = location.pathname.split("/")[3];
  const futurePreview = Boolean(itemSlug && isFutureSidebarItem(sectionId, itemSlug));
  const [expanded, setExpanded] = useState(sectionId);
  const [futureExpanded, setFutureExpanded] = useState("");
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
    const itemSlug = location.pathname.split("/")[3];
    setFutureExpanded(
      itemSlug && isFutureSidebarItem(sectionId, itemSlug) ? sectionId : "",
    );
    setSidebarOpen(false);
    setSearchOpen(false);
  }, [sectionId, location.pathname]);

  return (
    <div className={`app-shell ${futurePreview ? "kitchen-preview-shell" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-row">
          <Link to="/admin/" className="brand">
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
                    navigate(`/admin/${section.id}`);
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
                    {section.items.filter((item) => !isFutureSidebarItem(section.id, item.slug)).map((item) => (
                      <Link
                        key={item.slug}
                        to={`/admin/${section.id}/${item.slug}`}
                        className={location.pathname === `/admin/${section.id}/${item.slug}` ? "active" : ""}
                      >
                        {item.label}
                      </Link>
                    ))}
                    {section.items.some((item) => isFutureSidebarItem(section.id, item.slug)) && (
                      <div className="nav-future-group">
                        <button
                          className={`nav-future-toggle ${futureExpanded === section.id ? "open" : ""}`}
                          onClick={() => setFutureExpanded(futureExpanded === section.id ? "" : section.id)}
                          aria-expanded={futureExpanded === section.id}
                          aria-controls={`future-${section.id}`}
                        >
                          <Clock3 size={14} aria-hidden="true" />
                          <span>Gelecekte</span>
                          <small>{section.items.filter((item) => isFutureSidebarItem(section.id, item.slug)).length}</small>
                          <ChevronDown size={14} className={futureExpanded === section.id ? "rotated" : ""} aria-hidden="true" />
                        </button>
                        {futureExpanded === section.id && (
                          <div className="nav-future-children" id={`future-${section.id}`}>
                            {section.items.filter((item) => isFutureSidebarItem(section.id, item.slug)).map((item) => (
                              <Link
                                key={item.slug}
                                to={`/admin/${section.id}/${item.slug}`}
                                className={location.pathname === `/admin/${section.id}/${item.slug}` ? "active" : ""}
                              >
                                {item.label}
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
            <strong>Yönetim paneli</strong>
            <small>İşletmenizin kontrol merkezi</small>
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
        {futurePreview && <header className="kitchen-preview-mobile-header">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Menüyü aç">
            <Menu size={21} />
          </button>
          <span>hipos<span className="brand-dot">.</span></span>
        </header>}
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu size={21} />
          </button>
          <div className="topbar-scope-selector">
            <div className="topbar-firm-badge" title="Aktif İşletme">
              <Store size={15} />
              <span className="firm-name">{ctx.firm}</span>
            </div>

            <span className="topbar-scope-divider">/</span>

            <div className="topbar-select-pill branch-pill" title="Aktif Şube Seçimi">
              <Building2 size={13} className="pill-leading-icon" />
              <select
                aria-label="Şube seçimi"
                value={ctx.branchId}
                onChange={(e) => ctx.setBranchId(e.target.value)}
              >
                {ctx.isMulti && <option value="all">Tüm Şubeler</option>}
                {ctx.branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="pill-arrow" />
            </div>

            <div className="topbar-select-pill scenario-pill" title="İşletme Modu (Tek / Çok Şubeli)">
              <select
                aria-label="İşletme senaryosu"
                value={ctx.scenarioId}
                onChange={(e) => ctx.setScenarioId(e.target.value)}
              >
                <option value="single">Tek Şube Modu</option>
                <option value="multi">Çok Şubeli Zincir</option>
              </select>
              <ChevronDown size={12} className="pill-arrow" />
            </div>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              aria-label="Panelde ara"
              placeholder="Panelde ara... (Menü, Stok, Kasa)"
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
            <div className="topbar-env-pill" title="Canlı Önizleme Ortamı">
              <span className="live-dot" />
              <span>Önizleme Ortamı</span>
            </div>
            <button
              className="icon-button topbar-icon"
              title="Bildirimler"
              aria-label="Bildirimler"
              onClick={() => navigate("/admin/overview/alerts")}
            >
              <Bell size={18} />
              <i />
            </button>
            <button
              className="icon-button topbar-icon"
              title="Yardım ve Ayarlar"
              aria-label="Yardım"
              onClick={() => navigate("/admin/settings/modules")}
            >
              <CircleHelp size={18} />
            </button>
            <div className="topbar-profile" title="Yönetici Profili">
              <div className="user-avatar">YA</div>
              <div className="user-info">
                <strong>Yönetici</strong>
                <small>{ctx.isMulti ? "Merkez Ofis" : "Şube Müdürü"}</small>
              </div>
            </div>
          </div>
        </header>
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
