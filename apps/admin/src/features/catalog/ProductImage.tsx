import { useEffect, useState } from "react";

type Props = { image: string; productId: string; firmId: string; branchId: string | null; actor: string; name: string };
export function ProductImage({ image, productId, firmId, branchId, actor, name }: Props) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!image.startsWith("upload:") || !branchId) return;
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    const imageId = image.slice("upload:".length);
    const path = `/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/catalog/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}`;
    void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, { headers: { "X-Demo-Actor": actor }, signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("image unavailable"); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
      .catch(() => {});
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image, productId, firmId, branchId, actor]);
  if (!image.startsWith("upload:")) return <>{image || "🍽️"}</>;
  return url ? <img src={url} alt={name} /> : <span aria-label="Görsel yüklenemedi">🍽️</span>;
}
