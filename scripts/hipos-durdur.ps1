[CmdletBinding()]
param(
    [switch]$KeepDb,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$rootDir = (Resolve-Path "$PSScriptRoot\..").Path
$logDir = Join-Path $env:TEMP "hipos-dev"
$pidFile = Join-Path $logDir "pids"

function Get-PidFromFile {
    param([string]$Key)
    if (Test-Path $pidFile) {
        $lines = Get-Content $pidFile
        foreach ($line in $lines) {
            $parts = $line.Split('=')
            if ($parts.Length -eq 2 -and $parts[0].Trim() -eq $Key) {
                return [int]$parts[1].Trim()
            }
        }
    }
    return $null
}

function Test-ProcessMatch {
    param(
        [int]$ProcessId,
        [string]$ExpectedPattern
    )
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -match $ExpectedPattern) {
            return $true
        }
    } catch {}
    return $false
}

function Stop-HiposService {
    param(
        [string]$Label,
        [string]$Key,
        [int]$Port,
        [string]$ExpectedPattern
    )

    $targetPid = Get-PidFromFile -Key $Key
    if (-not $targetPid) {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) {
            $targetPid = $conn.OwningProcess
        }
    }

    if (-not $targetPid) {
        Write-Host "  - $Label zaten kapali."
        return
    }

    $isMatch = Test-ProcessMatch -ProcessId $targetPid -ExpectedPattern $ExpectedPattern
    if (-not $isMatch) {
        Write-Host "  - $Label icin bulunan PID ($targetPid) HIPOS sureci olarak dogrulanmadi; dokunulmadi."
        return
    }

    if ($DryRun) {
        Write-Host "  - $Label calisiyor (PID $targetPid); dry-run nedeniyle durdurulmadi."
        return
    }

    Write-Host "  - $Label durduruluyor (PID $targetPid)..."
    try {
        Stop-Process -Id $targetPid -Force -ErrorAction SilentlyContinue
        Write-Host "    Durduruldu."
    } catch {
        Write-Warning "    Surec durdurulurken hata: $_"
    }
}

Write-Host "`nHIPOS uygulama servisleri durduruluyor..."
Stop-HiposService -Label "Yonetim API'si (5180)" -Key "api" -Port 5180 -ExpectedPattern "Hipos\.Api"
Stop-HiposService -Label "Yonetim paneli (5173)" -Key "admin" -Port 5173 -ExpectedPattern "vite"
Stop-HiposService -Label "Test POS (5176)" -Key "pos" -Port 5176 -ExpectedPattern "vite"

if (-not $KeepDb -and $DryRun) {
    Write-Host "`nDry-run: HIPOS PostgreSQL konteyneri de durdurma hedefinde; hicbir sey degistirilmedi."
} elseif (-not $KeepDb) {
    $dockerOk = $false
    try {
        $null = & docker info 2>&1
        if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
    } catch {}

    if ($dockerOk) {
        Write-Host "`nHIPOS PostgreSQL konteyneri durduruluyor; veritabani dosyalari korunuyor..."
        & docker compose -f "$rootDir\compose.yaml" stop db
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  - PostgreSQL durduruldu. Veriyi silmek icin volume silinmedi."
        } else {
            Write-Warning "PostgreSQL konteyneri durdurulamadi. Uygulama servisleri yine de kapatildi."
        }
    } else {
        Write-Host "`nDocker kapali veya kullanilamiyor; PostgreSQL icin islem yapilmadi."
    }
} else {
    Write-Host "`n-KeepDb secildi; PostgreSQL calismaya devam ediyor."
}

if (-not $DryRun -and (Test-Path $pidFile)) {
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($DryRun) {
    Write-Host "`nDry-run tamamlandi; hicbir surec veya konteyner durdurulmadi.`n"
} else {
    Write-Host "`nHIPOS durdurma islemi tamamlandi. Proje veritabani silinmedi.`n"
}
