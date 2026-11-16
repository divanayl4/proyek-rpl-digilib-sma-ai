# run-ebook-scheduler.ps1
# Dipanggil oleh Windows Task Scheduler setiap 5 menit.
# Membaca CRON_SECRET dari .env (server-side), TIDAK menuliskan secret ke log.

$ErrorActionPreference = "Stop"

$project = "D:\Downloads\laragon\www\digilib-sma-ai-backup1"
$logDir = Join-Path $env:LOCALAPPDATA "DigiLib"
$logFile = Join-Path $logDir "ebook-scheduler.log"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Get-EnvValue($key) {
    $line = Get-Content (Join-Path $project ".env") | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
    if (-not $line) { throw "Variabel $key tidak ditemukan di .env" }
    return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$secret = Get-EnvValue "CRON_SECRET"
if ([string]::IsNullOrWhiteSpace($secret) -or $secret -like "*ganti-dengan*") {
    throw "CRON_SECRET belum dikonfigurasi di .env"
}

$endpoint = "http://localhost:3000/api/cron/ebook-expiry"
$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

try {
    $response = Invoke-WebRequest -Uri $endpoint -Method POST `
        -Headers @{ Authorization = "Bearer $secret" } `
        -TimeoutSec 30 -UseBasicParsing

    $body = $response.Content
    # Log hanya waktu + ringkasan hasil (tanpa token / data pribadi)
    $summary = "HTTP $($response.StatusCode) $body"
    Add-Content -Path $logFile -Value "$timestamp | OK | $summary"
} catch {
    $msg = $_.Exception.Message
    Add-Content -Path $logFile -Value "$timestamp | FAIL | $msg"
    exit 1
}
