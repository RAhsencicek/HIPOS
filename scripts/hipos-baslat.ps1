[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$logDir = Join-Path $env:TEMP "hipos-dev"
$pidFile = Join-Path $logDir "pids"
$tempBin = Join-Path $logDir "bin"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
if (-not (Test-Path $tempBin)) { New-Item -ItemType Directory -Path $tempBin -Force | Out-Null }

function Fail([string]$message) {
    Write-Host "`nHATA: $message" -ForegroundColor Red
    exit 1
}

function Assert-CommandExists([string]$commandName) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        Fail "$commandName bulunamadi. README.md icindeki kurulum gereksinimlerine bakin."
    }
}

# 1. Temel arac kontrolleri
foreach ($cmd in @("docker", "node", "npm", "dotnet", "curl")) {
    Assert-CommandExists $cmd
}

# Node.js ve .NET surum kontrolleri
$nodeVersion = & node -p "process.versions.node.split('.')[0]"
if ([int]$nodeVersion -lt 22) {
    $currentVer = & node --version
    Fail "Node.js 22 veya uzeri gerekli; bulunan: $currentVer"
}

$dotnetMajor = (& dotnet --version).Split('.')[0]
if ([int]$dotnetMajor -lt 10) {
    $currentDotnet = & dotnet --version
    Fail ".NET 10 SDK gerekli; bulunan: $currentDotnet"
}

# Port kontrolleri
foreach ($port in @(5173, 5176, 5180)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Fail "$port portu zaten kullanimda. Var olan HIPOS sureclerini kapatip (HIPOS-Windows-Durdur.bat) tekrar deneyin."
    }
}

# Docker motor kontrolu
$dockerRunning = $false
try {
    $null = & docker info 2>&1
    if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
} catch {}

if (-not $dockerRunning) {
    Write-Host "Docker Desktop baslatiliyor; veritabani hazir olana kadar bekleyecegim..."
    $dockerPaths = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker Desktop\Docker Desktop.exe"
    )
    $started = $false
    foreach ($dp in $dockerPaths) {
        if (Test-Path $dp) {
            Start-Process $dp
            $started = $true
            break
        }
    }
    if (-not $started) {
        Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
    }

    for ($i = 1; $i -le 60; $i++) {
        Start-Sleep -Seconds 2
        try {
            $null = & docker info 2>&1
            if ($LASTEXITCODE -eq 0) { $dockerRunning = $true; break }
        } catch {}
    }
    if (-not $dockerRunning) {
        Fail "Docker Engine baslatilamadi. Docker Desktop durumunu kontrol edip tekrar deneyin."
    }
}

# [1/5] PostgreSQL baslatma
Write-Host "`n[1/5] Yerel PostgreSQL baslatiliyor..."
& docker compose -f "$rootDir\compose.yaml" up -d db
$databaseReady = $false
for ($i = 1; $i -le 30; $i++) {
    & docker compose -f "$rootDir\compose.yaml" exec -T db pg_isready -U hipos -d hipos_features 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $databaseReady = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $databaseReady) {
    Fail "PostgreSQL hazir olmadi. 'docker compose ps' ile durumu kontrol edin."
}

# Host ortaminda psql yoksa Docker container uzerinden calistiracak shim olustur
if (-not (Get-Command "psql" -ErrorAction SilentlyContinue)) {
    $shimContent = "@echo off`r`ndocker compose -f `"$rootDir\compose.yaml`" exec -T db psql %*`r`n"
    [System.IO.File]::WriteAllText((Join-Path $tempBin "psql.cmd"), $shimContent)
    $env:PATH = "$tempBin;$env:PATH"
}

# Paket yukleme kontrolleri
$vitePath = Join-Path $rootDir "node_modules\vite\bin\vite.js"
if (-not (Test-Path $vitePath)) {
    Write-Host "`nNode paketleri bulunamadi; npm install calistiriliyor..."
    Push-Location $rootDir
    & npm install
    Pop-Location
}

if (-not (Test-Path "$rootDir\apps\api\Hipos.Api\obj\project.assets.json")) {
    Write-Host "`n.NET paketleri geri yukleniyor..."
    & dotnet restore "$rootDir\apps\api\Hipos.Api\Hipos.Api.csproj"
}

# [2/5] dotnet tool restore & API derleme (tek seferde)
Write-Host "`n[2/5] Entity Framework araci hazirlaniyor ve API derleniyor..."
Push-Location $rootDir
& dotnet tool restore
Pop-Location

& dotnet build "$rootDir\apps\api\Hipos.Api\Hipos.Api.csproj" --no-restore
if ($LASTEXITCODE -ne 0) {
    & dotnet build "$rootDir\apps\api\Hipos.Api\Hipos.Api.csproj"
    if ($LASTEXITCODE -ne 0) {
        Fail "API derlenemedi."
    }
}

$env:HIPOS_FEATURES_CONNECTION = 'Host=127.0.0.1;Port=5433;Database=hipos_features;Username=hipos;Password=hipos-dev-only'
$env:HIPOS_DEMO_DATABASE_URL = 'postgresql://hipos:hipos-dev-only@127.0.0.1:5433/hipos_features'

# [3/5] Migration'lar (tek derleme sonrasi --no-build ile cok hizli)
Write-Host "`n[3/5] Veritabani migration'lari kontrol ediliyor..."
$contexts = @(
    "FeatureDbContext", "CatalogDbContext", "SalesDbContext", "CariDbContext",
    "ServiceDbContext", "InventoryDbContext", "CashDbContext", "ExpenseDbContext"
)
foreach ($context in $contexts) {
    Write-Host "  - $context... " -NoNewline
    $res = & dotnet tool run dotnet-ef database update `
        --project "$rootDir\apps\api\Hipos.Api\Hipos.Api.csproj" `
        --context $context `
        --no-build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[HATA]" -ForegroundColor Red
        Fail "Migration hatasi ($context): $res"
    } else {
        Write-Host "[Hazir]" -ForegroundColor Green
    }
}

# [4/5] Demo Seed'ler
Write-Host "`n[4/5] Demo baslangic kayitlari dogrulaniyor..."
Push-Location $rootDir
& npm run demo:check
& npm run demo:seed
& npm run demo:seed:menus
& npm run demo:seed:cari
& npm run demo:seed:service
& npm run demo:seed:inventory
& npm run demo:seed:cash
& npm run demo:seed:expenses
Pop-Location

# [5/5] Servisleri baslatma
Write-Host "`n[5/5] API, Yonetim Paneli ve Test POS baslatiliyor..."

$apiLog = Join-Path $logDir "api.log"
$adminLog = Join-Path $logDir "admin.log"
$posLog = Join-Path $logDir "pos.log"

# API environment
$env:ASPNETCORE_ENVIRONMENT = "Development"
$env:ASPNETCORE_URLS = "http://0.0.0.0:5180"
$env:HIPOS_FEATURE_STORAGE = "postgres"

$apiProc = Start-Process -FilePath "dotnet" `
    -ArgumentList "bin/Debug/net10.0/Hipos.Api.dll" `
    -WorkingDirectory "$rootDir\apps\api\Hipos.Api" `
    -RedirectStandardOutput $apiLog `
    -RedirectStandardError (Join-Path $logDir "api_err.log") `
    -PassThru -WindowStyle Hidden

# API hazir olana kadar bekle
$apiReady = $false
for ($i = 1; $i -le 45; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:5180/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) { $apiReady = $true; break }
    } catch {}
    if ($apiProc.HasExited) { break }
    Start-Sleep -Seconds 1
}

if (-not $apiReady) {
    if (Test-Path $apiLog) { Get-Content $apiLog -Tail 60 }
    Fail "API baslamadi. API logu: $apiLog"
}

# Panel ve POS environment
$env:VITE_FEATURE_PROVIDER = "http"
$env:VITE_CATALOG_PROVIDER = "http"
$env:VITE_SALES_PROVIDER = "http"
$env:VITE_CARI_PROVIDER = "http"
$env:VITE_SERVICE_PROVIDER = "http"
$env:VITE_INVENTORY_PROVIDER = "http"
$env:VITE_CASH_PROVIDER = "http"
$env:VITE_EXPENSE_PROVIDER = "http"
$env:VITE_API_BASE_URL = ""
$env:HIPOS_DEV_API_TARGET = "http://127.0.0.1:5180"

$adminProc = Start-Process -FilePath "node" `
    -ArgumentList "`"$vitePath`" --host 0.0.0.0 --port 5173 --strictPort" `
    -WorkingDirectory "$rootDir\apps\admin" `
    -RedirectStandardOutput $adminLog `
    -RedirectStandardError (Join-Path $logDir "admin_err.log") `
    -PassThru -WindowStyle Hidden

$posProc = Start-Process -FilePath "node" `
    -ArgumentList "`"$vitePath`" --host 0.0.0.0 --port 5176 --strictPort" `
    -WorkingDirectory "$rootDir\apps\pos" `
    -RedirectStandardOutput $posLog `
    -RedirectStandardError (Join-Path $logDir "pos_err.log") `
    -PassThru -WindowStyle Hidden

"api=$($apiProc.Id)`nadmin=$($adminProc.Id)`npos=$($posProc.Id)" | Set-Content $pidFile -Encoding UTF8

$panelReady = $false
$posReady = $false
for ($i = 1; $i -le 30; $i++) {
    if (-not $panelReady) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:5173/admin" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($r.StatusCode -eq 200) { $panelReady = $true }
        } catch {}
    }
    if (-not $posReady) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:5176" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($r.StatusCode -eq 200) { $posReady = $true }
        } catch {}
    }
    if ($panelReady -and $posReady) { break }
    Start-Sleep -Seconds 1
}

if (-not $panelReady -or -not $posReady) {
    Fail "Panel veya Test POS baslamadi. Ayrinti: $logDir"
}

Write-Host "`nHIPOS hazir." -ForegroundColor Green
Write-Host "Yonetim paneli: http://localhost:5173/admin"
Write-Host "Cari hesaplar:  http://localhost:5173/admin/customers/accounts"
Write-Host "Test POS:       http://localhost:5176"
Write-Host "Garson ekrani:  http://localhost:5176/waiter"
Write-Host "Mutfak ekrani:  http://localhost:5176/kitchen"

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' } | Select-Object -First 1).IPAddress
if ($lanIp) {
    Write-Host "`nAyni Wi-Fi/LAN agindaki telefonlardan acin:"
    Write-Host "Yonetim: http://${lanIp}:5173/admin"
    Write-Host "Garson:  http://${lanIp}:5176/waiter"
    Write-Host "Mutfak:  http://${lanIp}:5176/kitchen"
    Write-Host "POS:     http://${lanIp}:5176"
} else {
    Write-Host "`nTelefon baglantisi icin yerel IP adresini bulun; telefonlar ayni Wi-Fi agina bagli olmali."
}

Write-Host "API saglik:     http://localhost:5180/health"
Write-Host "Loglar:         $logDir"
Write-Host "Uygulama sunucularini durdurmak icin bu pencerede Ctrl+C kullanin veya HIPOS-Windows-Durdur.bat calistirin. PostgreSQL verisi korunur.`n"

Start-Process "http://localhost:5173/admin"

try {
    while ($true) {
        Start-Sleep -Seconds 2
        if ($apiProc.HasExited) { Fail "API durdu. Ayrinti: $apiLog" }
        if ($adminProc.HasExited) { Fail "Yonetim paneli durdu. Ayrinti: $adminLog" }
        if ($posProc.HasExited) { Fail "Test POS durdu. Ayrinti: $posLog" }
    }
} finally {
    Write-Host "`nHIPOS uygulama surecleri durduruluyor..." -ForegroundColor Yellow
    foreach ($p in @($apiProc, $adminProc, $posProc)) {
        if ($p -and -not $p.HasExited) {
            try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
    Write-Host "HIPOS uygulama surecleri durduruldu. PostgreSQL verisi korunuyor." -ForegroundColor Green
}
