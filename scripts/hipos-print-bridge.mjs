#!/usr/bin/env node
/**
 * HIPOS Yerel Yazıcı Köprüsü v2 (HIPOS Cloud/LAN Print Bridge)
 *
 * Restoran içindeki (Kasa / Mutfak / Bar PC veya Raspberry Pi) tek bir makinede çalışır.
 * Bulut veya yerel HIPOS API'sine SSE (Server-Sent Events) üzerinden yalnızca
 * şubeye özel "bridge" JWT'si ile bağlanır ve:
 *   1. Mutfak ("kitchen"), Bar / İçecek ("bar") ve Kasa ("cashier") fiş işlerini alır.
 *   2. Ağ yazıcılarına (TCP Port 9100) veya bilgisayara USB ile bağlı yazıcılara
 *      (Windows Spooler RAW API / macOS & Linux CUPS raw `lp`) doğrudan basar.
 *   3. Web paneline canlı köprü durumu + bağlı USB yazıcı listesi kalp atışı gönderir.
 *
 * Kullanım:
 *   node scripts/hipos-print-bridge.mjs --config ./hipos-bridge.config.json
 *   node scripts/hipos-print-bridge.mjs --url "https://hipos.hayatisleri.com.tr" --token "<BRIDGE_JWT>"
 *   node scripts/hipos-print-bridge.mjs --list-printers
 */

import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const BRIDGE_VERSION = "2.0.0";

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
function loadFileConfig() {
  const explicitPath = getArg("config") || process.env.HIPOS_BRIDGE_CONFIG;
  const candidates = explicitPath
    ? [path.resolve(process.cwd(), explicitPath)]
    : [
        path.join(process.cwd(), "hipos-bridge.config.json"),
        path.join(scriptDir, "hipos-bridge.config.json"),
      ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        console.log(`[CFG] Yapılandırma dosyası yüklendi: ${filePath}`);
        return parsed ?? {};
      } catch (err) {
        console.error(`[HATA] Yapılandırma dosyası okunamadı (${filePath}):`, err.message);
        process.exit(1);
      }
    }
  }
  return {};
}

function decodeJwtClaims(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const payload = Buffer.from(parts[1], "base64url").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface ?? []) {
      if (addr && addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

let cachedWindowsPrintersErrorLogged = false;

async function discoverLocalPrinters() {
  const platform = process.platform;
  const discovered = [];

  try {
    if (platform === "darwin" || platform === "linux") {
      try {
        const { stdout } = await execFileAsync("lpstat", ["-p", "-d"], { timeout: 4000 });
        let defaultName = null;
        for (const rawLine of stdout.split("\n")) {
          const line = rawLine.trim();
          const defMatch = line.match(/^system default destination:\s*(.+)$/i);
          if (defMatch) {
            defaultName = defMatch[1].trim();
            continue;
          }
          const printerMatch = line.match(/^printer\s+(\S+)\s+/i);
          if (printerMatch) {
            const name = printerMatch[1].trim();
            discovered.push({
              name,
              port: "CUPS",
              driver: platform === "darwin" ? "macOS CUPS" : "Linux CUPS",
              isDefault: false,
            });
          }
        }
        if (defaultName) {
          for (const p of discovered) {
            if (p.name === defaultName) p.isDefault = true;
          }
        }
      } catch {
        // lpstat mevcut değilse veya hiç yazıcı tanımlı değilse devam et
      }

      if (platform === "darwin" && fs.existsSync("/usr/libexec/cups/backend/usb")) {
        try {
          const { stdout } = await execFileAsync("/usr/libexec/cups/backend/usb", [], { timeout: 4000 });
          for (const rawLine of stdout.split("\n")) {
            const line = rawLine.trim();
            if (line.toLowerCase().startsWith("direct usb://")) {
              const uri = line.split(" ")[1] ?? "usb://direct";
              discovered.push({
                name: uri,
                port: "USB-Direct",
                driver: "macOS Direct USB (CUPS Backend)",
                isDefault: discovered.length === 0,
              });
            }
          }
        } catch {
          // Direct USB taraması sessizce geçilebilir
        }
      }
    } else if (platform === "win32") {
      try {
        const { stdout } = await execFileAsync(
          "powershell",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Printer | Select-Object Name,PortName,DriverName,Default | ConvertTo-Json -Compress",
          ],
          { timeout: 6000 },
        );
        const trimmed = stdout.trim();
        if (trimmed) {
          const parsed = JSON.parse(trimmed);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of list) {
            if (item?.Name) {
              discovered.push({
                name: String(item.Name),
                port: item.PortName ? String(item.PortName) : "USB",
                driver: item.DriverName ? String(item.DriverName) : "Windows Spooler",
                isDefault: Boolean(item.Default),
              });
            }
          }
        }
      } catch (err) {
        if (!cachedWindowsPrintersErrorLogged) {
          cachedWindowsPrintersErrorLogged = true;
          console.warn("[WARN] Windows yazıcı listesi alınamadı:", err.message);
        }
      }
    }
  } catch {
    // Yazıcı taraması hata verirse köprü çalışmaya devam etmeli
  }

  return discovered;
}

if (hasFlag("list-printers")) {
  const list = await discoverLocalPrinters();
  console.log("Bulunan Yerel / USB Yazıcılar:");
  if (list.length === 0) {
    console.log("  (Hiç yazıcı bulunamadı)");
  } else {
    for (const p of list) {
      console.log(`  - ${p.name}  [Port: ${p.port}, Sürücü: ${p.driver}${p.isDefault ? ", Varsayılan" : ""}]`);
    }
  }
  process.exit(0);
}

const fileConfig = loadFileConfig();
let activeToken = getArg("token") || process.env.HIPOS_BRIDGE_TOKEN || fileConfig.token || "";
const decodedClaims = activeToken ? decodeJwtClaims(activeToken) : {};

const CONFIG = {
  cloudUrl: (
    getArg("url") ||
    process.env.HIPOS_API_URL ||
    process.env.HIPOS_CLOUD_URL ||
    fileConfig.cloudUrl ||
    fileConfig.url ||
    "http://127.0.0.1:5180"
  ).replace(/\/+$/, ""),
  firmId:
    getArg("firm") ||
    process.env.HIPOS_FIRM_ID ||
    fileConfig.firmId ||
    decodedClaims.firmId ||
    "",
  branchId:
    getArg("branch") ||
    process.env.HIPOS_BRANCH_ID ||
    fileConfig.branchId ||
    decodedClaims.branchId ||
    "",
  token: activeToken,
  email: getArg("email") || process.env.HIPOS_BRIDGE_EMAIL || fileConfig.email || "",
  password: getArg("password") || process.env.HIPOS_BRIDGE_PASSWORD || fileConfig.password || "",
  bridgeId:
    getArg("bridge-id") ||
    process.env.HIPOS_BRIDGE_ID ||
    fileConfig.bridgeId ||
    os.hostname(),
  overrides: {
    kitchen: {
      ip: getArg("kitchen-ip") || process.env.KITCHEN_PRINTER_IP || fileConfig.kitchen?.ip || null,
      port: Number(getArg("kitchen-port") || process.env.KITCHEN_PRINTER_PORT || fileConfig.kitchen?.port || 0) || null,
      systemPrinterName: getArg("kitchen-usb") || process.env.KITCHEN_SYSTEM_PRINTER || fileConfig.kitchen?.systemPrinterName || null,
      type: getArg("kitchen-usb") ? "Usb" : fileConfig.kitchen?.type || null,
    },
    bar: {
      ip: getArg("bar-ip") || process.env.BAR_PRINTER_IP || fileConfig.bar?.ip || null,
      port: Number(getArg("bar-port") || process.env.BAR_PRINTER_PORT || fileConfig.bar?.port || 0) || null,
      systemPrinterName: getArg("bar-usb") || process.env.BAR_SYSTEM_PRINTER || fileConfig.bar?.systemPrinterName || null,
      type: getArg("bar-usb") ? "Usb" : fileConfig.bar?.type || null,
    },
    cashier: {
      ip: getArg("cashier-ip") || process.env.CASHIER_PRINTER_IP || fileConfig.cashier?.ip || null,
      port: Number(getArg("cashier-port") || process.env.CASHIER_PRINTER_PORT || fileConfig.cashier?.port || 0) || null,
      systemPrinterName: getArg("cashier-usb") || process.env.CASHIER_SYSTEM_PRINTER || fileConfig.cashier?.systemPrinterName || null,
      type: getArg("cashier-usb") ? "Usb" : fileConfig.cashier?.type || null,
    },
  },
};

let remotePrinterConfig = {
  kitchenPrinter: { name: "Mutfak Yazıcısı", type: "Network", enabled: true, ipAddress: "192.168.1.116", port: 9100, systemPrinterName: null },
  barPrinter: { name: "Bar / İçecek Yazıcısı", type: "Disabled", enabled: false, ipAddress: "192.168.1.117", port: 9100, systemPrinterName: null },
  cashierPrinter: { name: "Kasa Yazıcısı", type: "Usb", enabled: true, ipAddress: "192.168.1.100", port: 9100, systemPrinterName: null },
};

let availablePrinters = [];
let activeStreamConnectionId = null;
let lastJobResult = null;
let heartbeatTimer = null;

function getEffectiveTargetConfig(targetKey) {
  const key = targetKey === "bar" || targetKey === "drink"
    ? "bar"
    : targetKey === "cashier"
      ? "cashier"
      : "kitchen";

  const remote = key === "bar"
    ? remotePrinterConfig.barPrinter
    : key === "cashier"
      ? remotePrinterConfig.cashierPrinter
      : remotePrinterConfig.kitchenPrinter;

  const ov = CONFIG.overrides[key];
  const base = remote ?? { name: key, type: "Network", enabled: true, ipAddress: "127.0.0.1", port: 9100, systemPrinterName: null };

  const type = ov.type || base.type || "Network";
  const enabled = ov.type ? ov.type !== "Disabled" : base.enabled !== false && type !== "Disabled";
  return {
    key,
    name: base.name || key,
    type,
    enabled,
    ipAddress: ov.ip || base.ipAddress || "127.0.0.1",
    port: ov.port || Number(base.port) || 9100,
    systemPrinterName: ov.systemPrinterName || base.systemPrinterName || null,
  };
}

function sendTcpRaw(ip, port, rawBuffer) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(4000);

    client.connect(port, ip, () => {
      client.write(rawBuffer, (err) => {
        if (err) {
          client.destroy();
          reject(err);
        } else {
          client.end();
          resolve(`Network (${ip}:${port})`);
        }
      });
    });

    client.on("timeout", () => {
      client.destroy();
      reject(new Error(`Yazıcı (${ip}:${port}) zaman aşımına uğradı`));
    });

    client.on("error", (err) => {
      client.destroy();
      reject(err);
    });
  });
}

function pickLocalQueueName(preferredName, printers) {
  if (preferredName && preferredName.trim()) {
    return preferredName.trim();
  }
  const thermalMatch = printers.find((p) =>
    /mutfak|kasa|pos|thermal|receipt|kodpos|gprinter|generic|xp-80|epson/i.test(p.name),
  );
  if (thermalMatch) return thermalMatch.name;
  const def = printers.find((p) => p.isDefault);
  return def ? def.name : printers[0]?.name ?? null;
}

async function sendLocalUsbRaw(preferredName, rawBuffer) {
  if (availablePrinters.length === 0) {
    availablePrinters = await discoverLocalPrinters();
  }

  const chosen = pickLocalQueueName(preferredName, availablePrinters);
  const tmpFile = path.join(os.tmpdir(), `hipos_bridge_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.bin`);
  fs.writeFileSync(tmpFile, rawBuffer);

  try {
    if (process.platform === "darwin" || process.platform === "linux") {
      if (chosen && chosen.startsWith("usb://") && fs.existsSync("/usr/libexec/cups/backend/usb")) {
        await execFileAsync("/usr/libexec/cups/backend/usb", ["1", "hipos", "print", "1", "", tmpFile], {
          env: { ...process.env, DEVICE_URI: chosen },
          timeout: 8000,
        });
        return `USB-Direct (${chosen})`;
      }

      if (!chosen) {
        if (process.platform === "darwin" && fs.existsSync("/usr/libexec/cups/backend/usb")) {
          const direct = availablePrinters.find((p) => p.name.startsWith("usb://"));
          if (direct) {
            await execFileAsync("/usr/libexec/cups/backend/usb", ["1", "hipos", "print", "1", "", tmpFile], {
              env: { ...process.env, DEVICE_URI: direct.name },
              timeout: 8000,
            });
            return `USB-Direct (${direct.name})`;
          }
        }
        throw new Error("Bu bilgisayarda USB/CUPS yazıcı kuyruğu bulunamadı. Lütfen yazıcı adını seçin veya ekleyin.");
      }

      await execFileAsync("lp", ["-d", chosen, "-o", "raw", tmpFile], { timeout: 8000 });
      return `CUPS (${chosen})`;
    }

    if (process.platform === "win32") {
      if (!chosen) {
        throw new Error("Windows yazıcı kuyruğu bulunamadı (KodPOS / Mutfak / Generic).");
      }

      const psScript = `
$printer = $env:HIPOS_RAW_PRINTER
$filePath = $env:HIPOS_RAW_FILE
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$src = @"
using System;
using System.Runtime.InteropServices;
public class HiposRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    public static bool Send(string name, byte[] data) {
        IntPtr h;
        if (!OpenPrinter(name, out h, IntPtr.Zero)) return false;
        var di = new DOCINFOA { pDocName = "HIPOS Print Bridge", pDataType = "RAW" };
        bool ok = false;
        if (StartDocPrinter(h, 1, di) != 0) {
            if (StartPagePrinter(h)) {
                IntPtr ptr = Marshal.AllocCoTaskMem(data.Length);
                Marshal.Copy(data, 0, ptr, data.Length);
                int written = 0;
                ok = WritePrinter(h, ptr, data.Length, out written);
                Marshal.FreeCoTaskMem(ptr);
                EndPagePrinter(h);
            }
            EndDocPrinter(h);
        }
        ClosePrinter(h);
        return ok;
    }
}
"@
Add-Type -TypeDefinition $src -ErrorAction SilentlyContinue
if (-not [HiposRawPrinter]::Send($printer, $bytes)) {
    throw "Win32 OpenPrinter/WritePrinter basarisiz: $printer"
}
`;
      await execFileAsync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
        env: { ...process.env, HIPOS_RAW_PRINTER: chosen, HIPOS_RAW_FILE: tmpFile },
        timeout: 12000,
      });
      return `Windows Spooler (${chosen})`;
    }

    throw new Error(`Desteklenmeyen işletim sistemi USB yazdırması: ${process.platform}`);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Temp silinemese de devam et
    }
  }
}

async function deliverEscPosJob(job) {
  const targetKey = job.target || "kitchen";
  const cfg = getEffectiveTargetConfig(targetKey);
  if (!job.rawEscPosBase64) return;

  const rawBuffer = Buffer.from(job.rawEscPosBase64, "base64");
  const targetLabel = targetKey === "cashier"
    ? "KASA FİŞİ"
    : targetKey === "bar"
      ? "BAR / İÇECEK FİŞİ"
      : "MUTFAK FİŞİ";

  if (!cfg.enabled || cfg.type === "Disabled") {
    const msg = `${targetLabel} (${cfg.name}) devre dışı bırakılmış — basım atlandı.`;
    console.warn(`[WARN] ${msg}`);
    lastJobResult = {
      jobId: job.jobId ?? null,
      target: targetKey,
      success: false,
      transport: "Disabled",
      message: msg,
      at: new Date().toISOString(),
    };
    void sendHeartbeat(false);
    return;
  }

  console.log(`[İŞ] ${targetLabel} (${rawBuffer.length} bayt) -> ${cfg.type} [${cfg.type === "Usb" ? (cfg.systemPrinterName || "Otomatik USB") : `${cfg.ipAddress}:${cfg.port}`}]`);

  try {
    let transportLabel;
    if (cfg.type === "Usb") {
      transportLabel = await sendLocalUsbRaw(cfg.systemPrinterName, rawBuffer);
    } else if (cfg.type === "Console") {
      transportLabel = "Console";
    } else {
      transportLabel = await sendTcpRaw(cfg.ipAddress, cfg.port, rawBuffer);
    }

    console.log(`[OK] ${targetLabel} başarıyla basıldı! (${transportLabel})`);
    lastJobResult = {
      jobId: job.jobId ?? null,
      target: targetKey,
      success: true,
      transport: transportLabel,
      message: `${targetLabel} yazdırıldı`,
      at: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[HATA] ${targetLabel} yazdırılamadı:`, err.message);
    lastJobResult = {
      jobId: job.jobId ?? null,
      target: targetKey,
      success: false,
      transport: cfg.type,
      message: err.message,
      at: new Date().toISOString(),
    };
  }

  void sendHeartbeat(false);
}

console.log("==================================================");
console.log(`  HIPOS PRINT BRIDGE v${BRIDGE_VERSION}`);
console.log("==================================================");
console.log(`  Hedef API : ${CONFIG.cloudUrl}`);

async function ensureAuthenticated() {
  if (CONFIG.token) {
    const claims = decodeJwtClaims(CONFIG.token);
    if (!CONFIG.firmId && claims.firmId) CONFIG.firmId = claims.firmId;
    if (!CONFIG.branchId && claims.branchId) CONFIG.branchId = claims.branchId;
    if (CONFIG.firmId && CONFIG.branchId) return;
  }

  if (!CONFIG.email || !CONFIG.password) {
    console.error("[HATA] Kimlik bilgisi eksik!");
    console.error("  1. Admin > Şubeler sayfasından 'hipos-bridge.config.json' indirin veya --token verin.");
    console.error("  2. Ya da --email/--password ile yönetici hesabı belirtin.");
    process.exit(1);
  }

  console.log(`[AUTH] ${CONFIG.email} ile oturum açılıyor...`);
  const loginRes = await fetch(`${CONFIG.cloudUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: CONFIG.email, password: CONFIG.password }),
  });

  if (!loginRes.ok) {
    throw new Error(`Oturum açılamadı (HTTP ${loginRes.status}).`);
  }

  const loginData = await loginRes.json();
  const userToken = loginData.token;
  if (!CONFIG.firmId) CONFIG.firmId = loginData.firm?.id || "";
  if (!CONFIG.branchId) CONFIG.branchId = loginData.branch?.id || loginData.branches?.[0]?.id || "";

  if (!CONFIG.firmId || !CONFIG.branchId) {
    throw new Error("Hesaptan firma/şube kapsamı çözülemedi. --firm ve --branch parametrelerini verin.");
  }

  const bridgeRes = await fetch(
    `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(CONFIG.firmId)}/branches/${encodeURIComponent(CONFIG.branchId)}/printing/bridge-token`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    },
  );

  if (bridgeRes.ok) {
    const bridgeData = await bridgeRes.json();
    CONFIG.token = bridgeData.token;
    console.log(`[AUTH] Şube özel 'bridge' JWT tokenı alındı (365 gün).`);
  } else {
    CONFIG.token = userToken;
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${CONFIG.token}`,
    Accept: "application/json",
  };
}

function applyRemoteConfig(data) {
  if (!data) return;
  if (data.kitchenPrinter) remotePrinterConfig.kitchenPrinter = data.kitchenPrinter;
  if (data.barPrinter) remotePrinterConfig.barPrinter = data.barPrinter;
  if (data.cashierPrinter) remotePrinterConfig.cashierPrinter = data.cashierPrinter;
}

async function syncPrinterConfig() {
  try {
    const res = await fetch(
      `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(CONFIG.firmId)}/branches/${encodeURIComponent(CONFIG.branchId)}/printing/config`,
      { headers: authHeaders() },
    );
    if (res.ok) {
      const data = await res.json();
      applyRemoteConfig(data);

      const k = getEffectiveTargetConfig("kitchen");
      const b = getEffectiveTargetConfig("bar");
      const c = getEffectiveTargetConfig("cashier");

      console.log(`[SYNC] Şube Yazıcı Hedefleri (${CONFIG.firmId}/${CONFIG.branchId}):`);
      console.log(`       Mutfak  : ${k.type} -> ${k.type === "Usb" ? (k.systemPrinterName || "Otomatik USB") : `${k.ipAddress}:${k.port}`}`);
      console.log(`       Bar     : ${b.enabled ? `${b.type} -> ${b.type === "Usb" ? (b.systemPrinterName || "Otomatik USB") : `${b.ipAddress}:${b.port}`}` : "Kapalı (İçecekler Mutfaktan Çıkar)"}`);
      console.log(`       Kasa    : ${c.type} -> ${c.type === "Usb" ? (c.systemPrinterName || "Otomatik USB") : `${c.ipAddress}:${c.port}`}`);
    } else {
      console.warn(`[WARN] Yazıcı ayarları sunucudan alınamadı (HTTP ${res.status})`);
    }
  } catch (err) {
    console.warn(`[WARN] Yapılandırma senkronizasyon hatası:`, err.message);
  }
}

async function sendHeartbeat(refreshPrinters = false) {
  try {
    if (refreshPrinters) {
      availablePrinters = await discoverLocalPrinters();
    }

    const res = await fetch(
      `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(CONFIG.firmId)}/branches/${encodeURIComponent(CONFIG.branchId)}/printing/bridge-heartbeat`,
      {
        method: "POST",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bridgeId: CONFIG.bridgeId,
          hostname: os.hostname(),
          platform: process.platform,
          localIps: getLocalIPv4Addresses(),
          version: BRIDGE_VERSION,
          streamConnectionId: activeStreamConnectionId,
          availablePrinters,
          lastJobResult,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[WARN] Köprü kalp atışı yanıtı HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[WARN] Köprü kalp atışı hatası:`, err.message);
  }
}

function handleSseEvent(rawBlock) {
  const lines = rawBlock.split(/\r?\n/);
  let eventType = "message";
  let dataLine = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLine += line.slice(5).trim();
    }
  }

  if (!dataLine) return;

  try {
    const parsed = JSON.parse(dataLine);
    if (eventType === "connected") {
      activeStreamConnectionId = parsed?.bridgeConnectionId ?? null;
      void sendHeartbeat(true);
      return;
    }

    if (eventType === "printer.config.updated") {
      applyRemoteConfig(parsed?.data ?? parsed);
      console.log("[SYNC] Panelden yazıcı ayarı güncellendi — yeni hedefler uygulandı.");
      return;
    }

    if (eventType === "print.job" || parsed?.type === "print.job") {
      const job = parsed?.data ?? parsed;
      void deliverEscPosJob(job);
    }
  } catch (err) {
    console.error("[HATA] SSE verisi çözümlenemedi:", err.message);
  }
}

async function connectSseLoop() {
  const sseUrl = `${CONFIG.cloudUrl}/api/v1/firms/${encodeURIComponent(CONFIG.firmId)}/branches/${encodeURIComponent(CONFIG.branchId)}/events/stream`;
  let reconnectDelayMs = 1500;

  while (true) {
    try {
      console.log(`[SSE] Bağlanılıyor -> ${sseUrl}`);
      const response = await fetch(sseUrl, {
        headers: {
          Authorization: `Bearer ${CONFIG.token}`,
          Accept: "text/event-stream",
        },
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} (${response.statusText})`);
      }

      console.log(`[OK] Bağlantı aktif — ${CONFIG.firmId}/${CONFIG.branchId} için SSE dinleniyor. Kapatmak için Ctrl+C.`);
      reconnectDelayMs = 1500;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => void sendHeartbeat(true), 45_000);

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let splitIdx;
        while ((splitIdx = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, splitIdx);
          buffer = buffer.slice(splitIdx + 2);
          if (eventBlock.trim() && !eventBlock.trim().startsWith(":")) {
            handleSseEvent(eventBlock);
          }
        }
      }
      console.warn("[WARN] SSE akışı sonlandı, yeniden bağlanılıyor...");
    } catch (err) {
      console.error(`[HATA] SSE bağlantısı kesildi (${err.message}). ${reconnectDelayMs / 1000}sn sonra tekrar denenecek...`);
      await new Promise((r) => setTimeout(r, reconnectDelayMs));
      reconnectDelayMs = Math.min(reconnectDelayMs * 1.5, 15000);
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  }
}

await ensureAuthenticated();
availablePrinters = await discoverLocalPrinters();
console.log(`  Algılanan Yerel Yazıcı Sayısı: ${availablePrinters.length}`);
for (const p of availablePrinters) {
  console.log(`    • ${p.name} [${p.port}]`);
}
await syncPrinterConfig();
await sendHeartbeat(false);
await connectSseLoop();
