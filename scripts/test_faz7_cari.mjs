import { request } from "http";

const API_BASE = "http://127.0.0.1:5180";
const FIRM_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const REGISTER_ID = "77777777-7777-4777-8777-777777777700";

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = {
    "X-Demo-Actor": "pos-single",
    "Content-Type": "application/json",
    ...options.headers,
  };
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const res = await fetch(url, {
    method: options.method || "GET",
    headers,
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API Error [${res.status}] ${path}: ${text}`);
  }
  return res.json();
}

async function run() {
  console.log("=== FAZ 7 TEST: CARİYE YAZMA / VERESİYE TAHSİLAT ENTEGRASYONU ===");

  // 1. Ahmet Yılmaz'ın başlangıç bakiyesini oku
  const partyBefore = await api(`/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/caris/party-ahmet`, {
    headers: { "X-Demo-Actor": "manager-single" }
  });
  console.log(`[1] Ahmet Yılmaz Başlangıç Bakiyesi: ${partyBefore.customerBalanceMinor / 100} TL (Hareket Sayısı: ${partyBefore.movementCount})`);

  // 2. Yeni bir hızlı satış adisyonu oluştur (Tavuklu Sandviç: 260 TL)
  const checkId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const createCheckPayload = {
    requestId: checkId,
    firstOrderId: orderId,
    items: [
      {
        productId: "55555555-5555-4555-8555-555555555502",
        productName: "Tavuklu Sandviç",
        sku: "SND-001",
        quantity: 1,
        unitPriceMinor: 26000
      }
    ]
  };

  const createdCheck = await api(`/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/sales/checks`, {
    method: "POST",
    body: createCheckPayload
  });
  console.log(`[2] Satış Adisyonu Açıldı: Adisyon ID ${createdCheck.id}, Tutar: ${createdCheck.totalMinor / 100} TL`);

  // 3. Cariye Yazma (Veresiye) Ödemesi Yap
  const attemptId = crypto.randomUUID();
  const paymentPayload = {
    orderId: orderId,
    attemptId: attemptId,
    amountMinor: 26000,
    method: "cari",
    customerId: "party-ahmet",
    simulatedOutcome: "succeeded",
    expectedOrderVersion: createdCheck.orders[0].version,
    postToCash: true,
    registerId: REGISTER_ID
  };

  console.log(`[3] Ödeme Başlatılıyor: 260 TL -> Cari / Veresiye (party-ahmet)`);
  const paymentRes = await api(`/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/sales/checks/${checkId}/payment-attempts`, {
    method: "POST",
    body: paymentPayload
  });
  console.log(`    Ödeme Sonucu: Provider = "${paymentRes.attempt.provider}", Status = "${paymentRes.attempt.status}"`);

  // 4. Adisyonun Kapandığını ve Müşteri İlişkisini Doğrula
  const updatedCheck = paymentRes.check;
  console.log(`[4] Adisyon Güncel Durumu: Status = "${updatedCheck.status}", Remaining = ${updatedCheck.remainingMinor / 100} TL, CustomerId = "${updatedCheck.customerId}"`);
  if (updatedCheck.status !== "closed") {
    throw new Error(`Beklenen: closed, Gelen: ${updatedCheck.status}`);
  }
  if (updatedCheck.customerId !== "party-ahmet") {
    throw new Error(`Beklenen: party-ahmet, Gelen: ${updatedCheck.customerId}`);
  }

  // 5. Cari Ekstresini ve Yeni Bakiyeyi Doğrula
  const partyAfter = await api(`/api/v1/firms/${FIRM_ID}/branches/${BRANCH_ID}/caris/party-ahmet`, {
    headers: { "X-Demo-Actor": "manager-single" }
  });
  const expectedBalance = partyBefore.customerBalanceMinor + 26000;
  console.log(`[5] Ahmet Yılmaz Yeni Bakiyesi: ${partyAfter.customerBalanceMinor / 100} TL (Beklenen: ${expectedBalance / 100} TL)`);
  if (partyAfter.customerBalanceMinor !== expectedBalance) {
    throw new Error(`Bakiye uyuşmazlığı! Beklenen: ${expectedBalance}, Gelen: ${partyAfter.customerBalanceMinor}`);
  }

  // Son hareketin detaylarını kontrol et
  const latestMovement = partyAfter.movements[partyAfter.movements.length - 1];
  console.log(`    Son Cari Hareketi:`, {
    id: latestMovement.id,
    entryType: latestMovement.entryType,
    deltaMinor: latestMovement.deltaMinor,
    source: latestMovement.source,
    reference: latestMovement.reference,
    description: latestMovement.description
  });

  if (latestMovement.entryType !== "customer_charge") {
    throw new Error(`Beklenen entryType: customer_charge, Gelen: ${latestMovement.entryType}`);
  }
  if (latestMovement.source !== "sales") {
    throw new Error(`Beklenen source: sales, Gelen: ${latestMovement.source}`);
  }
  if (latestMovement.deltaMinor !== 26000) {
    throw new Error(`Beklenen deltaMinor: 26000, Gelen: ${latestMovement.deltaMinor}`);
  }

  console.log("\n✅ FAZ 7 TESTİ BAŞARIYLA TAMAMLANDI!");
}

run().catch((err) => {
  console.error("❌ TEST BAŞARISIZ:", err);
  process.exit(1);
});
