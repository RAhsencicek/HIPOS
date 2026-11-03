import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { AlertCircle, ArrowLeft, ArrowUpRight, ImageOff, Search, Sparkles, UtensilsCrossed, X } from "lucide-react";
import hiposLogo from "../../../../pos/public/hipos-logo.png";

type PublicProduct = {
  id: string;
  name: string;
  description: string;
  allergens: string[];
  price: { amountMinor: number; currency: string };
  imageUrl: string | null;
};
type PublicSection = { sectionId: string; name: string; products: PublicProduct[] };
type PublicMenu = { id: string; name: string; description: string; sections: PublicSection[] };
type PublicCategory = { id: string; name: string; products: PublicProduct[] };
type MenuResponse = { restaurantName: string; branchName: string; logoUrl: string | null; menus: PublicMenu[]; categories?: PublicCategory[] };
type MenuState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: MenuResponse };

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "";
const price = (amountMinor: number, currency: string) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(amountMinor / 100);

function DiscoveryCard({ name, label, imageUrl, onSelect }: { name: string; label: string; imageUrl: string | null; onSelect: () => void }) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => setImageError(false), [imageUrl]);
  return (
    <button type="button" className="qr-discovery-card" onClick={onSelect} aria-label={`${name} — ${label}`}>
      {imageUrl && !imageError ? <img src={`${apiBase}${imageUrl}`} alt="" loading="lazy" onError={() => setImageError(true)} /> : <span className="qr-discovery-placeholder" aria-hidden="true"><UtensilsCrossed size={32} /></span>}
      <span className="qr-discovery-shade" />
      <span className="qr-discovery-copy"><span>{label}</span><strong>{name}</strong></span>
      <span className="qr-discovery-arrow" aria-hidden="true"><ArrowUpRight size={17} /></span>
    </button>
  );
}

function CoffeeBackdrop() {
  return (
    <>{[0, 1, 2].map(layer => <div className={`qr-coffee-rain qr-coffee-layer-${layer}`} aria-hidden="true" key={layer}>
      <svg className="qr-coffee qr-coffee-cup" viewBox="0 0 80 90" fill="none">
        <path d="M19 40h39v18c0 10-8 17-19 17S19 68 19 58V40Zm39 4h5c10 0 9 15-5 15M15 80h49M29 30c-5-5 5-8 0-13m12 13c-5-5 5-8 0-13" />
        <path d="M23 45h31v11c0 8-6 14-15 14s-16-6-16-14V45Z" className="qr-coffee-fill" />
      </svg>
      <svg className="qr-coffee qr-coffee-pizza" viewBox="0 0 80 90" fill="none">
        <path d="M10 25Q40 7 70 25L40 78 10 25Zm0 0q30-18 60 0M25 29l7 4-4 7-7-4 4-7Zm24 3 7-2 3 7-7 3-3-8ZM36 51l7-3 4 7-7 3-4-7Z" />
        <path d="M15 29q25-13 50 0L40 70 15 29Z" className="qr-food-fill" />
      </svg>
      <svg className="qr-coffee qr-coffee-burger" viewBox="0 0 80 90" fill="none">
        <path d="M11 41c2-15 14-23 29-23s27 8 29 23H11Zm2 8h54M10 55q7-5 14 0t14 0 14 0 17 0M13 63h54c0 9-5 12-12 12H25c-7 0-12-3-12-12Zm13-34h1m12-4h1m13 4h1" />
        <path d="M15 38c3-10 13-16 25-16s22 6 25 16H15Z" className="qr-food-fill" />
      </svg>
      <svg className="qr-coffee qr-coffee-turkish" viewBox="0 0 80 90" fill="none">
        <path d="M24 42h31v15c0 10-6 16-15 16s-16-6-16-16V42Zm31 3h5c8 0 7 13-5 13M17 78h47M31 33c-4-4 4-7 0-11m12 11c-4-4 4-7 0-11" />
        <path d="M28 48h23v9c0 7-4 12-11 12s-12-5-12-12v-9Z" className="qr-coffee-fill" />
      </svg>
      <svg className="qr-coffee qr-coffee-cake" viewBox="0 0 80 90" fill="none">
        <path d="M12 67h57M18 63V39l33-18 12 6v36H18Zm0-16 45-12M18 55l45-12M48 20c-3-4 1-8 4-8s7 4 4 8" />
        <path d="M22 49 59 39v19H22v-9Z" className="qr-food-fill" />
      </svg>
      <svg className="qr-coffee qr-coffee-dessert" viewBox="0 0 80 100" fill="none">
        <path d="M19 43h42l-5 38H24l-5-38Zm0 0c0-7 5-10 11-10 1-8 7-12 13-11 7 1 10 5 10 11 6 0 8 4 8 10M30 55v15m10-15v17m10-17v15M40 21c-3-5 2-9 5-12" />
        <path d="M24 48h32l-4 28H28l-4-28Z" className="qr-food-fill" />
      </svg>
    </div>)}</>
  );
}

function MenuProductCard({ product, onSelect }: { product: PublicProduct; onSelect: () => void }) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    setImageError(false);
  }, [product.imageUrl]);

  return (
    <article
      className="qr-product qr-product-interactive"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && onSelect()}
      aria-label={`${product.name} detaylarını gör`}
    >
      <div className="qr-product-copy">
        <div className="qr-product-title-row">
          <h3>{product.name}</h3>
        </div>
        {product.description && <p className="qr-product-desc">{product.description}</p>}
        <div className="qr-product-bottom">
          <strong className="qr-product-price">{price(product.price.amountMinor, product.price.currency)}</strong>
        </div>
      </div>
      <div className="qr-product-photo">
        {product.imageUrl && !imageError ? (
          <img src={`${apiBase}${product.imageUrl}`} alt={product.name} loading="lazy" onError={() => setImageError(true)} />
        ) : (
          <div className="qr-product-photo-empty">
            <ImageOff size={24} aria-label="Ürün görseli yok" />
          </div>
        )}
      </div>
    </article>
  );
}

function ProductDetailModal({ product, onClose }: { product: PublicProduct; onClose: () => void }) {
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="qr-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="qr-modal-card" onClick={e => e.stopPropagation()}>
        <button type="button" className="qr-modal-close" onClick={onClose} aria-label="Kapat">
          <X size={20} />
        </button>
        <div className="qr-modal-media">
          {product.imageUrl && !imageError ? (
            <img src={`${apiBase}${product.imageUrl}`} alt={product.name} onError={() => setImageError(true)} />
          ) : (
            <div className="qr-modal-media-empty">
              <ImageOff size={44} aria-label="Ürün görseli yok" />
            </div>
          )}
        </div>
        <div className="qr-modal-content">
          <h2 id="modal-title" className="qr-modal-title">
            {product.name}
          </h2>
          {product.description && <p className="qr-modal-description">{product.description}</p>}
          <div className="qr-modal-footer">
            <strong className="qr-modal-price">{price(product.price.amountMinor, product.price.currency)}</strong>
            <button type="button" className="qr-modal-btn" onClick={onClose}>
              Kapat
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PublicMenuPage() {
  const { token = "" } = useParams();
  const { search } = useLocation();
  const tableLabel = (new URLSearchParams(search).get("masa") ?? "").trim().slice(0, 50);
  const [state, setState] = useState<MenuState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [logoError, setLogoError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<PublicProduct | null>(null);
  const [selection, setSelection] = useState<{ menuId?: string; sectionId?: string; categoryId?: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    let initialLoad = true;
    let controller: AbortController | null = null;
    setLogoError(false);
    setSelection(null);
    setSearchQuery("");
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      try {
        const response = await fetch(`${apiBase}/api/v1/public/menus/${encodeURIComponent(token)}`, { signal: current.signal });
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Bu menü bağlantısı bulunamadı."
              : "Menüye şu anda ulaşılamıyor. Lütfen tekrar deneyin.",
          );
        const data = await response.json() as MenuResponse;
        if (!disposed && !current.signal.aborted) setState({ status: "ready", data });
      } catch (reason) {
        if (!disposed && !current.signal.aborted) setState(previous => previous.status === "ready" ? previous : {
          status: "error",
          message: reason instanceof TypeError
            ? "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin."
            : reason instanceof Error ? reason.message : "Menü yüklenemedi.",
        });
      } finally { initialLoad = false; }
    };
    void refresh();
    const interval = window.setInterval(() => { if (!initialLoad) void refresh(); }, 5000);
    return () => { disposed = true; window.clearInterval(interval); controller?.abort(); };
  }, [token, revision]);

  const query = searchQuery.trim().toLocaleLowerCase("tr-TR");

  const filteredMenus = useMemo(() => {
    if (state.status !== "ready") return [];
    if (!query) return state.data.menus;
    return state.data.menus.map(menu => ({
      ...menu,
      sections: menu.sections
        .map(section => ({
          ...section,
          products: section.products.filter(
            p =>
              p.name.toLocaleLowerCase("tr-TR").includes(query) ||
              p.description.toLocaleLowerCase("tr-TR").includes(query),
          ),
        }))
        .filter(section => section.products.length > 0),
    }));
  }, [state, query]);

  const filteredCategories = useMemo(() => {
    if (state.status !== "ready") return [];
    const categories = state.data.categories ?? [];
    if (!query) return categories;
    return categories.map(category => ({ ...category, products: category.products.filter(product =>
      product.name.toLocaleLowerCase("tr-TR").includes(query) || product.description.toLocaleLowerCase("tr-TR").includes(query)) }));
  }, [state, query]);

  if (state.status !== "ready")
    return (
      <main className="qr-page qr-state" aria-live="polite">
        {state.status === "loading" ? (
          <>
            <span className="qr-state-icon">
              <UtensilsCrossed size={28} />
            </span>
            <h1>Menü hazırlanıyor</h1>
            <p>Lezzetli seçenekler birazdan burada olacak.</p>
          </>
        ) : (
          <>
            <span className="qr-state-icon qr-state-error">
              <AlertCircle size={28} />
            </span>
            <h1>Menü açılamadı</h1>
            <p>{state.message}</p>
            <button type="button" className="qr-retry" onClick={() => setRevision(value => value + 1)}>
              Tekrar dene
            </button>
          </>
        )}
      </main>
    );

  const { data } = state;
  const categories = data.categories ?? [];
  const sections = data.menus.flatMap((menu, menuIndex) =>
    menu.sections.map((section, sectionIndex) => ({
      menu,
      section,
      anchor: `menu-${menuIndex}-section-${sectionIndex}`,
    })),
  );

  const selectedCategory = selection?.categoryId ? filteredCategories.find(category => category.id === selection.categoryId) : null;
  const productMenus = selectedCategory ? [{ id: `category-${selectedCategory.id}`, name: selectedCategory.name, description: "", sections: [{ sectionId: selectedCategory.id, name: selectedCategory.name, products: selectedCategory.products }] }] : filteredMenus
    .filter(menu => !selection?.menuId || menu.id === selection.menuId)
    .map(menu => ({ ...menu, sections: selection?.sectionId ? menu.sections.filter(section => section.sectionId === selection.sectionId) : menu.sections }));
  const hasVisibleProducts = productMenus.some(menu => menu.sections.some(section => section.products.length > 0));
  const showProducts = Boolean(selection || query);

  return (
    <main className="qr-page">
      <header className="qr-hero">
        <CoffeeBackdrop />
        <div className="qr-hero-overlay" aria-hidden="true" />
        <div className="qr-hero-ambient" aria-hidden="true" />
        <div className="qr-hero-inner">
          <div className="qr-brand">
            <span className="qr-brand-logo">
              <img
                src={data.logoUrl && !logoError ? data.logoUrl : hiposLogo}
                alt=""
                onError={() => setLogoError(true)}
              />
            </span>
            <div className="qr-brand-text">
              <p className="qr-brand-overline">
                <Sparkles size={13} className="qr-sparkle-icon" /> HOŞ GELDİNİZ
              </p>
              <h1>{data.restaurantName}</h1>
              {tableLabel && (
                <div className="qr-branch">
                  <span className="qr-table-badge">Masa {tableLabel}</span>
                </div>
              )}
            </div>
          </div>

          {(sections.length > 0 || categories.length > 0) && (
            <div className="qr-search-wrap">
              <Search size={18} className="qr-search-icon" />
              <input
                type="search"
                className="qr-search-input"
                placeholder="Menüde ürün veya lezzet ara..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                aria-label="Menüde ara"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="qr-search-clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Aramayı temizle"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {sections.length > 0 || categories.length > 0 ? (
        <div className="qr-content">
          {!showProducts ? (
            <section className="qr-discovery" aria-label="Menü ve kategorileri keşfet">
              <div className="qr-discovery-heading">
                <span>SOFRAMIZA HOŞ GELDİNİZ</span>
                <h2>Ne keşfetmek istersiniz?</h2>
                <p>Menülerimizden veya kategorilerimizden seçerek lezzetleri inceleyin.</p>
              </div>
              <div className="qr-discovery-grid">
                {data.menus.map(menu => (
                  <DiscoveryCard key={menu.id} name={menu.name} label="Menü"
                    imageUrl={menu.sections.flatMap(section => section.products).find(product => product.imageUrl)?.imageUrl ?? null}
                    onSelect={() => setSelection({ menuId: menu.id })} />
                ))}
                {data.menus.flatMap(menu => menu.sections.map(section => (
                  <DiscoveryCard key={`${menu.id}-${section.sectionId}`} name={section.name} label={menu.name}
                    imageUrl={section.products.find(product => product.imageUrl)?.imageUrl ?? null}
                    onSelect={() => setSelection({ menuId: menu.id, sectionId: section.sectionId })} />
                )))}
                {categories.map(category => (
                  <DiscoveryCard key={`category-${category.id}`} name={category.name} label="Kategori"
                    imageUrl={category.products.find(product => product.imageUrl)?.imageUrl ?? null}
                    onSelect={() => setSelection({ categoryId: category.id })} />
                ))}
              </div>
            </section>
          ) : (
            <>
              <button type="button" className="qr-discovery-back" onClick={() => { setSelection(null); setSearchQuery(""); }}>
                <ArrowLeft size={17} /> Menü ve kategoriler
              </button>
              {query && !hasVisibleProducts ? (
                <div className="qr-search-empty">
                  <Search size={32} />
                  <h3>"{searchQuery}" ile eşleşen lezzet bulunamadı</h3>
                  <p>Farklı bir arama yapabilir veya tüm menüyü inceleyebilirsiniz.</p>
                  <button type="button" className="qr-search-reset-btn" onClick={() => setSearchQuery("")}>
                    Aramayı temizle
                  </button>
                </div>
              ) : (
                productMenus.filter(menu => !query || menu.sections.length > 0).map(menu => (
                  <section className="qr-menu-group" key={menu.id}>
                    <header className="qr-menu-heading">
                      <h2>{menu.name}</h2>
                      {menu.description && <p>{menu.description}</p>}
                    </header>
                    {menu.sections.length === 0 && <p className="qr-menu-empty">Bu menüde şu anda gösterilebilecek ürün bulunmuyor.</p>}
                    {menu.sections.map(section => (
                      <section className="qr-section" key={section.sectionId}>
                        <div className="qr-section-heading">
                          <h2>{section.name}</h2>
                          <span className="qr-section-badge">{section.products.length} ürün</span>
                        </div>
                        <div className="qr-product-list">
                          {section.products.map(product => (
                            <MenuProductCard key={product.id} product={product} onSelect={() => setSelectedProduct(product)} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </section>
                ))
              )}
            </>
          )}
        </div>
      ) : (
        <section className="qr-empty">
          <span className="qr-state-icon">
            <UtensilsCrossed size={32} />
          </span>
          <h2>Menü henüz hazır değil</h2>
          <p>Şu anda gösterilebilecek bir ürün bulunmuyor.</p>
        </section>
      )}

      {selectedProduct && (
        <ProductDetailModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}

      <footer className="qr-footer">
        <div className="qr-footer-brand">
          <strong>{data.restaurantName}</strong>
        </div>
        <p className="qr-footer-note">Afiyet olsun · Keyifli vakitler dileriz</p>
      </footer>
    </main>
  );
}
