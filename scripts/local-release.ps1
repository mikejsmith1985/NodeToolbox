# scripts/local-release.ps1 — Packages NodeToolbox into distributable artifacts
# and publishes a GitHub Release — all in one command.
#
# Produces two distributable artifacts in dist/:
#   1. nodetoolbox-vX.Y.Z.zip  — slim zip (no node_modules) for users who prefer extraction
#   2. nodetoolbox-vX.Y.Z.exe  — single-file Windows executable (no extraction required)
# Credentials are stored in AppData\Roaming\NodeToolbox\ and persist across upgrades.
#
# Usage:
#   .\scripts\local-release.ps1                  # release at current version
#   .\scripts\local-release.ps1 patch            # bump patch version, then release
#   .\scripts\local-release.ps1 minor            # bump minor version, then release
#   .\scripts\local-release.ps1 major            # bump major version, then release
#   .\scripts\local-release.ps1 patch -DryRun    # preview without writing anything
#
# Requirements:
#   - Node.js + npm on PATH
#   - gh CLI authenticated (gh auth login)
#   - git configured with push access to the remote
#   - PowerShell 5.1+ (Compress-Archive is built-in on Windows 10+)

param(
    # Optional version bump type applied before building. When omitted the
    # current version in package.json is used without modification.
    [Parameter(Position = 0)]
    [ValidateSet('major', 'minor', 'patch', '')]
    [string]$BumpType = '',

    # Preview mode — prints the plan without installing, building, tagging, or publishing.
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

# The portable bat launcher is always included in the distributable.
# The .lnk shortcut is NOT included because it embeds absolute paths from the
# build machine and breaks when the user extracts to a different location.
$BatchLauncherPath  = Join-Path $RepoRoot 'Launch Toolbox.bat'
# The silent VBScript launcher lets users start NodeToolbox without any visible
# console window — useful for corporate users who find the terminal concerning.
$SilentLauncherPath = Join-Path $RepoRoot 'Launch Toolbox Silent.vbs'

# ── Version Resolution ─────────────────────────────────────────────────────────

# Bump package.json version in-place before reading it, if a bump type was given.
# --no-git-tag-version prevents npm from making its own commit and tag — the
# release script handles all git operations explicitly for full control.
if ($BumpType -ne '') {
    Write-Host ""
    Write-Host "  Bumping version ($BumpType)..."
    Push-Location $RepoRoot
    try {
        npm version $BumpType --no-git-tag-version --silent
        if ($LASTEXITCODE -ne 0) { throw "npm version bump failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Write-Host "       ✅ Version bumped"
}

# Read version after any bump so the zip/exe names always match the tag
$PackageData    = Get-Content $PackageJson -Raw | ConvertFrom-Json
$AppVersion     = $PackageData.version
$GitTag         = "v$AppVersion"
$ZipFileName      = "nodetoolbox-v$AppVersion.zip"
$ZipOutputPath    = Join-Path $DistDir $ZipFileName
$ExeFileName      = "nodetoolbox-v$AppVersion.exe"
$ExeOutputPath    = Join-Path $DistDir $ExeFileName
# The exe is shipped inside its own dedicated zip to prevent browser security
# warnings that block direct .exe downloads from GitHub Releases.
$ExeZipFileName   = "nodetoolbox-v$AppVersion-exe.zip"
$ExeZipOutputPath = Join-Path $DistDir $ExeZipFileName

# Files and directories included in the distributable zip.
# node_modules is intentionally excluded — Launch Toolbox.bat auto-installs
# them via "npm ci --omit=dev" on first run, keeping the zip tiny.
$IncludedPaths = @(
    (Join-Path $RepoRoot 'server.js'),
    (Join-Path $RepoRoot 'package.json'),
    (Join-Path $RepoRoot 'package-lock.json'),
    (Join-Path $RepoRoot 'README.md'),
    (Join-Path $RepoRoot '.env.example'),
    (Join-Path $RepoRoot 'public'),
    (Join-Path $RepoRoot 'src'),
    (Join-Path $RepoRoot 'scripts'),
    $BatchLauncherPath,
    $SilentLauncherPath
)

# ── Dry-Run Output ─────────────────────────────────────────────────────────────

if ($DryRun) {
    Write-Host ""
    Write-Host "  [dry-run] local-release.ps1 would perform the following steps:"
    Write-Host ""
    Write-Host "  1. npm install           - install all dependencies (incl. dev tools)"
    if ($BumpType -ne '') {
        Write-Host "  1b. npm version $BumpType    - bump version in package.json + package-lock.json"
    }
    Write-Host "  2. mkdir dist\           - create output directory"
    Write-Host "  3. Compress-Archive      - bundle slim zip into $ZipOutputPath"
    Write-Host "  4. pkg                   - build single-file exe at $ExeOutputPath"
    Write-Host "  4b. Compress-Archive     - wrap exe into $ExeZipOutputPath (browser-safe download)"
    Write-Host "  5. gh release create     - publish GitHub Release $GitTag with both artifacts"
    Write-Host ""
    Write-Host "  Version:    $AppVersion"
    Write-Host "  Tag:        $GitTag"
    Write-Host "  Output:     $ZipOutputPath (dist\$ZipFileName)"
    Write-Host "  Exe:        $ExeOutputPath (dist\$ExeFileName)"
    Write-Host "  Exe zip:    $ExeZipOutputPath (dist\$ExeZipFileName)"
    Write-Host "  Launcher:   $BatchLauncherPath  (portable -- uses %`~dp0)"
    Write-Host "  Silent:     $SilentLauncherPath  (headless -- hides console)"
    Write-Host ""
    Write-Host "  Included paths:"
    foreach ($includedItem in $IncludedPaths) {
        $itemExists = if (Test-Path $includedItem) { '' } else { ' [MISSING]' }
        Write-Host "    $includedItem$itemExists"
    }
    Write-Host ""
    Write-Host "  Run without -DryRun to build and publish the release."
    Write-Host ""
    exit 0
}

# ── Full Release Build ─────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  NodeToolbox Release Builder - v$AppVersion"
Write-Host ""

# Step 1: Install all dependencies (including @yao-pkg/pkg for the exe build)
Write-Host "  [1/5] npm install..."
Push-Location $RepoRoot
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Dependencies installed"

# Step 2: Create dist/ output directory (clean slate — remove previous builds)
Write-Host "  [2/5] Preparing dist/ directory..."
if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir | Out-Null
Write-Host "       ✅ dist\ ready"

# Step 3: Build the slim zip — collect paths that actually exist
Write-Host "  [3/5] Building zip: $ZipFileName..."

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

# Clean up staging dir — only the final artifacts should remain in dist/
Remove-Item $StagingDir -Recurse -Force

$zipSizeKb = [math]::Round((Get-Item $ZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ZipOutputPath ($zipSizeKb KB)"

# Step 4: Build the single-file Windows exe using @yao-pkg/pkg.
# Bundles the Node.js runtime + all app code + public assets into one .exe.
# End users can run NodeToolbox without any extraction or npm install step.
Write-Host "  [4/5] Building exe: $ExeFileName..."
Push-Location $RepoRoot
try {
    npx pkg server.js --targets node20-win-x64 --output $ExeOutputPath --silent
    if ($LASTEXITCODE -ne 0) { throw "pkg build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
$exeSizeKb = [math]::Round((Get-Item $ExeOutputPath).Length / 1KB)
Write-Host "       ✅ $ExeOutputPath ($exeSizeKb KB)"

# Wrap the exe in its own dedicated zip so users can download it without
# browser security warnings that block direct .exe file downloads.
# Also include the silent VBScript launcher so exe users can hide the terminal.
$ExeZipStagingDir = Join-Path $DistDir 'exe-staging'
New-Item -ItemType Directory -Path $ExeZipStagingDir | Out-Null
Copy-Item $ExeOutputPath $ExeZipStagingDir -Force
if (Test-Path $SilentLauncherPath) {
    Copy-Item $SilentLauncherPath $ExeZipStagingDir -Force
}
Compress-Archive -Path (Join-Path $ExeZipStagingDir '*') -DestinationPath $ExeZipOutputPath -Force
Remove-Item $ExeZipStagingDir -Recurse -Force
$exeZipSizeKb = [math]::Round((Get-Item $ExeZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ExeZipOutputPath ($exeZipSizeKb KB)"

# Step 5: Commit version bump (if applicable), tag, and publish GitHub Release.
# gh release create handles creating the release AND uploading the assets in one
# command. We force-delete any existing release/tag of the same version first so
# re-running the script always produces a clean, up-to-date release.
Write-Host "  [5/5] Publishing GitHub Release $GitTag..."

Push-Location $RepoRoot
try {
    # Commit the version bump files if npm version changed them
    if ($BumpType -ne '') {
        git add package.json package-lock.json
        git commit -m "chore: bump version to $GitTag"
        git push origin HEAD
        if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }
    }

    # Remove any stale local tag so we can recreate it pointing at HEAD
    git tag -d $GitTag 2>&1 | Out-Null

    # Remove the existing GitHub Release and remote tag if they exist —
    # this makes the publish step idempotent (safe to re-run after a failed build)
    $releaseExists = gh release view $GitTag 2>&1
    if ($LASTEXITCODE -eq 0) {
        gh release delete $GitTag --yes 2>&1 | Out-Null
    }
    git push origin ":refs/tags/$GitTag" 2>&1 | Out-Null  # delete remote tag if present

    # Create the tag on the current HEAD and push it
    git tag $GitTag
    git push origin $GitTag
    if ($LASTEXITCODE -ne 0) { throw "git push tag failed with exit code $LASTEXITCODE" }

    # Create the GitHub Release and attach both artifacts.
    # $ExeZipOutputPath is used instead of the raw .exe so users aren't blocked
    # by browser security warnings that flag unsigned .exe direct downloads.
    gh release create $GitTag $ZipOutputPath $ExeZipOutputPath `
        --title "NodeToolbox $GitTag" `
        --generate-notes `
        --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "       ✅ GitHub Release $GitTag published"
Write-Host ""
Write-Host "  ✅ Release complete:"
Write-Host "     ZIP: $ZipOutputPath"
Write-Host "     EXE: $ExeZipOutputPath"
Write-Host "     URL: https://github.com/mikejsmith1985/NodeToolbox/releases/tag/$GitTag"
Write-Host ""
