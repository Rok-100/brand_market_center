$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$tests = Join-Path $root "app\tests"
$failed = @()
$passed = 0

Get-ChildItem -LiteralPath $tests -Filter "*.test.js" -File | Sort-Object Name | ForEach-Object {
    Write-Host "[TEST] $($_.Name)"
    & node $_.FullName
    if ($LASTEXITCODE -ne 0) {
        $failed += $_.Name
    } else {
        $passed += 1
    }
}

Write-Host "Passed files: $passed"
if ($failed.Count -gt 0) {
    Write-Host "Failed files: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "All test files passed." -ForegroundColor Green

