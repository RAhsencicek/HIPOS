#!/usr/bin/env node

/**
 * HIPOS — Cloud-to-Local Termal Yazıcı Köprüsü (Print Bridge)
 * -------------------------------------------------------------
 * Buluttaki HIPOS sunucusundan (https://hipos.hayatisleri.com.tr) gelen
 * yazıcı işlerini (mutfak fişi, adisyon faturası, test çıktısı) SSE üzerinden
 * anlık dinler ve yerel ağdaki (LAN) termal yazıcılara ESC/POS olarak basar.
 *
 * Kullanım:
 *   node scripts/hipos-print-bridge.mjs
 * veya çevre değişkenleriyle:
 *   HIPOS_PRINTER_IP=192.168.1.201 node scripts/hipos-print-bridge.mjs
 */

import net from 'net';

const CONFIG = {
  cloudUrl: process.env.HIPOS_CLOUD_URL || 'https://hipos.hayatisleri.com.tr',
  firmId: process.env.HIPOS_FIRM_ID || '11111111-1111-4111-8111-111111111111',
  branchId: process.env.HIPOS_BRANCH_ID || '33333333-3333-4333-8333-333333333333',
  actor: process.env.HIPOS_ACTOR || 'pos-single',
  kitchenPrinterIp: process.env.HIPOS_KITCHEN_PRINTER_IP || process.env.HIPOS_PRINTER_IP || '192.168.1.201',
  kitchenPrinterPort: parseInt(process.env.HIPOS_KITCHEN_PRINTER_PORT || '9100', 10),
  cashierPrinterIp: process.env.HIPOS_CASHIER_PRINTER_IP || process.env.HIPOS_PRINTER_IP || '192.168.1.201',
  cashierPrinterPort: parseInt(process.env.HIPOS_CASHIER_PRINTER_PORT || '9100', 10),
  reconnectDelayMs: 3000,
};

function formatNow() {
  return new Date().toLocaleTimeString('tr-TR', { hour12: false });
}

function sendToThermalPrinter(ip, port, rawBuffer, jobInfo) {
  return new Promise((resolve) => {
    const label = `[${formatNow()}] [🖨️ ${jobInfo.type?.toUpperCase() || 'İŞ'}]`;
    const socket = new net.Socket();
    let finished = false;

    socket.setTimeout(4000);

    socket.connect(port, ip, () => {
      socket.write(rawBuffer, () => {
        socket.end();
      });
    });

    socket.on('close', () => {
      if (!finished) {
        finished = true;
        console.log(`${label} ✅ Yazıcıya başarıyla aktarıldı -> ${ip}:${port} (${rawBuffer.length} bayt) | Masa: ${jobInfo.tableName || '-'}`);
        resolve({ success: true });
      }
    });

    socket.on('timeout', () => {
      if (!finished) {
        finished = true;
        console.error(`${label} ⚠️ Zaman aşımı (4s) -> ${ip}:${port}`);
        socket.destroy();
        resolve({ success: false, error: 'Timeout' });
      }
    });

    socket.on('error', (err) => {
      if (!finished) {
        finished = true;
        console.error(`${label} ❌ Bağlantı hatası -> ${ip}:${port}: ${err.message}`);
        socket.destroy();
        resolve({ success: false, error: err.message });
      }
    });
  });
}

async function handlePrintJob(eventPayload) {
  try {
    const jobData = eventPayload.data || eventPayload;
    const target = (jobData.target || 'kitchen').toLowerCase();
    const rawBase64 = jobData.rawEscPosBase64;

    if (!rawBase64) {
      console.warn(`[${formatNow()}] ⚠️ Gelen print.job içinde rawEscPosBase64 bulunamadı.`);
      return;
    }

    const rawBuffer = Buffer.from(rawBase64, 'base64');
    const isKitchen = target === 'kitchen';
    const ip = isKitchen ? CONFIG.kitchenPrinterIp : CONFIG.cashierPrinterIp;
    const port = isKitchen ? CONFIG.kitchenPrinterPort : CONFIG.cashierPrinterPort;

    await sendToThermalPrinter(ip, port, rawBuffer, {
      type: jobData.type || target,
      tableName: jobData.tableName,
      target
    });
  } catch (err) {
    console.error(`[${formatNow()}] ❌ print.job işlenirken hata oluştu:`, err);
  }
}

async function startBridge() {
  const streamUrl = `${CONFIG.cloudUrl}/api/v1/firms/${CONFIG.firmId}/branches/${CONFIG.branchId}/events/stream?actor=${CONFIG.actor}`;

  console.log('='.repeat(70));
  console.log('🚀 HIPOS — Cloud-to-Local Termal Yazıcı Köprüsü Başlatıldı');
  console.log(`🌐 Bulut Sunucu:     ${CONFIG.cloudUrl}`);
  console.log(`📡 Mutfak Yazıcısı:  ${CONFIG.kitchenPrinterIp}:${CONFIG.kitchenPrinterPort}`);
  console.log(`💰 Kasa Yazıcısı:    ${CONFIG.cashierPrinterIp}:${CONFIG.cashierPrinterPort}`);
  console.log(`🔗 Eşzamanlılık URL: ${streamUrl}`);
  console.log('='.repeat(70));

  while (true) {
    try {
      console.log(`[${formatNow()}] 🔄 Bulut sunucuya bağlanılıyor...`);
      const response = await fetch(streamUrl, {
        headers: {
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      console.log(`[${formatNow()}] 🟢 Bulut bağlantısı aktif! Yazıcı işleri dinleniyor...`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      let currentEvent = 'message';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // son tamamlanmamış satırı tut

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith(':')) {
            // Heartbeat / ping
            continue;
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.replace('event:', '').trim();
            continue;
          }

          if (trimmed.startsWith('data:')) {
            const rawJson = trimmed.replace('data:', '').trim();
            try {
              const parsed = JSON.parse(rawJson);
              if (currentEvent === 'print.job' || parsed.type === 'print.job') {
                await handlePrintJob(parsed);
              } else if (currentEvent === 'connected') {
                console.log(`[${formatNow()}] 🤝 ${parsed.message || 'Bulut el sıkışması tamamlandı.'}`);
              }
            } catch (jsonErr) {
              // JSON parse hatası veya düz metin
            }
          }
        }
      }

      console.warn(`[${formatNow()}] ⚠️ Bulut akışı kapandı. Yeniden bağlanılacak...`);
    } catch (err) {
      console.error(`[${formatNow()}] 🔴 Bağlantı hatası: ${err.message}. ${CONFIG.reconnectDelayMs / 1000} saniye içinde tekrar deneniyor...`);
    }

    await new Promise((res) => setTimeout(res, CONFIG.reconnectDelayMs));
  }
}

startBridge();
