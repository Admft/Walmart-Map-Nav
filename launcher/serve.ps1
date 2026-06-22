$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Port = 3456
$Walmart = 'https://developer.api.walmart.com/api-proxy/service/Store-Services/Instore-Maps/v1/store'

function Get-Mime([string]$Path) {
  switch -Regex ([IO.Path]::GetExtension($Path).ToLower()) {
    '\.html$' { return 'text/html; charset=utf-8' }
    '\.js$'   { return 'application/javascript; charset=utf-8' }
    '\.css$'  { return 'text/css; charset=utf-8' }
    '\.json$' { return 'application/json; charset=utf-8' }
    '\.ico$'  { return 'image/x-icon' }
    default   { return 'application/octet-stream' }
  }
}

function Send-Bytes($Response, [byte[]]$Bytes, [string]$Type) {
  $Response.ContentType = $Type
  $Response.ContentLength64 = $Bytes.Length
  $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  $Response.OutputStream.Close()
}

function Send-Json($Response, $Obj) {
  $json = [System.Text.Encoding]::UTF8.GetBytes(($Obj | ConvertTo-Json -Compress -Depth 30))
  Send-Bytes $Response $json 'application/json; charset=utf-8'
}

function Extract-MapData([string]$Html) {
  $marker = 'window.mapData ='
  $start = $Html.IndexOf($marker)
  if ($start -lt 0) { throw 'Could not find window.mapData in downloaded file' }
  $jsonStart = $start + $marker.Length
  $depth = 0
  $inStr = $false
  $esc = $false
  $end = -1
  for ($i = $jsonStart; $i -lt $Html.Length; $i++) {
    $c = $Html[$i]
    if ($inStr) {
      if ($esc) { $esc = $false }
      elseif ($c -eq '\') { $esc = $true }
      elseif ($c -eq '"') { $inStr = $false }
      continue
    }
    if ($c -eq '"') { $inStr = $true; continue }
    if ($c -eq '{') { $depth++ }
    elseif ($c -eq '}') {
      $depth--
      if ($depth -eq 0) { $end = $i + 1; break }
    }
  }
  if ($end -lt 0) { throw 'Could not parse mapData JSON' }
  return $Html.Substring($jsonStart, $end - $jsonStart).Trim() | ConvertFrom-Json
}

function List-StoreIds {
  $dir = Join-Path $Root 'stores'
  if (-not (Test-Path $dir)) { return @() }
  return @(Get-ChildItem $dir -Filter '*.json' | Where-Object { $_.BaseName -match '^\d+$' } | ForEach-Object { $_.BaseName } | Sort-Object { [int]$_ })
}

Write-Host 'Starting Walmart Map Nav...'
Start-Process "http://localhost:$Port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Running at http://localhost:$Port"
Write-Host 'Close this window to stop.'

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $path = $req.Url.LocalPath
    if ($path -eq '/') { $path = '/index.html' }

    if ($path -eq '/api/stores') {
      Send-Json $res @{ stores = (List-StoreIds) }
      continue
    }

    if ($path -match '^/api/store/(\d+)$') {
      $id = $Matches[1]
      $storesDir = Join-Path $Root 'stores'
      if (-not (Test-Path $storesDir)) { New-Item -ItemType Directory -Path $storesDir | Out-Null }
      $jsonFile = Join-Path $storesDir "$id.json"
      $force = $req.QueryString['force'] -eq '1' -or $req.QueryString['refresh'] -eq '1'

      if (-not $force -and (Test-Path $jsonFile)) {
        $mapData = Get-Content $jsonFile -Raw | ConvertFrom-Json
        $mtime = (Get-Item $jsonFile).LastWriteTimeUtc.ToString('o')
        Send-Json $res @{ storeId = $id; cached = $true; downloadedAt = $mtime; mapData = $mapData }
        continue
      }

      $url = "$Walmart/$id/map"
      $html = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
      $mapData = Extract-MapData $html
      ($mapData | ConvertTo-Json -Compress -Depth 30) | Set-Content -Path $jsonFile -Encoding UTF8
      Send-Json $res @{
        storeId = $id
        cached = $false
        downloadedAt = (Get-Date).ToUniversalTime().ToString('o')
        mapData = $mapData
      }
      continue
    }

    $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path $Root $rel
    if (-not (Test-Path $filePath -PathType Leaf)) {
      $res.StatusCode = 404
      $res.Close()
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($filePath)
    Send-Bytes $res $bytes (Get-Mime $filePath)
  }
  catch {
    $res.StatusCode = 500
    Send-Json $res @{ error = $_.Exception.Message }
  }
}
