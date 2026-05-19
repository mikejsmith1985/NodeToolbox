# scripts/local-release.ps1 — Packages NodeToolbox into distributable artifacts
# and publishes a GitHub Release — all in one command.
#
# Produces one distributable artifact:
#   1. nodetoolbox-vX.Y.Z-exe.zip — stable launchers plus versions\X.Y.Z\nodetoolbox.exe
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

$PayloadExeFileName   = "nodetoolbox.exe"
$PayloadExeOutputPath = Join-Path $DistDir $PayloadExeFileName
# Keep the -exe.zip suffix because existing Admin Hub updaters download this
# asset name. It is now the only user-facing artifact, so there is no choice to make.
$ReleaseZipFileName   = "nodetoolbox-v$AppVersion-exe.zip"
$ReleaseZipOutputPath = Join-Path $DistDir $ReleaseZipFileName

# Stable launchers included at the top level of the distributable zip.
# node_modules is intentionally excluded because end users run the bundled exe.
$IncludedPaths = @(
    (Join-Path $RepoRoot 'README.md'),
    $BatchLauncherPath,
    $SilentLauncherPath
)

# ── Dry-Run Output ─────────────────────────────────────────────────────────────

if ($DryRun) {
    Write-Host ""
    Write-Host "  [dry-run] local-release.ps1 would perform the following steps:"
    Write-Host ""
    Write-Host "  1. npm install           - install root dependencies (incl. dev tools)"
    Write-Host "  1c. cd client; npm install - install React client dependencies for fresh clones"
    if ($BumpType -ne '') {
        Write-Host "  1b. npm version $BumpType    - bump version in package.json + package-lock.json"
    }
    Write-Host "  2. mkdir dist\           - create output directory"
    Write-Host "  3. npm run build:client  - compile React SPA into client/dist/"
    Write-Host "  4. pkg                   - build self-contained payload exe at $PayloadExeOutputPath"
    Write-Host "  5. Compress-Archive      - bundle one user-facing zip into $ReleaseZipOutputPath"
    Write-Host "  6. gh release create     - publish GitHub Release $GitTag with the single zip asset"
    Write-Host ""
    Write-Host "  Version:    $AppVersion"
    Write-Host "  Tag:        $GitTag"
    Write-Host "  Output:     $ReleaseZipOutputPath (dist\$ReleaseZipFileName)"
    Write-Host "  Payload:    $PayloadExeOutputPath (dist\$PayloadExeFileName)"
    Write-Host "  Launcher:   $BatchLauncherPath  (portable -- uses %`~dp0)"
    Write-Host "  Silent:     $SilentLauncherPath  (headless -- hides console)"
    Write-Host "  Layout:     current.txt + versions\$AppVersion\nodetoolbox.exe"
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

# Step 1: Install both root and client dependencies so the release works from a
# fresh clone, not just from a developer machine that already built the client.
Write-Host "  [1/6] Installing root and client dependencies..."
Push-Location $RepoRoot
try {
    npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

    Push-Location (Join-Path $RepoRoot 'client')
    try {
        npm install --silent
        if ($LASTEXITCODE -ne 0) { throw "client npm install failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
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

# Step 4: Build the single-file Windows exe using @yao-pkg/pkg.
# Bundles the Node.js runtime + all app code + public assets into one .exe.
# End users can run NodeToolbox without any extraction or npm install step.
Write-Host "  [4/6] Building payload exe: $PayloadExeFileName..."
Push-Location $RepoRoot
try {
    # Note: --silent is intentionally omitted so build errors are visible in
    # the release log. pkg output goes to stderr and is captured on failure.
    npx pkg server.js --targets node20-win-x64 --output $PayloadExeOutputPath
    if ($LASTEXITCODE -ne 0) { throw "pkg build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
$exeSizeKb = [math]::Round((Get-Item $PayloadExeOutputPath).Length / 1KB)
Write-Host "       ✅ $PayloadExeOutputPath ($exeSizeKb KB)"

# Step 5: Build the single user-facing zip. The top-level launchers never change
# location; current.txt points them at versions\<version>\nodetoolbox.exe.
Write-Host "  [5/6] Building one release zip: $ReleaseZipFileName..."

$ReleaseStagingDir = Join-Path $DistDir 'release-staging'
New-Item -ItemType Directory -Path $ReleaseStagingDir | Out-Null

foreach ($sourcePath in @($IncludedPaths | Where-Object { Test-Path $_ })) {
    Copy-Item $sourcePath (Join-Path $ReleaseStagingDir (Split-Path $sourcePath -Leaf)) -Force
}

Set-Content -Path (Join-Path $ReleaseStagingDir 'current.txt') -Value $AppVersion -Encoding ASCII

$versionDirectory = Join-Path $ReleaseStagingDir "versions\$AppVersion"
New-Item -ItemType Directory -Path $versionDirectory -Force | Out-Null
Copy-Item $PayloadExeOutputPath (Join-Path $versionDirectory 'nodetoolbox.exe') -Force

# Root compatibility files let currently-shipped flat-layout updaters consume
# this single asset once. Future updates use versions\ + current.txt only.
Copy-Item $PayloadExeOutputPath (Join-Path $ReleaseStagingDir "nodetoolbox-v$AppVersion.exe") -Force
$legacyClientDirectory = Join-Path $ReleaseStagingDir 'client'
New-Item -ItemType Directory -Path $legacyClientDirectory -Force | Out-Null
Copy-Item (Join-Path $RepoRoot 'client\dist') (Join-Path $legacyClientDirectory 'dist') -Recurse -Force

Compress-Archive -Path (Join-Path $ReleaseStagingDir '*') -DestinationPath $ReleaseZipOutputPath -Force
Remove-Item $ReleaseStagingDir -Recurse -Force
$releaseZipSizeKb = [math]::Round((Get-Item $ReleaseZipOutputPath).Length / 1KB)
Write-Host "       ✅ $ReleaseZipOutputPath ($releaseZipSizeKb KB)"

# Step 6: Commit version bump (if applicable), merge to main, tag, and publish.
# The release tag must live on main so that all future git describe calls see it
# regardless of which branch they're on.
Write-Host "  [6/6] Publishing GitHub Release $GitTag..."

Push-Location $RepoRoot
try {
    $originalBranch = git branch --show-current 2>$null

    # Commit the version bump files if npm version changed them.
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

    # Create the GitHub Release with one asset so first-time users have exactly
    # one obvious download. The zip contains stable launchers plus the versioned exe.
    gh release create $GitTag $ReleaseZipOutputPath `
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
Write-Host "     ZIP:  $ReleaseZipOutputPath"
Write-Host "     URL:  https://github.com/mikejsmith1985/NodeToolbox/releases/tag/$GitTag"
Write-Host ""
