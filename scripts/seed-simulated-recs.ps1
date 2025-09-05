param(
  [int]$Count = 15,
  [string]$ApiBase = 'http://localhost:3002'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function New-SimulatedRecommendation {
  param([int]$Index)
  $base = 1800
  $jitter = Get-Random -Minimum -40 -Maximum 40
  $price = [Math]::Round(($base + $jitter), 2)
  $dir = @('LONG','SHORT')[(Get-Random -Minimum 0 -Maximum 2)]
  $lev = @(3,5,10,20)[(Get-Random -Minimum 0 -Maximum 4)]
  [ordered]@{
    symbol = 'ETH-USDT-SWAP'
    direction = $dir
    entry_price = $price
    current_price = $price
    leverage = $lev
    strategy_type = 'SIMULATED'
  }
}

$uri = "$ApiBase/api/recommendations"
$success = 0
$fail = 0
$ids = New-Object System.Collections.Generic.List[string]

for ($i=0; $i -lt $Count; $i++) {
  try {
    $payload = New-SimulatedRecommendation -Index $i
    $json = $payload | ConvertTo-Json -Depth 6
    $resp = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $json
    if ($resp.success -and $resp.data -and $resp.data.id) {
      $success++
      $ids.Add($resp.data.id) | Out-Null
    } else {
      $fail++
      Write-Host "Insert failed for index ${i}: $($resp | ConvertTo-Json -Depth 6)" -ForegroundColor Yellow
    }
  }
  catch {
    $fail++
    Write-Host "Error on index ${i}: $($_.Exception.Message)" -ForegroundColor Red
  }
  Start-Sleep -Milliseconds 120
}

Write-Host ("Inserted Success={0} Failed={1}" -f $success,$fail) -ForegroundColor Cyan
$ids | ForEach-Object { Write-Host ("ID: $_") }

try {
  $list = Invoke-RestMethod -Uri "$ApiBase/api/recommendations?limit=60" -Method Get
  Write-Host ("List success={0} total={1} count={2}" -f $list.success, $list.data.total, ($list.data.recommendations | Measure-Object).Count) -ForegroundColor Green
  ($list.data.recommendations | Select-Object -First 5) | ConvertTo-Json -Depth 6
}
catch {
  Write-Host ("Fetch list error: $($_.Exception.Message)") -ForegroundColor Red
}