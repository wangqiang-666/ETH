Param()
$ErrorActionPreference = "Stop"

$base = "http://localhost:3001"

# Build updates JSON for /api/config
$updatesObj = @{
  updates = @(
    @{ path = "testing.allowFGIOverride"; value = $true },
    @{ path = "testing.fgiOverrideDefaultTtlMs"; value = 60000 },
    @{ path = "testing.allowFundingOverride"; value = $true },
    @{ path = "testing.fundingOverrideDefaultTtlMs"; value = 60000 },
    @{ path = "testing.allowPriceOverride"; value = $true },
    @{ path = "testing.priceOverrideDefaultTtlMs"; value = 60000 }
  )
}
$cfgJson = $updatesObj | ConvertTo-Json -Depth 5

# POST /api/config
try {
  $resp = Invoke-RestMethod -Uri "$base/api/config" -Method Post -Body $cfgJson -ContentType "application/json"
  Write-Output ("CONFIG_UPDATE: " + ($resp | ConvertTo-Json -Compress))
} catch {
  Write-Output ("CONFIG_UPDATE_ERROR: " + $_.Exception.Message)
}

# Set FGI override value 42, TTL 3s
$fgiObj = @{ value = 42; ttlMs = 3000 }
$fgiJson = $fgiObj | ConvertTo-Json -Compress
try {
  $set = Invoke-RestMethod -Uri "$base/api/testing/fgi-override" -Method Post -Body $fgiJson -ContentType "application/json"
  Write-Output ("FGI_SET: " + ($set | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FGI_SET_ERROR: " + $_.Exception.Message)
}

# Get FGI immediately
try {
  $g1 = Invoke-RestMethod -Uri "$base/api/sentiment/fgi"
  Write-Output ("FGI_NOW: " + ($g1 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FGI_NOW_ERROR: " + $_.Exception.Message)
}

# Wait for TTL expiry
Start-Sleep -Milliseconds 3500

# Get FGI after TTL
try {
  $g2 = Invoke-RestMethod -Uri "$base/api/sentiment/fgi"
  Write-Output ("FGI_LATER: " + ($g2 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FGI_LATER_ERROR: " + $_.Exception.Message)
}

# Clear FGI override
try {
  $clr = Invoke-RestMethod -Uri "$base/api/testing/fgi-override/clear" -Method Post
  Write-Output ("FGI_CLEAR: " + ($clr | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FGI_CLEAR_ERROR: " + $_.Exception.Message)
}

# --- Funding override test ---
$fObj = @{ symbol = 'ETH-USDT-SWAP'; value = -0.0123; ttlMs = 3000 }
$fJson = $fObj | ConvertTo-Json -Compress
try {
  $fset = Invoke-RestMethod -Uri "$base/api/testing/funding-override" -Method Post -Body $fJson -ContentType 'application/json'
  Write-Output ("FUND_SET: " + ($fset | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FUND_SET_ERROR: " + $_.Exception.Message)
}
try {
  $fr1 = Invoke-RestMethod -Uri "$base/api/market/funding-rate?symbol=ETH-USDT-SWAP"
  Write-Output ("FUND_NOW: " + ($fr1 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FUND_NOW_ERROR: " + $_.Exception.Message)
}
Start-Sleep -Milliseconds 3500
try {
  $fr2 = Invoke-RestMethod -Uri "$base/api/market/funding-rate?symbol=ETH-USDT-SWAP"
  Write-Output ("FUND_LATER: " + ($fr2 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FUND_LATER_ERROR: " + $_.Exception.Message)
}
try {
  $fclr = Invoke-RestMethod -Uri "$base/api/testing/funding-override/clear" -Method Post -Body (@{ symbol = 'ETH-USDT-SWAP' } | ConvertTo-Json -Compress) -ContentType 'application/json'
  Write-Output ("FUND_CLEAR: " + ($fclr | ConvertTo-Json -Compress))
} catch {
  Write-Output ("FUND_CLEAR_ERROR: " + $_.Exception.Message)
}

# --- Price override test ---
$pObj = @{ symbol = 'ETH-USDT-SWAP'; price = 1234.56; ttlMs = 3000 }
$pJson = $pObj | ConvertTo-Json -Compress
try {
  $pset = Invoke-RestMethod -Uri "$base/api/testing/price-override" -Method Post -Body $pJson -ContentType 'application/json'
  Write-Output ("PRICE_SET: " + ($pset | ConvertTo-Json -Compress))
} catch {
  Write-Output ("PRICE_SET_ERROR: " + $_.Exception.Message)
}
try {
  $t1 = Invoke-RestMethod -Uri "$base/api/market/ticker?symbol=ETH-USDT-SWAP"
  Write-Output ("TICKER_NOW: " + ($t1 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("TICKER_NOW_ERROR: " + $_.Exception.Message)
}
Start-Sleep -Milliseconds 3500
try {
  $t2 = Invoke-RestMethod -Uri "$base/api/market/ticker?symbol=ETH-USDT-SWAP"
  Write-Output ("TICKER_LATER: " + ($t2 | ConvertTo-Json -Compress))
} catch {
  Write-Output ("TICKER_LATER_ERROR: " + $_.Exception.Message)
}
try {
  $pclr = Invoke-RestMethod -Uri "$base/api/testing/price-override/clear" -Method Post -Body (@{ symbol = 'ETH-USDT-SWAP' } | ConvertTo-Json -Compress) -ContentType 'application/json'
  Write-Output ("PRICE_CLEAR: " + ($pclr | ConvertTo-Json -Compress))
} catch {
  Write-Output ("PRICE_CLEAR_ERROR: " + $_.Exception.Message)
}

# --- Strategy gating check ---
try {
  $st1 = Invoke-RestMethod -Uri "$base/api/strategy/status"
  Write-Output ("STATUS_1: " + ($st1 | ConvertTo-Json -Compress))
  if(-not ($st1.success)){
    throw "status not success"
  }
} catch {
  Write-Output ("STATUS_1_ERROR: " + $_.Exception.Message)
}

# If gating missing or not updated, trigger analysis then re-fetch
$needTrigger = $false
try {
  if(-not $st1){ $needTrigger = $true }
  elseif(-not ($st1.data -and $st1.data.gating)) { $needTrigger = $true }
} catch { $needTrigger = $true }

if($needTrigger){
  try {
    $tr = Invoke-RestMethod -Uri "$base/api/strategy/analysis/trigger" -Method Post
    Write-Output ("ANALYSIS_TRIGGER: " + ($tr | ConvertTo-Json -Compress))
    Start-Sleep -Seconds 3
  } catch {
    Write-Output ("ANALYSIS_TRIGGER_ERROR: " + $_.Exception.Message)
  }
  try {
    $st2 = Invoke-RestMethod -Uri "$base/api/strategy/status"
    Write-Output ("STATUS_2: " + ($st2 | ConvertTo-Json -Compress))
  } catch {
    Write-Output ("STATUS_2_ERROR: " + $_.Exception.Message)
  }
}