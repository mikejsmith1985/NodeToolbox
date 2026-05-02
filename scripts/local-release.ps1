# scripts/local-release.ps1 — Packages NodeToolbox into a distributable zip.
#
# Produces dist/nodetoolbox-vX.Y.Z.zip containing everything an end user needs
# to run NodeToolbox: server.js, package.json + dependencies, public/, scripts/,
# and the generated launcher shortcut. The zip is self-contained — no git history,
# no dev dependencies, no test files.
#
# Usage:
#   .\scripts\local-release.ps1               # full release build
#   .\scripts\local-release.ps1 -DryRun       # print plan, write nothing
#
# Requirements:
#   - Node.js + npm on PATH
#   - Windows (for launcher creation via WScript.Shell)
#   - PowerShell 5.1+ (Compress-Archive is built-in on Windows 10+)

param(
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Constants ──────────────────────────────────────────────────────────────────

$RepoRoot       = Split-Path -Parent $PSScriptRoot
$PackageJson    = Join-Path $RepoRoot 'package.json'
$DistDir        = Join-Path $RepoRoot 'dist'
$LauncherName   = 'Launch Toolbox.lnk'
$LauncherPath   = Join-Path $RepoRoot $LauncherName

# Read version from package.json so the zip filename always matches the release
$PackageData    = Get-Content $PackageJson -Raw | ConvertFrom-Json
$AppVersion     = $PackageData.version
$ZipFileName    = "nodetoolbox-v$AppVersion.zip"
$ZipOutputPath  = Join-Path $DistDir $ZipFileName

# Files and directories included in the distributable
$IncludedPaths = @(
    (Join-Path $RepoRoot 'server.js'),
    (Join-Path $RepoRoot 'package.json'),
    (Join-Path $RepoRoot 'README.md'),
    (Join-Path $RepoRoot '.env.example'),
    (Join-Path $RepoRoot 'public'),
    (Join-Path $RepoRoot 'src'),
    (Join-Path $RepoRoot 'scripts'),
    (Join-Path $RepoRoot 'node_modules'),
    $LauncherPath
)

# ── Dry-Run Output ─────────────────────────────────────────────────────────────

if ($DryRun) {
    Write-Host ""
    Write-Host "  [dry-run] local-release.ps1 would perform the following steps:"
    Write-Host ""
    Write-Host "  1. npm install           — install production + dev dependencies"
    Write-Host "  2. node scripts/create-launcher.js — create $LauncherName"
    Write-Host "  3. mkdir dist\           — create output directory"
    Write-Host "  4. Compress-Archive      — bundle into $ZipOutputPath"
    Write-Host ""
    Write-Host "  Version:    $AppVersion"
    Write-Host "  Output:     $ZipOutputPath (dist\$ZipFileName)"
    Write-Host "  Launcher:   $LauncherPath"
    Write-Host ""
    Write-Host "  Included paths:"
    foreach ($includedItem in $IncludedPaths) {
        $includesExists = if (Test-Path $includedItem) { '' } else { ' [MISSING]' }
        Write-Host "    $includedItem$includesExists"
    }
    Write-Host ""
    Write-Host "  Run without -DryRun to build the release."
    Write-Host ""
    exit 0
}

# ── Full Release Build ─────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  🚀 NodeToolbox Release Builder — v$AppVersion"
Write-Host ""

# Step 1: Install dependencies (production + devDependencies for the launcher script)
Write-Host "  [1/4] npm install..."
Push-Location $RepoRoot
try {
    # Pre-initialize so Set-StrictMode -Version Latest never sees it unset
    $LASTEXITCODE = 0
    npm install --silent
    [int]$npmInstallExitCode = $LASTEXITCODE
    if ($npmInstallExitCode -ne 0) { throw "npm install failed with exit code $npmInstallExitCode" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Dependencies installed"

# Step 2: Create the Windows shortcut
Write-Host "  [2/4] Creating launcher shortcut..."
$nodeOutput = node (Join-Path $RepoRoot 'scripts' 'create-launcher.js') 2>&1
Write-Host "       ✅ $LauncherPath"

# Step 3: Create dist/ output directory (clean slate - remove previous builds)
Write-Host "  [3/4] Preparing dist/ directory..."
if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir | Out-Null
Write-Host "       ✅ dist\ ready"

# Step 4: Build the zip — collect paths that actually exist
Write-Host "  [4/4] Building zip: $ZipFileName..."

# @() ensures these are always arrays even when Where-Object returns $null (strict mode safe)
[array]$pathsToBundle = @($IncludedPaths | Where-Object { Test-Path $_ })
[array]$missingPaths  = @($IncludedPaths | Where-Object { -not (Test-Path $_) })

if ($missingPaths.Count -gt 0) {
    Write-Warning "  ⚠ The following paths are missing and will not be included:"
    foreach ($missingItem in $missingPaths) {
        Write-Warning "    $missingItem"
    }
}

# Build a temp staging folder to flatten the zip layout cleanly
$StagingDir = Join-Path $DistDir 'staging'
New-Item -ItemType Directory -Path $StagingDir | Out-Null

foreach ($sourcePath in $pathsToBundle) {
    $destinationPath = Join-Path $StagingDir (Split-Path $sourcePath -Leaf)
    if (Test-Path $sourcePath -PathType Container) {
        Copy-Item $sourcePath $destinationPath -Recurse -Force
    } else {
        Copy-Item $sourcePath $destinationPath -Force
    }
}

Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipOutputPath -Force

# Clean up staging dir — only the zip should remain in dist/
Remove-Item $StagingDir -Recurse -Force

$zipSizeKb = [math]::Round((Get-Item $ZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ZipOutputPath ($zipSizeKb KB)"
Write-Host ""
Write-Host "  ✅ Release build complete: $ZipOutputPath"
Write-Host ""
