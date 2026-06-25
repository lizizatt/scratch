# Update the vendored Superpowers submodule to the latest upstream release.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

Write-Host "Updating vendor/superpowers..."
git submodule update --init vendor/superpowers
git submodule update --remote vendor/superpowers

$pluginJson = Join-Path $repoRoot 'vendor\superpowers\.cursor-plugin\plugin.json'
if (Test-Path $pluginJson) {
    $manifest = Get-Content $pluginJson -Raw | ConvertFrom-Json
    $commit = git -C vendor/superpowers rev-parse --short HEAD
    Write-Host "Superpowers $($manifest.version) @ $commit"
}

Write-Host "Reload Cursor (Developer: Reload Window) to pick up changes."
