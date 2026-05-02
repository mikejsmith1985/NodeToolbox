# scripts/local-release.ps1 — Packages NodeToolbox into distributable artifacts.
#
# Produces two distributable artifacts in dist/:
#   1. nodetoolbox-vX.Y.Z.zip  — slim zip (no node_modules) for users who prefer extraction
#   2. nodetoolbox-vX.Y.Z.exe  — single-file Windows executable (no extraction required)
# Credentials are stored in AppData\Roaming\NodeToolbox\ and persist across upgrades.
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

# $ErrorActionPreference = 'Stop' causes PowerShell cmdlet errors to terminate
# the script immediately. Set-StrictMode is intentionally omitted: it interacts
# poorly with automatic variables like $LASTEXITCODE on fresh PowerShell sessions
# (throws VariableIsUndefined even on assignment in some versions).
$ErrorActionPreference = 'Stop'

# ── Constants ──────────────────────────────────────────────────────────────────

$RepoRoot       = Split-Path -Parent $PSScriptRoot
$PackageJson    = Join-Path $RepoRoot 'package.json'
$DistDir        = Join-Path $RepoRoot 'dist'
$LauncherName   = 'Launch Toolbox.lnk'
$LauncherPath   = Join-Path $RepoRoot $LauncherName

# The portable bat launcher is always included in the distributable.
# The .lnk shortcut is only relevant when created locally (npm run create-launcher)
# because it embeds absolute paths that are machine-specific.
$BatchLauncherPath = Join-Path $RepoRoot 'Launch Toolbox.bat'

# Read version from package.json so the zip filename always matches the release
$PackageData    = Get-Content $PackageJson -Raw | ConvertFrom-Json
$AppVersion     = $PackageData.version
$ZipFileName    = "nodetoolbox-v$AppVersion.zip"
$ZipOutputPath  = Join-Path $DistDir $ZipFileName
$ExeFileName    = "nodetoolbox-v$AppVersion.exe"
$ExeOutputPath  = Join-Path $DistDir $ExeFileName

# Files and directories included in the distributable.
# Note: Launch Toolbox.bat uses %~dp0 to self-locate — it works from any
# extraction path. The .lnk shortcut is NOT included because it embeds
# absolute paths from the build machine and breaks on the user's machine.
$IncludedPaths = @(
    (Join-Path $RepoRoot 'server.js'),
    (Join-Path $RepoRoot 'package.json'),
    (Join-Path $RepoRoot 'package-lock.json'),
    (Join-Path $RepoRoot 'README.md'),
    (Join-Path $RepoRoot '.env.example'),
    (Join-Path $RepoRoot 'public'),
    (Join-Path $RepoRoot 'src'),
    (Join-Path $RepoRoot 'scripts'),
    $BatchLauncherPath
)

# ── Dry-Run Output ─────────────────────────────────────────────────────────────

if ($DryRun) {
    Write-Host ""
    Write-Host "  [dry-run] local-release.ps1 would perform the following steps:"
    Write-Host ""
    Write-Host "  1. npm install           - install production + dev dependencies"
    Write-Host "  2. mkdir dist\           - create output directory"
    Write-Host "  3. Compress-Archive      - bundle into $ZipOutputPath"
    Write-Host ""
    Write-Host "  Version:    $AppVersion"
    Write-Host "  Output:     $ZipOutputPath (dist\$ZipFileName)"
    Write-Host "  Exe:        $ExeOutputPath (dist\$ExeFileName)"
    Write-Host "  Launcher:   $BatchLauncherPath  (portable -- uses %`~dp0)"
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
Write-Host "  NodeToolbox Release Builder - v$AppVersion"
Write-Host ""

# Step 1: Install dependencies
Write-Host "  [1/4] npm install..."
Push-Location $RepoRoot
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Dependencies installed"

# Step 2: Create dist/ output directory (clean slate - remove previous builds)
Write-Host "  [2/4] Preparing dist/ directory..."
if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir | Out-Null
Write-Host "       ✅ dist\ ready"

# Step 3: Build the zip — collect paths that actually exist
Write-Host "  [3/4] Building zip: $ZipFileName..."

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

# Step 4: Build the single-file Windows exe using @yao-pkg/pkg.
# Bundles Node.js runtime + all app code + public assets into one .exe.
# End users can run NodeToolbox without any extraction or npm install step.
Write-Host "  [4/4] Building exe: $ExeFileName..."
Push-Location $RepoRoot
try {
    npx pkg server.js --targets node20-win-x64 --output $ExeOutputPath --silent
    if ($LASTEXITCODE -ne 0) { throw "pkg build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
$exeSizeKb = [math]::Round((Get-Item $ExeOutputPath).Length / 1KB)
Write-Host "       ✅ $ExeOutputPath ($exeSizeKb KB)"

Write-Host ""
Write-Host "  ✅ Release build complete:"
Write-Host "     ZIP: $ZipOutputPath"
Write-Host "     EXE: $ExeOutputPath"
Write-Host ""
