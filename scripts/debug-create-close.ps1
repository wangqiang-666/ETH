$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:3035/api'
$symbol = "DBG-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$headers = @{ 'X-Loop-Guard' = '1' }
$payload = {
  @{symbol=$symbol;direction='LONG';entry_price=1000;current_price=1000;leverage=2;position_size=1;strategy_type='UNITTEST';ev=0.05;ab_group='A';bypassCooldown=$true} | ConvertTo-Json
}

Write-Host "POST /recommendations" -ForegroundColor Cyan
try {
  $cr = Invoke-RestMethod -Method POST -Uri "$base/recommendations" -Body (& $payload) -ContentType 'application/json' -Headers $headers -TimeoutSec 15 -StatusCodeVariable sc1 -ErrorAction Stop
  Write-Host "CREATE_STATUS $sc1"
  $cr | ConvertTo-Json -Depth 6
} catch {
  Write-Host "CREATE_ERR $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails) { $_.ErrorDetails.Message }
  exit 1
}

$id = $cr.data.id
if (-not $id) { Write-Host 'NO_ID'; exit 2 }

Write-Host "GET /recommendations/$id" -ForegroundColor Cyan
try {
  $gr = Invoke-RestMethod -Method GET -Uri "$base/recommendations/$id" -TimeoutSec 15 -StatusCodeVariable sc2 -ErrorAction Stop
  Write-Host "GET_STATUS $sc2"
  $gr | ConvertTo-Json -Depth 6
} catch {
  Write-Host "GET_ERR $($_.Exception.Message)" -ForegroundColor Yellow
  if ($_.ErrorDetails) { $_.ErrorDetails.Message }
}

Write-Host "PUT /recommendations/$id/close" -ForegroundColor Cyan
$closeBody = @{ reason = 'MANUAL_TEST' } | ConvertTo-Json
try {
  $cl = Invoke-RestMethod -Method PUT -Uri "$base/recommendations/$id/close" -Body $closeBody -ContentType 'application/json' -TimeoutSec 15 -StatusCodeVariable sc3 -ErrorAction Stop
  Write-Host "CLOSE_STATUS $sc3"
  $cl | ConvertTo-Json -Depth 6
} catch {
  Write-Host "CLOSE_ERR $($_.Exception.Message)" -ForegroundColor Yellow
  if ($_.ErrorDetails) { $_.ErrorDetails.Message }
}