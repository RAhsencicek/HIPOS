import { useEffect, useState } from "react";
import type * as React from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  LayoutGrid,
  Menu,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { sections } from "../data/catalog";
import type { ViewContext } from "../app/context";
import { Icon, DemoBadge } from "../shared/ui";

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
                    {section.items.map((item) => (
                      <Link
                        key={item.slug}
                        to={`/admin/${section.id}/${item.slug}`}
                        className={
                          location.pathname ===
                          `/admin/${section.id}/${item.slug}`
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
              onClick={() => navigate("/admin/overview/alerts")}
            >
              <Bell size={19} />
              <i />
            </button>
            <button
              className="icon-button topbar-icon"
              title="Yardım"
              aria-label="Yardım"
              onClick={() => navigate("/admin/settings/modules")}
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
