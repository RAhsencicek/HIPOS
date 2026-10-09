import singleDemo from "../../../../../contracts/demo-single-branch.v1.json";
import type { ViewContext } from "../../app/context";
import { PageHeading, StatusPill, DemoNotice } from "../../shared/ui";

const money = (amountMinor: number) => new Intl.NumberFormat("tr-TR", {
  style: "currency", currency: "TRY",
}).format(amountMinor / 100);

function ScopeNotice({ ctx }: { ctx: ViewContext }) {
  return ctx.scenarioId === "single" ? null :
    <div className="card generic-empty">Bu alanın bağlı demo verisi yalnız Mahalle Fırını · Kadıköy Şubesi için hazırlandı. Çok şubeli senaryoda burada kalıcı cari, reçete veya stok kaydı yok.</div>;
}

export function CarilerDemoPage({ ctx, kind }: {
  ctx: ViewContext;
  kind: "customer" | "supplier" | "all";
}) {
  const title = kind === "customer" ? "Müşteriler" : kind === "supplier" ? "Tedarikçiler" : "Cari hesaplar";
  const parties = ctx.scenarioId === "single"
    ? singleDemo.parties.filter((party) => kind === "all" || party.types.includes(kind))
    : [];
  const ids = new Set(parties.map((party) => party.id));
  const movements = singleDemo.partyMovements.filter((movement) => ids.has(movement.partyId));
  return <>
    <PageHeading eyebrow="CARİ VE MÜŞTERİLER" title={title}
      description="Müşteri ve tedarikçi kartları ile örnek hareketlerden hesaplanan bakiyeler."
      action={<StatusPill tone="purple">Örnek gösterim</StatusPill>} />
    <DemoNotice>Cari kartları ve hareketleri kurgusal demo verisidir. Bu ekranda kayıt, gerçek tahsilat veya fatura oluşturulmaz.</DemoNotice>
    <ScopeNotice ctx={ctx} />
    {ctx.scenarioId === "single" && <>
      <section className="card content-card">
        <div className="card-heading padded"><div><span className="card-kicker">CARİ KARTLARI</span><h2>{title}</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>AD / UNVAN</th><th>TÜR</th><th>HAREKET</th><th>BAKİYE</th></tr></thead>
          <tbody>{parties.map((party) => {
            const partyMovements = movements.filter((movement) => movement.partyId === party.id);
            const balance = partyMovements.reduce((sum, movement) => sum + movement.deltaMinor, 0);
            return <tr key={party.id}>
              <td><strong>{party.name}</strong></td>
              <td>{party.types.includes("supplier") ? "Tedarikçi" : "Müşteri"}</td>
              <td>{partyMovements.length} örnek hareket</td>
              <td><strong>{money(balance)}</strong><small>{party.types.includes("supplier") ? "İşletmenin borcu" : "İşletmenin alacağı"}</small></td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>
      <section className="card content-card">
        <div className="card-heading padded"><div><span className="card-kicker">HAREKET GEÇMİŞİ</span><h2>Örnek cari hareketleri</h2></div></div>
        <div className="table-scroll"><table><thead><tr><th>CARİ</th><th>AÇIKLAMA</th><th>KAYNAK</th><th>BAKİYE ETKİSİ</th></tr></thead>
          <tbody>{movements.map((movement) => <tr key={movement.id}>
            <td>{parties.find((party) => party.id === movement.partyId)?.name}</td>
            <td>{movement.description}</td><td>Elle girilmiş demo</td>
            <td>{movement.deltaMinor > 0 ? "+" : "−"}{money(Math.abs(movement.deltaMinor))}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </>}
  </>;
}

export function RecipesDemoPage({ ctx }: { ctx: ViewContext }) {
  return <>
    <PageHeading eyebrow="STOK VE SATIN ALMA" title="Reçeteler"
      description="Ürünü aynı demo hammadde kayıtlarına bağlayan porsiyon tarifleri."
      action={<StatusPill tone="purple">Örnek gösterim</StatusPill>} />
    <DemoNotice>Reçete kalemleri yalnız örnek veridir. Sürüm kaydetme ve otomatik stok tüketimi henüz etkin değil.</DemoNotice>
    <ScopeNotice ctx={ctx} />
    {ctx.scenarioId === "single" && <div className="generic-grid">
      {singleDemo.recipes.map((recipe) => {
        const product = singleDemo.products.find((entry) => entry.id === recipe.productId)!;
        return <section className="card demo-recipe-card" key={recipe.id}>
          <span className="card-kicker">REÇETE · SÜRÜM {recipe.version}</span>
          <h2>{product.name}</h2><p>{recipe.portion}</p>
          <ul>{recipe.lines.map((line) => {
            const ingredient = singleDemo.ingredients.find((entry) => entry.id === line.ingredientId)!;
            return <li key={line.ingredientId}><span>{ingredient.name}</span><strong>{line.quantity} {ingredient.unit}</strong></li>;
          })}</ul>
        </section>;
      })}
    </div>}
  </>;
}

export function StockDemoPage({ ctx, view }: {
  ctx: ViewContext;
  view: "ingredients" | "critical" | "movements" | "counts";
}) {
  const title = { ingredients: "Hammadde", critical: "Kritik stoklar", movements: "Stok hareket geçmişi", counts: "Stok sayımları" }[view];
  const quantities = new Map(singleDemo.ingredients.map((ingredient) => [ingredient.id,
    singleDemo.stockMovements.filter((movement) => movement.ingredientId === ingredient.id)
      .reduce((sum, movement) => sum + movement.delta, 0)]));
  const ingredients = view === "critical" ? singleDemo.ingredients.filter((ingredient) =>
    quantities.get(ingredient.id)! < ingredient.criticalBelow) : singleDemo.ingredients;
  const count = singleDemo.countExample;
  const countedIngredient = singleDemo.ingredients.find((ingredient) => ingredient.id === count.ingredientId)!;
  return <>
    <PageHeading eyebrow="STOK VE SATIN ALMA" title={title}
      description="Mahalle Fırını örnek stok hareketlerinden hesaplanan görünüm."
      action={<StatusPill tone="purple">Örnek gösterim</StatusPill>} />
    <DemoNotice>Bu veriler demo dosyasından hesaplanır; kalıcı stok kaydı, sayım onayı veya otomatik düzeltme henüz etkin değil.</DemoNotice>
    <ScopeNotice ctx={ctx} />
    {ctx.scenarioId === "single" && view === "counts" && <section className="card content-card">
      <div className="card-heading padded"><div><span className="card-kicker">ÖRNEK SAYIM FARKI</span><h2>{countedIngredient.name}</h2></div></div>
      <div className="demo-count-grid">
        <div><span>Sistem miktarı</span><strong>{count.systemQuantity} {count.unit}</strong></div>
        <div><span>Fiziksel miktar</span><strong>{count.physicalQuantity} {count.unit}</strong></div>
        <div><span>Fark</span><strong>{count.physicalQuantity - count.systemQuantity} {count.unit}</strong></div>
      </div>
      <p className="card-note">Bu fark yalnız örnektir; stok miktarı değişmedi. Onaylı sayım akışı üçüncü aşamada yapılacak.</p>
    </section>}
    {ctx.scenarioId === "single" && view === "movements" && <section className="card content-card">
      <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>KAYNAK</th><th>CARİ</th><th>MİKTAR ETKİSİ</th></tr></thead>
        <tbody>{singleDemo.stockMovements.map((movement) => {
          const ingredient = singleDemo.ingredients.find((entry) => entry.id === movement.ingredientId)!;
          return <tr key={movement.id}><td>{ingredient.name}</td><td>{movement.source === "opening_demo" ? "Başlangıç · demo" : movement.source === "purchase_demo" ? "Alış · demo" : "Elle tüketim · demo"}</td>
            <td>{"partyId" in movement ? singleDemo.parties.find((party) => party.id === movement.partyId)?.name : "—"}</td>
            <td>{movement.delta > 0 ? "+" : ""}{movement.delta} {ingredient.unit}</td></tr>;
        })}</tbody>
      </table></div>
    </section>}
    {ctx.scenarioId === "single" && (view === "ingredients" || view === "critical") && <section className="card content-card">
      <div className="table-scroll"><table><thead><tr><th>HAMMADDE</th><th>HAREKET TOPLAMI</th><th>KRİTİK EŞİK</th><th>DURUM</th></tr></thead>
        <tbody>{ingredients.map((ingredient) => <tr key={ingredient.id}><td><strong>{ingredient.name}</strong></td>
          <td>{quantities.get(ingredient.id)} {ingredient.unit}</td>
          <td>{ingredient.criticalBelow} {ingredient.unit}</td>
          <td><StatusPill tone={quantities.get(ingredient.id)! < ingredient.criticalBelow ? "orange" : "green"}>
            {quantities.get(ingredient.id)! < ingredient.criticalBelow ? "Kritik" : "Yeterli"}</StatusPill></td></tr>)}</tbody>
      </table></div>
    </section>}
  </>;
}
