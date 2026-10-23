param(
  [Parameter(Mandatory = $true)][string]$HostName,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$UserName,
  [Parameter(Mandatory = $true)][string]$Password,
  [Parameter(Mandatory = $true)][string]$DatabaseName,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $parent -Force | Out-Null

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$protected = ConvertFrom-SecureString $secure
$payload = [ordered]@{
  version = 1
  encryption = "windows-dpapi-current-user"
  host = $HostName
  port = $Port
  user = $UserName
  database = $DatabaseName
  passwordProtected = $protected
  updatedAt = [DateTime]::UtcNow.ToString("o")
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($resolvedOutput, ($payload | ConvertTo-Json -Depth 4), $utf8NoBom)

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $resolvedOutput /inheritance:r /grant:r "${identity}:(R,W)" | Out-Null
Write-Output "Material center database config saved with Windows DPAPI."
