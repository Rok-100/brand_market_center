[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ClipPlanPath,

  [Parameter(Mandatory = $true)]
  [string]$ClipNumber,

  [string]$TaskAssetRoot,
  [string]$Project,
  [string]$Group,
  [string]$LibTvExecutable = 'libtv',
  [switch]$Run,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Normalize-Newlines {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
  return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Convert-SettingValue {
  param([Parameter(Mandatory = $true)]$Value)

  if ($Value -is [bool]) {
    return $Value.ToString().ToLowerInvariant()
  }
  if ($Value -is [string]) {
    return $Value
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    return ($Value | ConvertTo-Json -Compress)
  }
  if ($Value -is [System.IFormattable]) {
    return $Value.ToString($null, [System.Globalization.CultureInfo]::InvariantCulture)
  }
  return [string]$Value
}

function Add-ScopeArguments {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[string]]$Arguments
  )

  if ($Project) {
    $Arguments.Add('-p')
    $Arguments.Add($Project)
  }
  if ($Group) {
    $Arguments.Add('-g')
    $Arguments.Add($Group)
  }
}

function Invoke-LibTvLogged {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$LogStem
  )

  $stderrPath = "$LogStem.stderr.log"
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell can promote a native program's redirected stderr into
    # a terminating ErrorRecord when the surrounding script uses Stop. LibTV
    # writes validation/progress diagnostics to stderr, so capture the native
    # exit code and log first, then raise the script's own actionable error.
    $ErrorActionPreference = 'Continue'
    $stdoutLines = @(& $LibTvExecutable @Arguments 2> $stderrPath)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $stdoutText = $stdoutLines -join [Environment]::NewLine
  Write-Utf8NoBom -Path "$LogStem.stdout.log" -Content $stdoutText

  if ($exitCode -ne 0) {
    throw "LibTV command failed with exit code $exitCode. See $LogStem.stdout.log and $stderrPath"
  }
  return $stdoutText
}

if (-not (Test-Path -LiteralPath $ClipPlanPath -PathType Leaf)) {
  throw "Clip plan does not exist: $ClipPlanPath"
}

$resolvedPlanPath = (Resolve-Path -LiteralPath $ClipPlanPath).Path
$plan = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPlanPath | ConvertFrom-Json
if (-not $plan.clips) {
  throw "Clip plan must contain a non-empty 'clips' array."
}

$matchingClips = @($plan.clips | Where-Object { [string]$_.clip_no -eq [string]$ClipNumber })
if ($matchingClips.Count -ne 1) {
  throw "ClipNumber '$ClipNumber' matched $($matchingClips.Count) clips; exactly one is required."
}
$clip = $matchingClips[0]

$prompt = [string]$clip.final_libtv_prompt
if ([string]::IsNullOrWhiteSpace($prompt)) {
  throw "Clip '$ClipNumber' has an empty final_libtv_prompt."
}
if ($prompt -match '\{\{Node\s+"') {
  throw 'final_libtv_prompt contains a name-based {{Node "..."}} placeholder. Use {{Node <nodeKey>}} so LibTV does not rewrite the persisted prompt.'
}

if (-not $clip.libtv) {
  throw "Clip '$ClipNumber' must contain a 'libtv' object."
}
$nodeName = [string]$clip.libtv.node_name
if ([string]::IsNullOrWhiteSpace($nodeName)) {
  throw "Clip '$ClipNumber' must define libtv.node_name."
}
$nodeType = [string]$clip.libtv.node_type
if ([string]::IsNullOrWhiteSpace($nodeType)) {
  $nodeType = 'video'
}
if (-not $clip.libtv.settings) {
  throw "Clip '$ClipNumber' must define libtv.settings."
}

if (-not $TaskAssetRoot -and $plan.task_asset_root) {
  $TaskAssetRoot = [string]$plan.task_asset_root
}
if (-not $Project -and $plan.libtv -and $plan.libtv.project_uuid) {
  $Project = [string]$plan.libtv.project_uuid
}
if (-not $Group -and $plan.libtv -and $plan.libtv.group) {
  $Group = [string]$plan.libtv.group
}

$createArgs = [System.Collections.Generic.List[string]]::new()
$createArgs.Add('node')
$createArgs.Add('create')
$createArgs.Add($nodeName)
$createArgs.Add('-t')
$createArgs.Add($nodeType)
Add-ScopeArguments -Arguments $createArgs

foreach ($leftNode in @($clip.libtv.left_nodes)) {
  if (-not [string]::IsNullOrWhiteSpace([string]$leftNode)) {
    $createArgs.Add('--left')
    $createArgs.Add([string]$leftNode)
  }
}

foreach ($setting in $clip.libtv.settings.PSObject.Properties) {
  $createArgs.Add('-s')
  $createArgs.Add("$($setting.Name)=$(Convert-SettingValue -Value $setting.Value)")
}
$createArgs.Add('--prompt')
$createArgs.Add($prompt)

$queryArgs = [System.Collections.Generic.List[string]]::new()
$queryArgs.Add('node')
$queryArgs.Add($nodeName)
Add-ScopeArguments -Arguments $queryArgs

$runArgs = [System.Collections.Generic.List[string]]::new()
$runArgs.Add('node')
$runArgs.Add($nodeName)
Add-ScopeArguments -Arguments $runArgs
$runArgs.Add('--run')

$manifest = [ordered]@{
  clip_plan_path = $resolvedPlanPath
  clip_no = [string]$clip.clip_no
  node_name = $nodeName
  executable = $LibTvExecutable
  create_arguments = @($createArgs)
  query_arguments = @($queryArgs)
  run_arguments = @($runArgs)
  run_requested = [bool]$Run
}

if ($DryRun) {
  $manifest | ConvertTo-Json -Depth 20
  exit 0
}

if ([string]::IsNullOrWhiteSpace($TaskAssetRoot)) {
  throw "TaskAssetRoot is required, either as a parameter or plan.task_asset_root."
}
if (-not (Test-Path -LiteralPath $TaskAssetRoot -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $TaskAssetRoot | Out-Null
}
$resolvedAssetRoot = (Resolve-Path -LiteralPath $TaskAssetRoot).Path
$logDir = Join-Path $resolvedAssetRoot 'libtv\logs'
$stateDir = Join-Path $resolvedAssetRoot 'libtv\state'
New-Item -ItemType Directory -Force -Path $logDir, $stateDir | Out-Null

$safeClipNumber = ([string]$clip.clip_no) -replace '[^A-Za-z0-9_-]', '_'
$logBase = Join-Path $logDir "clip_${safeClipNumber}"
Write-Utf8NoBom -Path "$logBase.command_manifest.json" -Content ($manifest | ConvertTo-Json -Depth 20)

$null = Invoke-LibTvLogged -Arguments @($createArgs) -LogStem "$logBase.create"
$queryText = Invoke-LibTvLogged -Arguments @($queryArgs) -LogStem "$logBase.query"

try {
  $node = $queryText | ConvertFrom-Json
} catch {
  throw "LibTV node query did not return valid JSON. See $logBase.query.stdout.log"
}

$storedPrompt = $null
if ($node.data -and $node.data.params) {
  $storedPrompt = $node.data.params.prompt
} elseif ($node.node -and $node.node.data -and $node.node.data.params) {
  $storedPrompt = $node.node.data.params.prompt
} elseif ($node.result -and $node.result.data -and $node.result.data.params) {
  $storedPrompt = $node.result.data.params.prompt
}
if ($null -eq $storedPrompt) {
  throw "LibTV node query has no data.params.prompt. See $logBase.query.stdout.log"
}

$expectedNormalized = Normalize-Newlines -Text $prompt
$actualNormalized = Normalize-Newlines -Text ([string]$storedPrompt)
$promptMatches = [System.String]::Equals(
  $expectedNormalized,
  $actualNormalized,
  [System.StringComparison]::Ordinal
)

$state = [ordered]@{
  clip_no = [string]$clip.clip_no
  node_name = $nodeName
  node_key = if ($node.nodeKey) { $node.nodeKey } elseif ($node.data -and $node.data.nodeKey) { $node.data.nodeKey } else { $null }
  final_prompt_match = $promptMatches
  comparison = 'Ordinal after CRLF/CR to LF normalization only'
  generated = $false
}
Write-Utf8NoBom -Path (Join-Path $stateDir "clip_${safeClipNumber}.json") -Content ($state | ConvertTo-Json -Depth 10)

if (-not $promptMatches) {
  throw "LibTV stored prompt differs from JSON final_libtv_prompt; generation was blocked."
}

if ($Run) {
  $null = Invoke-LibTvLogged -Arguments @($runArgs) -LogStem "$logBase.run"
  $state.generated = $true
  Write-Utf8NoBom -Path (Join-Path $stateDir "clip_${safeClipNumber}.json") -Content ($state | ConvertTo-Json -Depth 10)
}

$state | ConvertTo-Json -Depth 10
