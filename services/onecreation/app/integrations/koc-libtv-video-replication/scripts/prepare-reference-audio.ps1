param(
  [Parameter(Mandatory=$true)]
  [string]$InputPath,

  [Parameter(Mandatory=$true)]
  [string]$OutputPath,

  [double]$Seconds = 14.8,
  [double]$TargetClipDuration = 0,
  [double]$SafetyMargin = 0.3,
  [int]$SampleRate = 44100,
  [int]$BitrateKbps = 128
)

$ErrorActionPreference = 'Stop'

if ($Seconds -le 0) {
  throw "Seconds must be greater than 0."
}

if ($SafetyMargin -lt 0) {
  throw "SafetyMargin must be 0 or greater."
}

$effectiveSeconds = [Math]::Min($Seconds, 14.8)
if ($TargetClipDuration -gt 0) {
  if ($TargetClipDuration -le $SafetyMargin) {
    throw "TargetClipDuration must be greater than SafetyMargin."
  }
  $effectiveSeconds = [Math]::Min($effectiveSeconds, $TargetClipDuration - $SafetyMargin)
}

if ($effectiveSeconds -le 1.8) {
  throw "Effective reference-audio duration must be greater than 1.8 seconds."
}

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "InputPath does not exist: $InputPath"
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

Write-Host "Preparing reference audio at $effectiveSeconds seconds (ceiling 14.8s)."
ffmpeg -y -i $InputPath -vn -t $effectiveSeconds -ac 2 -ar $SampleRate -b:a "${BitrateKbps}k" $OutputPath | Out-Host

$probe = ffprobe -v error -show_entries stream=codec_type,codec_name,duration:format=duration,size,format_name -of json $OutputPath
$probe
