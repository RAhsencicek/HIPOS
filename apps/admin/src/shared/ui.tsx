import {
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChefHat,
  ContactRound,
  HeartHandshake,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  MoreHorizontal,
  Network,
  NotebookTabs,
  Package,
  PlugZap,
  ReceiptText,
  Settings2,
  Sparkles,
  Store,
  Tag,
  Truck,
  UsersRound,
  Wallet,
} from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";
import type { LucideIcon } from "lucide-react";

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
  "contact-round": ContactRound,
  "plug-zap": PlugZap,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = iconMap[name] ?? Package;
  return <Component size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`demo-badge ${compact ? "compact" : ""}`}>
      <span className="demo-dot" /> Örnek veri
    </span>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "purple" | "green" | "orange" | "red" | "neutral" | "blue";
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function PageHeading({
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

export function MetricCard({
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

export function DemoNotice({
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
