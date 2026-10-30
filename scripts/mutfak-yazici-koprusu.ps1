param(
    [string]$PrinterName = "Mutfak",
    [int]$Port = 9100
)

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
$listener.Start()

$myIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -like '192.168.*' }).IPAddress | Select-Object -First 1

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   HIPOS MUTFAK YAZICI KÖPRÜSÜ (WINDOWS PRINT SERVER)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Bu Bilgisayarın IP Adresi : $myIp" -ForegroundColor Yellow
Write-Host " Dinlenen Port            : $Port" -ForegroundColor Yellow
Write-Host " Hedef Yazıcı Paylaşım Adı : $PrinterName" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------" -ForegroundColor Gray
Write-Host " Mac'teki HIPOS bu IP'ye ($myIp:$Port) mutfak fişi atacak." -ForegroundColor White
Write-Host " Çıkmak için Ctrl+C tuşlayın." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green
Write-Host ""

$sharePath = "\\127.0.0.1\$PrinterName"

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
            [System.IO.File]::WriteAllBytes($sharePath, $bytes)
            $time = Get-Date -Format 'HH:mm:ss'
            Write-Host "[$time] 🖨️ Mutfak fişi başarıyla yazıcıya basıldı! ($($bytes.Length) bayt)" -ForegroundColor Green
        }
        $client.Close()
    } catch {
        Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] Yazdırma hatası: $_" -ForegroundColor Red
    }
}
