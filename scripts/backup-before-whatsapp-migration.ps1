$ErrorActionPreference = "Stop"
$root = "D:\Downloads\laragon\www\digilib-sma-ai-backup1"
$stamp = "20261114-120000"
$backup = Join-Path $root "backup-telegram-migration-$stamp"

$files = @(
  ".env",
  ".env.example",
  "jalankan-digilib.ps1",
  "README.md",
  "prisma\schema.prisma",
  "src\lib\notifications.ts",
  "src\lib\ai\roleCapabilities.ts",
  "src\app\api\register\route.ts",
  "src\app\api\profile\route.ts",
  "src\app\profile\page.tsx",
  "src\components\profile\ProfileForm.tsx",
  "src\components\layout\Sidebar.tsx",
  "src\app\api\admin\users\route.ts",
  "src\app\api\admin\users\[id]\route.ts",
  "src\app\api\books\route.ts",
  "src\app\api\borrows\[id]\route.ts",
  "src\lib\__tests__\api-librarian-borrowers.test.ts",
  "src\lib\__tests__\api-borrows-id-route.test.ts",
  "src\lib\__tests__\api-register.test.ts",
  "src\lib\__tests__\notifications-telegram.test.ts",
  "src\lib\__tests__\profile-telegram-buttons.test.tsx",
  "src\lib\__tests__\telegram.test.ts",
  "src\lib\__tests__\telegram-routes.test.ts",
  "src\lib\telegram.ts",
  "src\app\api\telegram\link\route.ts",
  "src\app\api\telegram\webhook\route.ts",
  "register-telegram-webhook.mjs",
  "prisma\dev.db"
)

foreach ($rel in $files) {
  $src = Join-Path $root $rel
  if (Test-Path -LiteralPath $src) {
    $dest = Join-Path $backup $rel
    $destDir = Split-Path -Parent $dest
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Copy-Item -LiteralPath $src -Destination $dest -Force
    Write-Host "backed up: $rel"
  } else {
    Write-Host "SKIP (missing): $rel"
  }
}

# Simpan daftar file yang di-audit untuk laporan.
$auditList = Join-Path $backup "AUDIT_FILE_LIST.txt"
Get-ChildItem -Path (Join-Path $root "src") -Recurse -File |
  Select-Object -ExpandProperty FullName |
  ForEach-Object { $_.Replace($root + "\", "") } |
  Set-Content -Path $auditList -Encoding UTF8

Write-Host ""
Write-Host "Backup selesai: $backup"
