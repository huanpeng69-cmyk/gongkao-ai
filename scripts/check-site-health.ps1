param(
  [string]$Domain = "lhp.enener.com",
  [string]$ExpectedCname = "huanpeng69-cmyk.github.io"
)

$ErrorActionPreference = "Continue"

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

Write-Section "DNS"
$dnsOk = $false
$cnameOk = $false
try {
  $dns = nslookup -type=CNAME $Domain 8.8.8.8 2>&1
  $dns | ForEach-Object { Write-Host $_ }
  $dnsText = ($dns -join "`n")
  $dnsOk = $dnsText -notmatch "can't find|Non-existent|NXDOMAIN"
  $cnameOk = $dnsText -match [regex]::Escape($ExpectedCname)
} catch {
  Write-Host $_.Exception.Message
}

if (-not $dnsOk) {
  Write-Host ""
  Write-Host "DNS record is missing. Add this record in Cloudflare:"
  Write-Host "Type: CNAME"
  Write-Host "Name: lhp"
  Write-Host "Target: $ExpectedCname"
  Write-Host "Proxy: DNS only"
  exit 2
}

if (-not $cnameOk) {
  Write-Host ""
  Write-Host "DNS record exists but does not point to $ExpectedCname."
  exit 3
}

Write-Section "HTTP"
try {
  $res = Invoke-WebRequest -Uri "http://$Domain" -UseBasicParsing -TimeoutSec 20
  Write-Host "HTTP status: $($res.StatusCode)"
  if ($res.Content -match "<title>(.*?)</title>") {
    Write-Host "Title: $($Matches[1])"
  }
  if ($res.StatusCode -lt 200 -or $res.StatusCode -ge 400) {
    exit 4
  }
} catch {
  Write-Host $_.Exception.Message
  exit 4
}

Write-Host ""
Write-Host "Site health check passed."
