import { Activity, ArrowRight, Boxes, Truck, Wallet } from "lucide-react";
import { Link } from "react-router";
import { formatMoney } from "../../data/catalog";
import {
  StatusPill,
  PageHeading,
  MetricCard,
  DemoNotice,
} from "../../shared/ui";

export function InventoryPage() {
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
            <Link className="text-link" to="/admin/inventory/ingredients">
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
          <Link className="subtle-link" to="/admin/inventory/requests">
            Akış kapsamını gör <ArrowRight size={15} />
          </Link>
        </section>
      </div>
    </>
  );
}
