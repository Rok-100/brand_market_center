[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ClipPlanPath,

  [string]$TaskAssetRoot,
  [string]$Project,
  [string]$Group,
  [string]$LibTvExecutable = 'libtv',
  [string]$WorkingDirectory = (Get-Location).Path,
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

if (-not (Test-Path -LiteralPath $ClipPlanPath -PathType Leaf)) {
  throw "Clip plan does not exist: $ClipPlanPath"
}
if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
  throw "WorkingDirectory does not exist: $WorkingDirectory"
}

$resolvedPlanPath = (Resolve-Path -LiteralPath $ClipPlanPath).Path
$resolvedWorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$plan = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedPlanPath | ConvertFrom-Json
$clips = @($plan.clips)
if ($clips.Count -eq 0) {
  throw "Clip plan must contain a non-empty 'clips' array."
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

$clipNumbers = @{}
$nodeNames = @{}
foreach ($clip in $clips) {
  $clipNumber = [string]$clip.clip_no
  $nodeName = [string]$clip.libtv.node_name
  if ([string]::IsNullOrWhiteSpace($clipNumber)) {
    throw 'Every clip must define clip_no.'
  }
  if ([string]::IsNullOrWhiteSpace($nodeName)) {
    throw "Clip '$clipNumber' must define libtv.node_name."
  }
  if ($clipNumbers.ContainsKey($clipNumber)) {
    throw "Duplicate clip_no: $clipNumber"
  }
  if ($nodeNames.ContainsKey($nodeName)) {
    throw "Duplicate libtv.node_name: $nodeName"
  }
  $clipNumbers[$clipNumber] = $true
  $nodeNames[$nodeName] = $true
}

$singleClipScript = Join-Path $PSScriptRoot 'invoke-libtv-clip-plan.ps1'
if (-not (Test-Path -LiteralPath $singleClipScript -PathType Leaf)) {
  throw "Single-clip preparation script is missing: $singleClipScript"
}

$command = Get-Command $LibTvExecutable -ErrorAction Stop
$resolvedExecutable = if ($command.Source) { $command.Source } else { $command.Definition }

$dryRunSummary = [ordered]@{
  clip_plan_path = $resolvedPlanPath
  task_asset_root = $TaskAssetRoot
  phase_1 = 'Create and strictly verify every node sequentially; start no generation if any verification fails.'
  phase_2 = 'Start one independent blocking libtv node --run process per clip at the same time.'
  concurrent_clip_count = $clips.Count
  nodes = @($clips | ForEach-Object {
    [ordered]@{
      clip_no = [string]$_.clip_no
      node_name = [string]$_.libtv.node_name
    }
  })
}
if ($DryRun) {
  $dryRunSummary | ConvertTo-Json -Depth 20
  exit 0
}

if ([string]::IsNullOrWhiteSpace($TaskAssetRoot)) {
  throw 'TaskAssetRoot is required, either as a parameter or plan.task_asset_root.'
}
if (-not (Test-Path -LiteralPath $TaskAssetRoot -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $TaskAssetRoot | Out-Null
}
$resolvedAssetRoot = (Resolve-Path -LiteralPath $TaskAssetRoot).Path
$logDir = Join-Path $resolvedAssetRoot 'libtv\logs'
$stateDir = Join-Path $resolvedAssetRoot 'libtv\state'
New-Item -ItemType Directory -Force -Path $logDir, $stateDir | Out-Null

# Phase 1 is intentionally sequential: create each node, query it, and prove that
# data.params.prompt matches JSON final_libtv_prompt before any generation starts.
foreach ($clip in $clips) {
  $prepareParams = @{
    ClipPlanPath = $resolvedPlanPath
    ClipNumber = [string]$clip.clip_no
    TaskAssetRoot = $resolvedAssetRoot
    LibTvExecutable = $resolvedExecutable
  }
  if ($Project) {
    $prepareParams.Project = $Project
  }
  if ($Group) {
    $prepareParams.Group = $Group
  }
  & $singleClipScript @prepareParams | Out-Null
}

$jobSpecs = @()
foreach ($clip in $clips) {
  $clipNumber = [string]$clip.clip_no
  $safeClipNumber = $clipNumber -replace '[^A-Za-z0-9_-]', '_'
  $statePath = Join-Path $stateDir "clip_${safeClipNumber}.json"
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
    throw "Verified state is missing for clip '$clipNumber': $statePath"
  }
  $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $statePath | ConvertFrom-Json
  if ($state.final_prompt_match -ne $true) {
    throw "Clip '$clipNumber' did not pass strict final prompt verification."
  }

  $nodeTarget = if ($state.node_key) { [string]$state.node_key } else { [string]$clip.libtv.node_name }
  $runArgs = [System.Collections.Generic.List[string]]::new()
  $runArgs.Add('node')
  $runArgs.Add($nodeTarget)
  Add-ScopeArguments -Arguments $runArgs
  $runArgs.Add('--run')

  $jobSpecs += [ordered]@{
    clip_no = $clipNumber
    node_name = [string]$clip.libtv.node_name
    node_target = $nodeTarget
    executable = $resolvedExecutable
    arguments = @($runArgs)
    working_directory = $resolvedWorkingDirectory
    stdout_path = Join-Path $logDir "clip_${safeClipNumber}.run.parallel.stdout.log"
    stderr_path = Join-Path $logDir "clip_${safeClipNumber}.run.parallel.stderr.log"
    state_path = $statePath
  }
}

$parallelManifestPath = Join-Path $logDir 'parallel_run_manifest.json'
Write-Utf8NoBom -Path $parallelManifestPath -Content ($jobSpecs | ConvertTo-Json -Depth 20)

$worker = {
  param([string]$SpecJson)

  $ErrorActionPreference = 'Stop'
  $spec = $SpecJson | ConvertFrom-Json
  $startedAt = [DateTimeOffset]::UtcNow
  try {
    Set-Location -LiteralPath $spec.working_directory
    $commandArguments = @($spec.arguments | ForEach-Object { [string]$_ })
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      # Preserve LibTV's native stderr as a per-clip log instead of allowing
      # Windows PowerShell to promote it into a terminating ErrorRecord.
      $ErrorActionPreference = 'Continue'
      $stdoutLines = @(& $spec.executable @commandArguments 2> $spec.stderr_path)
      $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { [int]$LASTEXITCODE }
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    $stdoutText = $stdoutLines -join [Environment]::NewLine
    [System.IO.File]::WriteAllText(
      $spec.stdout_path,
      $stdoutText,
      [System.Text.UTF8Encoding]::new($false)
    )
    [pscustomobject]@{
      clip_no = [string]$spec.clip_no
      node_name = [string]$spec.node_name
      exit_code = $exitCode
      error = $null
      started_at_utc = $startedAt.ToString('o')
      ended_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
      stdout_path = [string]$spec.stdout_path
      stderr_path = [string]$spec.stderr_path
      state_path = [string]$spec.state_path
    }
  } catch {
    [pscustomobject]@{
      clip_no = [string]$spec.clip_no
      node_name = [string]$spec.node_name
      exit_code = 1
      error = $_.Exception.Message
      started_at_utc = $startedAt.ToString('o')
      ended_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
      stdout_path = [string]$spec.stdout_path
      stderr_path = [string]$spec.stderr_path
      state_path = [string]$spec.state_path
    }
  }
}

# Every job starts before waiting. Each libtv --run remains a normal blocking CLI
# process that performs its own internal polling and writes to independent files.
$jobs = @()
foreach ($spec in $jobSpecs) {
  $jobs += Start-Job -ScriptBlock $worker -ArgumentList ($spec | ConvertTo-Json -Depth 20 -Compress)
}

try {
  Wait-Job -Job $jobs | Out-Null
  $receivedResults = @($jobs | Receive-Job)
} finally {
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
}

$results = @($receivedResults | ForEach-Object {
  [pscustomobject]@{
    clip_no = [string]$_.clip_no
    node_name = [string]$_.node_name
    exit_code = [int]$_.exit_code
    error = $_.error
    started_at_utc = [string]$_.started_at_utc
    ended_at_utc = [string]$_.ended_at_utc
    stdout_path = [string]$_.stdout_path
    stderr_path = [string]$_.stderr_path
    state_path = [string]$_.state_path
  }
})

foreach ($result in $results) {
  $state = Get-Content -Raw -Encoding UTF8 -LiteralPath $result.state_path | ConvertFrom-Json
  $state.generated = ($result.exit_code -eq 0)
  $parallelRunState = [ordered]@{
    exit_code = [int]$result.exit_code
    error = $result.error
    started_at_utc = $result.started_at_utc
    ended_at_utc = $result.ended_at_utc
    stdout_path = $result.stdout_path
    stderr_path = $result.stderr_path
  }
  $state | Add-Member -NotePropertyName parallel_run -NotePropertyValue $parallelRunState -Force
  Write-Utf8NoBom -Path $result.state_path -Content ($state | ConvertTo-Json -Depth 20)
}

$orderedResults = @($results | Sort-Object { [string]$_.clip_no })
$summary = [ordered]@{
  clip_plan_path = $resolvedPlanPath
  concurrent_clip_count = $clips.Count
  all_succeeded = (@($orderedResults | Where-Object { $_.exit_code -ne 0 }).Count -eq 0)
  results = $orderedResults
}
$summaryPath = Join-Path $stateDir 'parallel_run_summary.json'
Write-Utf8NoBom -Path $summaryPath -Content ($summary | ConvertTo-Json -Depth 20)

if (-not $summary.all_succeeded) {
  throw "One or more concurrent LibTV runs failed. See $summaryPath"
}

$summary | ConvertTo-Json -Depth 20
