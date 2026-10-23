$ErrorActionPreference = 'Stop'

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $AppDir
$EnvFile = Join-Path $BaseDir '.env'
$Node = $env:PRODUCT_SHOT_NODE

# Docker Compose loads .env automatically; the Windows launcher loads it here.
# Existing process variables take precedence over values from the file.
if (Test-Path -LiteralPath $EnvFile) {
  foreach ($entry in (Get-Content -LiteralPath $EnvFile -Encoding UTF8)) {
    $line = $entry.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -le 0) { continue }
    $key = $line.Substring(0, $separator).Trim()
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    $value = $line.Substring($separator + 1).Trim()
    $currentValue = (Get-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue).Value
    if (-not $currentValue) {
      Set-Item -LiteralPath "Env:$key" -Value $value
    }
  }
}

# Keep the FanDo API key in the Windows user environment and inject it only
# into this backend process. The key is never written to .env or sent to the browser.
if (-not $env:QWEN_IMAGE_PROMPT_API_KEY) {
  $FandoApiKey = [Environment]::GetEnvironmentVariable('fando', 'User')
  if (-not $FandoApiKey) {
    $FandoApiKey = [Environment]::GetEnvironmentVariable('fando', 'Machine')
  }
  if ($FandoApiKey) {
    $env:QWEN_IMAGE_PROMPT_API_KEY = $FandoApiKey
  }
}

if ($env:QWEN_IMAGE_PROMPT_API_KEY) {
  if (-not $env:QWEN_IMAGE_PROMPT_BASE_URL) {
    $env:QWEN_IMAGE_PROMPT_BASE_URL = 'https://cloud.fandow.com/gpt/company-system-jump'
  }
  if (-not $env:QWEN_IMAGE_PROMPT_SYS_NAME) {
    $env:QWEN_IMAGE_PROMPT_SYS_NAME = 'openclaw'
  }
  if (-not $env:QWEN_IMAGE_PROMPT_MODEL) {
    $env:QWEN_IMAGE_PROMPT_MODEL = 'qwen3.7-plus'
  }
}

if (-not $Node) {
  $bundledNode = Join-Path $BaseDir 'runtime\node.exe'
  if (Test-Path -LiteralPath $bundledNode) {
    $Node = $bundledNode
  }
}

if (-not $Node) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($nodeCmd) {
    $Node = $nodeCmd.Source
  }
}

if (-not $Node) {
  $codexNode = 'C:\Users\202606\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $codexNode) {
    $Node = $codexNode
  }
}

if (-not (Test-Path -LiteralPath $Node)) {
  throw "Node.js was not found. Please run the shared one-click installer first."
}

if (-not $env:LIBTV_PATH) {
  $bundledLibTv = Join-Path $BaseDir 'tools\libtv.exe'
  if (Test-Path -LiteralPath $bundledLibTv) {
    $env:LIBTV_PATH = $bundledLibTv
  }
}

Set-Location -LiteralPath $AppDir
Write-Host "Product Shot Generator starting..."
Write-Host "Open: http://127.0.0.1:3766"
& $Node .\server.js
