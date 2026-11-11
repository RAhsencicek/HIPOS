#!/usr/bin/env node

/**
 * HIPOS — Cloud-to-Local Termal Yazıcı Köprüsü (Print Bridge)
 * -------------------------------------------------------------
 * Buluttaki HIPOS sunucusundan (örn. https://hipos.hayatisleri.com.tr) gelen
 * yazıcı işlerini (mutfak fişi, adisyon faturası, test çıktısı) SSE üzerinden
 * JWT kimlik doğrulamasıyla dinler ve yerel ağdaki (LAN) termal yazıcılara ESC/POS basar.
 *
 * Önerilen Kullanım (Admin Panel > İşletme & Şube Ayarları > Print Bridge Token ile):
 *   HIPOS_BRIDGE_TOKEN="eyJ..." node scripts/hipos-print-bridge.mjs
 *
 * Veya komut satırı argümanlarıyla:
 *   node scripts/hipos-print-bridge.mjs \
 *     --url https://hipos.hayatisleri.com.tr \
 *     --token "eyJ..." \
 *     --kitchen-ip 192.168.1.201 \
 *     --cashier-ip 192.168.1.202
 *
 * Alternatif Yönetici Girişiyle Otomatik Şube Tokenı:
 *   node scripts/hipos-print-bridge.mjs \
 *     --url https://hipos.hayatisleri.com.tr \
 *     --email patron@restoran.com --password "..." --firm <firmId> --branch <branchId>
 */

import net from 'net';

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eqIndex = token.indexOf('=');
    if (eqIndex !== -1) {
      const key = token.slice(2, eqIndex);
      args[key] = token.slice(eqIndex + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function decodeJwtClaims(jwt) {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const CLI = parseCliArgs(process.argv.slice(2));

const CONFIG = {
  cloudUrl: (CLI.url || process.env.HIPOS_CLOUD_URL || 'https://hipos.hayatisleri.com.tr').replace(/\/+$/, ''),
  firmId: CLI.firm || CLI.firmId || process.env.HIPOS_FIRM_ID || '',
  branchId: CLI.branch || CLI.branchId || process.env.HIPOS_BRANCH_ID || '',
  token: CLI.token || process.env.HIPOS_BRIDGE_TOKEN || process.env.HIPOS_TOKEN || '',
  email: CLI.email || process.env.HIPOS_EMAIL || '',
  password: CLI.password || process.env.HIPOS_PASSWORD || '',
  actor: CLI.actor || process.env.HIPOS_ACTOR || '',
  explicitKitchenIp: CLI['kitchen-ip'] || process.env.HIPOS_KITCHEN_PRINTER_IP || process.env.HIPOS_PRINTER_IP || '',
  explicitKitchenPort: CLI['kitchen-port'] || process.env.HIPOS_KITCHEN_PRINTER_PORT || '',
  explicitCashierIp: CLI['cashier-ip'] || process.env.HIPOS_CASHIER_PRINTER_IP || process.env.HIPOS_PRINTER_IP || '',
  explicitCashierPort: CLI['cashier-port'] || process.env.HIPOS_CASHIER_PRINTER_PORT || '',
  reconnectDelayMs: 3000,
};

let runtimePrinters = {
  kitchenIp: CONFIG.explicitKitchenIp || '192.168.1.201',
  kitchenPort: parseInt(CONFIG.explicitKitchenPort || '9100', 10),
  cashierIp: CONFIG.explicitCashierIp || '192.168.1.201',
  cashierPort: parseInt(CONFIG.explicitCashierPort || '9100', 10),
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
    const ip = isKitchen ? runtimePrinters.kitchenIp : runtimePrinters.cashierIp;
    const port = isKitchen ? runtimePrinters.kitchenPort : runtimePrinters.cashierPort;

    await sendToThermalPrinter(ip, port, rawBuffer, {
      type: jobData.type || target,
      tableName: jobData.tableName,
      target
    });
  } catch (err) {
    console.error(`[${formatNow()}] ❌ print.job işlenirken hata oluştu:`, err);
  }
}

async function resolveAuthAndScope() {
  let activeToken = CONFIG.token;
  let firmId = CONFIG.firmId;
  let branchId = CONFIG.branchId;

  if (!activeToken && CONFIG.email && CONFIG.password) {
    console.log(`[${formatNow()}] 🔐 Yönetici kimlik bilgileriyle oturum açılıyor (${CONFIG.email})...`);
    const loginRes = await fetch(`${CONFIG.cloudUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CONFIG.email, password: CONFIG.password }),
    });
    if (!loginRes.ok) {
      throw new Error(`Login başarısız (HTTP ${loginRes.status}).`);
    }
    const loginData = await loginRes.json();
    activeToken = loginData.token;
    firmId = firmId || loginData.user?.firmId || '';
    branchId = branchId || loginData.user?.branchId || '';

    if (firmId && branchId && (firmId !== loginData.user?.firmId || branchId !== loginData.user?.branchId)) {
      const switchRes = await fetch(`${CONFIG.cloudUrl}/api/v1/auth/switch-scope`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ firmId, branchId }),
      });
      if (!switchRes.ok) {
        throw new Error(`Seçilen şube kapsamına geçilemedi (HTTP ${switchRes.status}).`);
      }
      const switched = await switchRes.json();
      activeToken = switched.token;
    }

    if (firmId && branchId) {
      const bridgeRes = await fetch(
        `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/bridge-token`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${activeToken}` },
        }
      );
      if (bridgeRes.ok) {
        const bridgeData = await bridgeRes.json();
        if (bridgeData.token) {
          activeToken = bridgeData.token;
          console.log(`[${formatNow()}] 🔑 Şubeye özel uzun ömürlü Print Bridge token alındı.`);
        }
      }
    }
  }

  if (activeToken) {
    const claims = decodeJwtClaims(activeToken);
    if (!firmId && claims?.firmId) firmId = String(claims.firmId);
    if (!branchId && claims?.branchId) branchId = String(claims.branchId);
  }

  if (!activeToken && !CONFIG.actor) {
    console.error('❌ Kimlik doğrulaması yapılmadı.');
    console.error('   Çözüm 1: Admin Panel > İşletme & Şube Ayarları içinden "Print Bridge Token Oluştur" deyip');
    console.error('            HIPOS_BRIDGE_TOKEN="..." node scripts/hipos-print-bridge.mjs ile çalıştırın.');
    console.error('   Çözüm 2: --email / --password (--firm / --branch) argümanlarını verin.');
    console.error('   Not (Yalnız Geliştirme Ortamı): Yerel geliştirme modunda --actor pos-single kullanılabilir.');
    process.exit(1);
  }

  if (!firmId || !branchId) {
    console.error('❌ İşletme (firmId) veya şube (branchId) bilgisi belirlenemedi. --firm ve --branch parametrelerini girin.');
    process.exit(1);
  }

  return { activeToken, firmId, branchId };
}

async function syncPrinterConfigFromServer(firmId, branchId, activeToken) {
  try {
    const headers = {};
    if (activeToken) {
      headers['Authorization'] = `Bearer ${activeToken}`;
    } else if (CONFIG.actor) {
      headers['X-Demo-Actor'] = CONFIG.actor;
    }

    const res = await fetch(
      `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(firmId)}/branches/${encodeURIComponent(branchId)}/printing/config`,
      { headers }
    );
    if (!res.ok) return;
    const cfg = await res.json();
    runtimePrinters = {
      kitchenIp: CONFIG.explicitKitchenIp || cfg.kitchenIp || runtimePrinters.kitchenIp,
      kitchenPort: CONFIG.explicitKitchenPort ? parseInt(CONFIG.explicitKitchenPort, 10) : (cfg.kitchenPort || runtimePrinters.kitchenPort),
      cashierIp: CONFIG.explicitCashierIp || cfg.cashierIp || runtimePrinters.cashierIp,
      cashierPort: CONFIG.explicitCashierPort ? parseInt(CONFIG.explicitCashierPort, 10) : (cfg.cashierPort || runtimePrinters.cashierPort),
    };
  } catch {
    // Sunucudaki config okunamazsa yerel CLI / varsayılan değerler korunur
  }
}

async function startBridge() {
  let authState = await resolveAuthAndScope();
  await syncPrinterConfigFromServer(authState.firmId, authState.branchId, authState.activeToken);

  const buildStreamUrl = (state) => {
    const base = `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(state.firmId)}/branches/${encodeURIComponent(state.branchId)}/events/stream`;
    if (state.activeToken) return base;
    return `${base}?actor=${encodeURIComponent(CONFIG.actor)}`;
  };

  console.log('='.repeat(70));
  console.log('🚀 HIPOS — Cloud-to-Local Termal Yazıcı Köprüsü Başlatıldı');
  console.log(`🌐 Bulut Sunucu:     ${CONFIG.cloudUrl}`);
  console.log(`🏢 Şube Kapsamı:     Firm=${authState.firmId} | Branch=${authState.branchId}`);
  console.log(`🔐 Kimlik Modu:      ${authState.activeToken ? 'JWT Bearer (Güvenli)' : `Demo Actor (${CONFIG.actor})`}`);
  console.log(`📡 Mutfak Yazıcısı:  ${runtimePrinters.kitchenIp}:${runtimePrinters.kitchenPort}`);
  console.log(`💰 Kasa Yazıcısı:    ${runtimePrinters.cashierIp}:${runtimePrinters.cashierPort}`);
  console.log(`🔗 Akış URL:         ${buildStreamUrl(authState)}`);
  console.log('='.repeat(70));

  while (true) {
    try {
      console.log(`[${formatNow()}] 🔄 Sunucuya bağlanılıyor...`);
      const headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      if (authState.activeToken) {
        headers['Authorization'] = `Bearer ${authState.activeToken}`;
      } else if (CONFIG.actor) {
        headers['X-Demo-Actor'] = CONFIG.actor;
      }

      const response = await fetch(buildStreamUrl(authState), { headers });

      if (response.status === 401 && CONFIG.email && CONFIG.password) {
        console.warn(`[${formatNow()}] 🔑 Token süresi doldu veya geçersiz; oturum yenileniyor...`);
        authState = await resolveAuthAndScope();
        await syncPrinterConfigFromServer(authState.firmId, authState.branchId, authState.activeToken);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      await syncPrinterConfigFromServer(authState.firmId, authState.branchId, authState.activeToken);
      console.log(`[${formatNow()}] 🟢 Bağlantı aktif! Yazıcı işleri dinleniyor...`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentEvent = 'message';
            continue;
          }

          if (trimmed.startsWith(':')) {
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
                console.log(`[${formatNow()}] 🤝 ${parsed.message || 'Sunucu el sıkışması tamamlandı.'}`);
              }
            } catch {
              // JSON olmayan satır yoksayılır
            }
          }
        }
      }

      console.warn(`[${formatNow()}] ⚠️ Akış kapandı. Yeniden bağlanılacak...`);
    } catch (err) {
      console.error(`[${formatNow()}] 🔴 Bağlantı hatası: ${err.message}. ${CONFIG.reconnectDelayMs / 1000} saniye içinde tekrar deneniyor...`);
    }

    await new Promise((res) => setTimeout(res, CONFIG.reconnectDelayMs));
  }
}

startBridge().catch((err) => {
  console.error('❌ Print Bridge başlatılamadı:', err.message);
  process.exit(1);
});
