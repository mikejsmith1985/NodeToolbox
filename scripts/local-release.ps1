# scripts/local-release.ps1 — Packages NodeToolbox into distributable artifacts
# and publishes a GitHub Release — all in one command.
#
# Produces two distributable artifacts:
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
    # Optional version bump type or explicit version number.
    # Accepts: 'major', 'minor', 'patch' (increments from current), or an
    # explicit semver like '1.2.3' (sets that exact version regardless of current).
    # When omitted, the current version in package.json is used without modification.
    [Parameter(Position = 0)]
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

# Bump or set package.json version before reading it, if a bump type or explicit
# version was given.
# --no-git-tag-version prevents npm from making its own commit and tag — the
# release script handles all git operations explicitly for full control.
# --allow-same-version lets re-runs safely set the same version without erroring
# (useful when a previous release attempt partially bumped the version).
if ($BumpType -ne '') {
    Write-Host ""
    if ($BumpType -match '^\d+\.\d+\.\d+$') {
        # Explicit version string (e.g. "0.0.14") — set it directly.
        # This prevents double-bumping when the Release Manager card passes an exact
        # next-version rather than a relative bump type.
        Write-Host "  Setting explicit version ($BumpType)..."
    } else {
        Write-Host "  Bumping version ($BumpType)..."
    }
    Push-Location $RepoRoot
    try {
        npm version $BumpType --no-git-tag-version --allow-same-version --silent
        if ($LASTEXITCODE -ne 0) { throw "npm version bump failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    Write-Host "       ✅ Version set"
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
    Write-Host "  3. npm run build:client  - compile React SPA into client/dist/"
    Write-Host "  4. Compress-Archive      - bundle slim zip into $ZipOutputPath"
    Write-Host "  5. pkg                   - build self-contained exe at $ExeOutputPath (client/dist bundled inside)"
    Write-Host "  5b. Compress-Archive     - wrap exe + VBS into $ExeZipOutputPath (browser-safe download)"
    Write-Host "  6. gh release create     - publish GitHub Release $GitTag with zip and exe-zip"
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
Write-Host "  [1/6] npm install..."
Push-Location $RepoRoot
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Dependencies installed"

# Step 2: Create dist/ output directory (clean slate — remove previous builds)
Write-Host "  [2/6] Preparing dist/ directory..."
if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir | Out-Null
Write-Host "       ✅ dist\ ready"

# Step 3: Build the React SPA — must run before ZIP creation so client/dist/ exists.
# The compiled output is bundled into both the zip (as client/dist/) and the exe
# snapshot (via the "assets" array in package.json).
Write-Host "  [3/6] Building React client..."
Push-Location (Join-Path $RepoRoot 'client')
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "React client build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ React client built (client/dist/)"

# Step 3.5: Bake the React build into a JS module so pkg embeds it as bytecode.
# This is required because @yao-pkg/pkg's `assets` snapshot virtual filesystem
# silently fails to include client/dist/ in some environments. Embedding the
# files as base64 Buffer literals in src/embeddedClient.js guarantees the SPA
# ships inside the executable — pkg always bundles JS source as bytecode.
Write-Host "  [3.5/6] Embedding React build for pkg..."
Push-Location $RepoRoot
try {
    node scripts/generate-embedded-client.js
    if ($LASTEXITCODE -ne 0) { throw "Embedded-client generation failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Embedded client generated (src/embeddedClient.js)"

# Step 4: Build the slim zip — collect paths that actually exist
Write-Host "  [4/6] Building zip: $ZipFileName..."

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

# Copy the React build into client/dist/ preserving the directory hierarchy so
# server.js finds it at path.join(__dirname, 'client', 'dist', 'index.html').
# The staging loop above uses Split-Path -Leaf which would flatten client/dist
# into a top-level dist/ — this dedicated step avoids that flattening.
$clientDistSource  = Join-Path $RepoRoot 'client\dist'
$clientDirInStaging = Join-Path $StagingDir 'client'
New-Item -ItemType Directory -Path $clientDirInStaging -Force | Out-Null
Copy-Item $clientDistSource (Join-Path $clientDirInStaging 'dist') -Recurse -Force

Compress-Archive -Path (Join-Path $StagingDir '*') -DestinationPath $ZipOutputPath -Force

# Clean up staging dir — only the final artifacts should remain in dist/
Remove-Item $StagingDir -Recurse -Force

$zipSizeKb = [math]::Round((Get-Item $ZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ZipOutputPath ($zipSizeKb KB)"

# Step 5: Build the single-file Windows exe using @yao-pkg/pkg.
# Bundles the Node.js runtime + all app code + public assets into one .exe.
# End users can run NodeToolbox without any extraction or npm install step.
Write-Host "  [5/6] Building exe: $ExeFileName..."
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
# Include the silent VBScript launcher and client/dist/ alongside the exe.
#
# client/dist/ serves as a belt-and-suspenders fallback: the React SPA is
# bundled inside the exe via pkg.assets (primary path), but server.js also
# checks path.dirname(process.execPath) in case the snapshot is inaccessible.
# Shipping client/dist/ in the exe-zip ensures it is always available on disk.
$ExeZipStagingDir = Join-Path $DistDir 'exe-staging'
New-Item -ItemType Directory -Path $ExeZipStagingDir | Out-Null
Copy-Item $ExeOutputPath $ExeZipStagingDir -Force
if (Test-Path $SilentLauncherPath) {
    Copy-Item $SilentLauncherPath $ExeZipStagingDir -Force
}

# Copy client/dist → exe-staging/client/dist so it is available on real disk
# next to the exe after extraction (fallback if snapshot serving fails).
$clientDirInExeStaging = Join-Path $ExeZipStagingDir 'client'
New-Item -ItemType Directory -Path $clientDirInExeStaging -Force | Out-Null
Copy-Item (Join-Path $RepoRoot 'client\dist') (Join-Path $clientDirInExeStaging 'dist') -Recurse -Force

Compress-Archive -Path (Join-Path $ExeZipStagingDir '*') -DestinationPath $ExeZipOutputPath -Force
Remove-Item $ExeZipStagingDir -Recurse -Force
$exeZipSizeKb = [math]::Round((Get-Item $ExeZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ExeZipOutputPath ($exeZipSizeKb KB)"

# Step 6: Commit version bump (if applicable), merge to main, tag, and publish.
# The release tag must live on main so that all future git describe calls see it
# regardless of which branch they're on.
Write-Host "  [6/6] Publishing GitHub Release $GitTag..."

Push-Location $RepoRoot
try {
    $originalBranch = git branch --show-current 2>$null

    # Commit the version bump files if npm version changed them.
    # toolbox.html is included because the TOOLBOX_VERSION literal was patched above.
    if ($BumpType -ne '') {
        git add package.json package-lock.json
        git commit -m "chore: bump version to $GitTag`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
        git push origin HEAD
        if ($LASTEXITCODE -ne 0) { throw "git push of version bump failed with exit code $LASTEXITCODE" }
    }

    # Merge the current branch into main so the release tag lives on main.
    # This ensures `git describe` returns the correct version from any branch after
    # the release and keeps the release history on the primary branch.
    Write-Host "       Merging '$originalBranch' → main..."
    git checkout main
    if ($LASTEXITCODE -ne 0) { throw "git checkout main failed" }
    git pull origin main
    if ($LASTEXITCODE -ne 0) { throw "git pull main failed" }
    git merge $originalBranch --no-edit
    if ($LASTEXITCODE -ne 0) { throw "git merge $originalBranch failed - resolve conflicts then re-run" }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "git push main failed with exit code $LASTEXITCODE" }
    Write-Host "       ✅ Merged and pushed to main"

    # Remove any stale local tag so we can recreate it pointing at HEAD (main).
    # Guard with git tag -l first to avoid a NativeCommandError under
    # $ErrorActionPreference = 'Stop' when no local tag exists.
    $existingLocalTag = git tag -l $GitTag 2>$null
    if ($existingLocalTag) {
        Write-Host "       Removing stale local tag $GitTag..."
        git tag -d $GitTag | Out-Null
    }

    # Remove the existing GitHub Release and remote tag if they exist —
    # this makes the publish step idempotent (safe to re-run after a failed build).
    # Use try/catch: gh release view exits non-zero (throwing NativeCommandError
    # under $ErrorActionPreference = 'Stop') when no release exists.
    $releaseExists = $false
    try { $null = gh release view $GitTag 2>$null; $releaseExists = $true } catch { $releaseExists = $false }
    if ($releaseExists) {
        gh release delete $GitTag --yes 2>&1 | Out-Null
    }
    # Delete remote tag if it exists — wrapped in try/catch because git returns a
    # non-zero exit code (and writes to stderr) when the tag is absent, which triggers
    # a NativeCommandError under $ErrorActionPreference = 'Stop'.
    try { git push origin ":refs/tags/$GitTag" 2>$null } catch { <# tag not present remotely, nothing to delete #> }

    # Create the tag on main HEAD and push it
    git tag $GitTag
    git push origin $GitTag
    if ($LASTEXITCODE -ne 0) { throw "git push tag failed with exit code $LASTEXITCODE" }

    # Return to the original feature branch so the developer's workspace is unchanged.
    # git writes "Switched to branch '...'" to stderr even on success, which triggers a
    # NativeCommandError under $ErrorActionPreference = 'Stop'. The --quiet flag suppresses
    # that informational message; the try/catch handles any residual stderr output safely.
    try { git checkout --quiet $originalBranch } catch { <# stderr noise from git, not a real error #> }

    # Create the GitHub Release and attach two artifacts:
    #   1. Slim zip  — for users who extract and run via npm / bat launcher
    #   2. Exe zip   — for users who want a single-file Windows executable
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
Write-Host "     ZIP:  $ZipOutputPath"
Write-Host "     EXE:  $ExeZipOutputPath"
Write-Host "     URL:  https://github.com/mikejsmith1985/NodeToolbox/releases/tag/$GitTag"
Write-Host ""
