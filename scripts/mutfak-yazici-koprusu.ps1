param(
    [string]$PrinterName = "Mutfak",
    [int]$Port = 9100
)

# 1. Win32 Raw Print Helper Sınıfı (Paylaşım gerektirmeden doğrudan Windows Spooler'a yazar)
$rawPrinterHelperSource = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "HIPOS Mutfak Fisi";
        di.pDataType = "RAW";

        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            return false;
        }

        bool success = false;
        if (StartDocPrinter(hPrinter, 1, di) != 0) {
            if (StartPagePrinter(hPrinter)) {
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                int dwWritten = 0;
                success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                Marshal.FreeCoTaskMem(pUnmanagedBytes);
                EndPagePrinter(hPrinter);
            }
            EndDocPrinter(hPrinter);
        }
        ClosePrinter(hPrinter);
        return success;
    }
}
"@

try {
    Add-Type -TypeDefinition $rawPrinterHelperSource -ErrorAction SilentlyContinue
} catch {}

# 2. Güvenlik Duvarı Kuralını Kontrol Et / Ekle (Port 9100)
try {
    netsh advfirewall firewall add rule name="HIPOS Mutfak Port 9100" dir=in action=allow protocol=TCP localport=$Port | Out-Null
} catch {}

# 3. Yüklü Yazıcıları Tara
$allPrinters = Get-Printer -ErrorAction SilentlyContinue
$targetPrinter = $null

if ($allPrinters) {
    # Önce adı tam eşleşen var mı bak
    $targetPrinter = $allPrinters | Where-Object { $_.Name -eq $PrinterName } | Select-Object -First 1
    
    # Yoksa adında Mutfak, POS, Generic, Thermal, Receipt veya KodPOS geçen var mı bak
    if (-not $targetPrinter) {
        $targetPrinter = $allPrinters | Where-Object { $_.Name -match "Mutfak|POS|Generic|Salt|Thermal|Receipt|KodPOS|Gprinter" } | Select-Object -First 1
    }
}

# Eğer hala bulunamadıysa ve Generic / Text Only sürücüsü varsa otomatik eklemeyi dene
if (-not $targetPrinter) {
    try {
        Add-Printer -Name "Mutfak" -DriverName "Generic / Text Only" -PortName "USB001" -ErrorAction Stop
        $targetPrinter = Get-Printer -Name "Mutfak" -ErrorAction SilentlyContinue
    } catch {}
}

$myIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -like '192.168.*' }).IPAddress | Select-Object -First 1
if (-not $myIp) {
    $myIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' }).IPAddress | Select-Object -First 1
}

Clear-Host
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "     HIPOS MUTFAK YAZICI KÖPRÜSÜ (WINDOWS PRINT SERVER)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Bu Bilgisayarın IP Adresi : $myIp" -ForegroundColor Yellow
Write-Host "  Dinlenen TCP Port         : $Port" -ForegroundColor Yellow

if ($targetPrinter) {
    Write-Host "  Hedef Yazıcı Kuyruğu      : $($targetPrinter.Name) (Port: $($targetPrinter.PortName))" -ForegroundColor Green
} else {
    Write-Host "  UYARI: 'Mutfak' veya 'Generic / Text Only' adında yazıcı bulunamadı!" -ForegroundColor Red
    Write-Host "  Lütfen Windows Ayarlar > Yazıcılar > Yazıcı Ekle > Generic / Text Only (USB001) ekleyin." -ForegroundColor Magenta
}

Write-Host "----------------------------------------------------------" -ForegroundColor Gray
Write-Host "  Mac'teki HIPOS bu IP'ye ($myIp`:$Port) mutfak fişi gönderecek." -ForegroundColor White
Write-Host "  Köprü çalışıyor... (Durdurmak için Ctrl+C)" -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$listener.Start()

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $ms = [System.IO.MemoryStream]::new()
        $buffer = New-Object byte[] 4096
        
        $client.ReceiveTimeout = 2000
        while ($true) {
            try {
                $read = $stream.Read($buffer, 0, $buffer.Length)
                if ($read -le 0) { break }
                $ms.Write($buffer, 0, $read)
            } catch {
                break
            }
        }
        
        $bytes = $ms.ToArray()
        if ($bytes.Length -gt 0) {
            $printerToUse = if ($targetPrinter) { $targetPrinter.Name } else { $PrinterName }
            $printed = $false
            
            # Yöntem 1: Doğrudan Windows Spooler API (Win32 Raw Data)
            try {
                $printed = [RawPrinterHelper]::SendBytesToPrinter($printerToUse, $bytes)
            } catch {}
            
            # Yöntem 2: Ağ Paylaşım Yolu (\\127.0.0.1\Yazıcı)
            if (-not $printed) {
                try {
                    $sharePath = "\\127.0.0.1\$printerToUse"
                    [System.IO.File]::WriteAllBytes($sharePath, $bytes)
                    $printed = $true
                } catch {}
            }
            
            # Yöntem 3: Doğrudan USB Portuna Yazma (USB001)
            if (-not $printed) {
                try {
                    [System.IO.File]::WriteAllBytes("\\.\USB001", $bytes)
                    $printed = $true
                } catch {}
            }
            
            $time = Get-Date -Format 'HH:mm:ss'
            if ($printed) {
                Write-Host "[$time] 🖨️ Mutfak fişi başarıyla yazdırıldı! ($($bytes.Length) bayt -> $printerToUse)" -ForegroundColor Green
            } else {
                Write-Host "[$time] ❌ Fiş verisi alındı ($($bytes.Length) bayt) fakat yazıcı kuyruğuna iletilemedi." -ForegroundColor Red
            }
        }
        $client.Close()
    } catch {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Hata: $_" -ForegroundColor Red
    }
}
