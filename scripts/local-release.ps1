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
#   .\scripts\local-release.ps1 patch -KeepBranch # release but keep the feature branch
#
# After publishing, the merged feature branch is deleted (local + remote) by
# default so branches don't accumulate; pass -KeepBranch to preserve it.
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
    [switch]$DryRun,

    # Keep the feature branch after release. By default the script deletes the
    # just-merged feature branch (locally and on the remote) once the release is
    # published, because its work now lives on main and the branch is only clutter.
    # Pass -KeepBranch to preserve it (e.g. when continuing work on the same branch).
    [switch]$KeepBranch
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

<#
.SYNOPSIS
  Works out the version a bump WOULD produce, without touching anything.
.DESCRIPTION
  This exists so -DryRun can name the version, tag and zip accurately while writing nothing. It
  mirrors what `npm version <type>` does: an explicit semver is taken verbatim; major/minor/patch
  increment the current version and zero the parts below.
#>
function Resolve-NextVersion {
    param(
        [Parameter(Mandatory = $true)][string]$CurrentVersion,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$BumpType
    )

    if ($BumpType -eq '') { return $CurrentVersion }
    # An explicit version is used as given — this is what stops a re-run double-bumping.
    if ($BumpType -match '^\d+\.\d+\.\d+$') { return $BumpType }

    if ($CurrentVersion -notmatch '^(\d+)\.(\d+)\.(\d+)') {
        throw "Cannot bump '$CurrentVersion' - it is not a major.minor.patch version."
    }
    $currentMajor = [int]$Matches[1]
    $currentMinor = [int]$Matches[2]
    $currentPatch = [int]$Matches[3]

    switch ($BumpType) {
        'major' { return "$($currentMajor + 1).0.0" }
        'minor' { return "$currentMajor.$($currentMinor + 1).0" }
        'patch' { return "$currentMajor.$currentMinor.$($currentPatch + 1)" }
        default { throw "Unknown bump type '$BumpType'. Use major, minor, patch, or an explicit version like 1.2.3." }
    }
}

# ── Dependency Install Skip ────────────────────────────────────────────────────

<#
.SYNOPSIS
  Returns the SHA-256 hash of a directory's package-lock.json, or '' when absent.
.DESCRIPTION
  The lockfile hash is the identity of an npm install: same lockfile, same node_modules.
  Used to decide whether the previous release's install is still current.
#>
function Get-LockFileHash {
    param([Parameter(Mandatory = $true)][string]$DirectoryPath)
    $lockFilePath = Join-Path $DirectoryPath 'package-lock.json'
    if (-not (Test-Path $lockFilePath)) { return '' }
    return (Get-FileHash $lockFilePath -Algorithm SHA256).Hash
}

<#
.SYNOPSIS
  Runs npm install only when the lockfile changed since the last release.
.DESCRIPTION
  The previous release stamps the lockfile hash inside node_modules after installing.
  When the stamp matches this release's pre-bump hash, node_modules is already exactly
  what npm install would produce, so the (slow) install is skipped. A fresh clone has
  no stamp and always installs — the "works from a fresh clone" guarantee is preserved.
#>
function Install-DependenciesIfStale {
    param(
        [Parameter(Mandatory = $true)][string]$DirectoryPath,
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PreBumpLockHash
    )
    $stampFilePath = Join-Path $DirectoryPath 'node_modules\.forge-release-install-stamp'
    $hasCurrentInstall = ($PreBumpLockHash -ne '') -and (Test-Path $stampFilePath) -and
        ((Get-Content $stampFilePath -Raw).Trim() -eq $PreBumpLockHash)

    if ($hasCurrentInstall) {
        Write-Host "       ✅ $Label dependencies unchanged since last release - install skipped"
    } else {
        Push-Location $DirectoryPath
        try {
            npm install --silent --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "$Label npm install failed with exit code $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
        Write-Host "       ✅ $Label dependencies installed"
    }

    # Stamp the lockfile as it stands NOW - after the version bump rewrote its version
    # fields - so the NEXT release's pre-bump hash (taken from this exact file) matches.
    Set-Content -Path $stampFilePath -Value (Get-LockFileHash -DirectoryPath $DirectoryPath) -Encoding ASCII
}

# Resolve the target version FIRST, from the current file, without writing. Everything downstream
# (zip name, exe name, tag, dry-run plan) reads this — so a dry run describes the real release
# exactly, while leaving the repo untouched.
$CurrentVersion = (Get-Content $PackageJson -Raw | ConvertFrom-Json).version
$AppVersion     = Resolve-NextVersion -CurrentVersion $CurrentVersion -BumpType $BumpType
$GitTag         = "v$AppVersion"

# Hash both lockfiles BEFORE any version bump. npm version rewrites package-lock.json's
# version fields on every release, so a hash taken after the bump could never match the
# previous release's stamp and dependencies would reinstall every time. The pre-bump file
# is byte-identical to what the previous release stamped when no dependency changed.
$RootLockHashBeforeBump   = Get-LockFileHash -DirectoryPath $RepoRoot
$ClientLockHashBeforeBump = Get-LockFileHash -DirectoryPath (Join-Path $RepoRoot 'client')

# A bump has to be committed, and the pre-commit hook refuses commits to main. Catch that here, in
# seconds, rather than after a five-minute build - which is how a wrong tag got published once.
# This mirrors the documented workflow: run from a feature branch, and the script merges it to main.
$ReleaseBranch      = git -C $RepoRoot branch --show-current 2>$null
$IsBumpingOnMain    = ($BumpType -ne '') -and ($ReleaseBranch -in @('main', 'master'))
$BumpOnMainWarning  = "Releasing with a version bump from '$ReleaseBranch' will fail: the pre-commit hook refuses commits to main. Run this from a feature branch (the script merges it to main for you), or release without a bump type."

if ($IsBumpingOnMain -and -not $DryRun) {
    throw $BumpOnMainWarning
}

# Write the version only on a real run. A dry run that edits package.json is worse than useless: it
# silently primes the NEXT real run to bump a second time (0.69.0 → dry-run → 0.70.0 → run → 0.71.0).
# --no-git-tag-version keeps npm from making its own commit/tag; this script owns all git operations.
# --allow-same-version lets a re-run set the same version without erroring.
if ($BumpType -ne '' -and -not $DryRun) {
    Write-Host ""
    if ($BumpType -match '^\d+\.\d+\.\d+$') {
        Write-Host "  Setting explicit version ($AppVersion)..."
    } else {
        Write-Host "  Bumping version ($CurrentVersion → $AppVersion)..."
    }
    Push-Location $RepoRoot
    try {
        npm version $AppVersion --no-git-tag-version --allow-same-version --silent
        if ($LASTEXITCODE -ne 0) { throw "npm version bump failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    # Trust but verify: the rest of the release names artifacts after $AppVersion, so if the file
    # disagrees the zip and the tag would too.
    $writtenVersion = (Get-Content $PackageJson -Raw | ConvertFrom-Json).version
    if ($writtenVersion -ne $AppVersion) {
        throw "Version bump wrote '$writtenVersion' but '$AppVersion' was expected - aborting before anything is tagged."
    }
    Write-Host "       ✅ Version set ($AppVersion)"
}

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
    Write-Host "  1. npm install           - install root dependencies (skipped when the lockfile is unchanged since the last release)"
    Write-Host "  1c. cd client; npm install - install React client dependencies (same lockfile skip)"
    if ($BumpType -ne '') {
        Write-Host "  1b. npm version $BumpType    - bump version in package.json + package-lock.json"
    }
    Write-Host "  2. mkdir dist\           - create output directory"
    Write-Host "  3. npm run build:client  - compile React SPA into client/dist/"
    Write-Host "  3b. engine bundles        - build:pi-review-engine + build:monthly-delivery-engine (pkg inputs)"
    Write-Host "  4. pkg                   - build self-contained payload exe at $PayloadExeOutputPath"
    Write-Host "  5. Compress-Archive      - bundle one user-facing zip into $ReleaseZipOutputPath"
    Write-Host "  6. gh release create     - publish GitHub Release $GitTag with the single zip asset"
    if ($KeepBranch) {
        Write-Host "  7. (branch kept)         - -KeepBranch set; feature branch is preserved"
    } else {
        Write-Host "  7. git branch delete     - delete the merged feature branch (local + remote), stay on main"
    }
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
    if ($IsBumpingOnMain) {
        Write-Host ""
        Write-Host "  WARNING: $BumpOnMainWarning"
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
# Unchanged lockfiles skip the install entirely (see Install-DependenciesIfStale).
Write-Host "  [1/6] Installing root and client dependencies..."
Install-DependenciesIfStale -DirectoryPath $RepoRoot -Label 'Root' -PreBumpLockHash $RootLockHashBeforeBump
Install-DependenciesIfStale -DirectoryPath (Join-Path $RepoRoot 'client') -Label 'Client' -PreBumpLockHash $ClientLockHashBeforeBump

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

# Step 3.7: Build the generated server engine bundles BEFORE pkg. This script calls `npx pkg`
# directly (not `npm run build:exe`), so the package.json `prebuild:exe` hook never fires here.
# The bundles are gitignored, so on a machine that never ran the dev flow they simply do not
# exist — and pkg then ships an exe whose engine-dependent routes/schedulers silently disable
# themselves (shipped in v0.74.0: Monthly Delivery panel never loaded). Building them explicitly
# makes the release self-sufficient instead of depending on leftover dev artifacts.
Write-Host "  [3.7/6] Building server engine bundles (pi-review, monthly-delivery)..."
Push-Location $RepoRoot
try {
    npm run build:pi-review-engine --silent
    if ($LASTEXITCODE -ne 0) { throw "PI Review engine build failed with exit code $LASTEXITCODE" }
    npm run build:monthly-delivery-engine --silent
    if ($LASTEXITCODE -ne 0) { throw "Monthly Delivery engine build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
Write-Host "       ✅ Engine bundles built (src/services/generated/)"

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
    #
    # The commit MUST be checked. It can fail for real reasons - most commonly the pre-commit hook
    # refusing a direct commit to main - and an unchecked failure is silent: the push that follows
    # reports "Everything up-to-date" and exits 0, the merge is a no-op, and the tag then lands on a
    # commit whose package.json still holds the OLD version. That shipped once already (v0.69.0).
    if ($BumpType -ne '') {
        git add package.json package-lock.json

        # Nothing staged means the version was already committed (a re-run at the same version).
        # That is fine and must not be treated as a failure.
        $stagedBumpFiles = git diff --cached --name-only
        if ($stagedBumpFiles) {
            git commit -m "chore: bump version to $GitTag`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
            if ($LASTEXITCODE -ne 0) {
                throw "The version bump commit failed (exit $LASTEXITCODE). Nothing has been tagged or published. If you are on '$originalBranch', note the pre-commit hook refuses commits to main - run this from a feature branch and the script will merge it to main for you."
            }
            # The bump commit reaches the remote through the main push below, so pushing
            # the feature branch separately would fire the pre-push hook an extra time for
            # a branch that is deleted minutes later. Only push it when it is being kept.
            if ($KeepBranch) {
                git push origin HEAD
                if ($LASTEXITCODE -ne 0) { throw "git push of version bump failed with exit code $LASTEXITCODE" }
            }
        } else {
            Write-Host "       Version $AppVersion is already committed; nothing to bump."
        }
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
    # main is NOT pushed here - it goes up in one atomic push together with the release
    # tag below, after the committed version has been verified. One push means one
    # pre-push hook run, and nothing reaches the remote until the version check passed.
    Write-Host "       ✅ Merged into main (pushed with the tag below)"

    # The invariant this whole step exists to protect: the commit about to be tagged must actually
    # contain the version being released. Checked against the committed tree, not the working tree,
    # because an uncommitted bump is exactly the failure that produced a wrong v0.69.0 tag.
    $committedPackageJson = git show HEAD:package.json
    $committedVersion     = ($committedPackageJson | ConvertFrom-Json).version
    if ($committedVersion -ne $AppVersion) {
        throw "Refusing to tag $GitTag - the commit on main says version '$committedVersion', not '$AppVersion'. The version bump is not committed. Nothing has been tagged or published."
    }
    Write-Host "       Verified: main carries version $AppVersion"

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

    # Create the tag on main HEAD, then publish main and the tag in ONE atomic push:
    # a single pre-push hook run instead of two, and either both refs land or neither
    # does - so a failed push leaves the remote untouched and the script safe to re-run.
    git tag $GitTag
    git push --atomic origin main "refs/tags/$GitTag"
    if ($LASTEXITCODE -ne 0) { throw "git push of main + $GitTag failed with exit code $LASTEXITCODE" }
    Write-Host "       ✅ main and $GitTag pushed (one atomic push)"

    # Stay on main for the publish + branch-cleanup steps below. The workspace is
    # restored to a sensible branch afterward (either the original feature branch
    # when -KeepBranch is set, or main once the merged branch is deleted).

    # Create the GitHub Release with one asset so first-time users have exactly
    # one obvious download. The zip contains stable launchers plus the versioned exe.
    gh release create $GitTag $ReleaseZipOutputPath `
        --title "NodeToolbox $GitTag" `
        --generate-notes `
        --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed with exit code $LASTEXITCODE" }

    # ── Step 7: Feature-branch cleanup ──────────────────────────────────────────
    # The feature branch is now fully merged into main and its release is live, so
    # the branch is redundant. Delete it locally and on the remote to keep the repo
    # clean (unless -KeepBranch was passed, or we released directly from main).
    $ProtectedBranchNames = @('main', 'master')
    $isReleasingFromMain  = $ProtectedBranchNames -contains $originalBranch
    $hasOriginalBranch    = -not [string]::IsNullOrWhiteSpace($originalBranch)

    if ($KeepBranch -or $isReleasingFromMain -or (-not $hasOriginalBranch)) {
        # Preserve the branch: return the developer to it so their workspace is
        # unchanged. --quiet suppresses git's "Switched to branch" stderr note,
        # which would otherwise trip $ErrorActionPreference = 'Stop'.
        if ($hasOriginalBranch -and -not $isReleasingFromMain) {
            try { git checkout --quiet $originalBranch } catch { <# stderr noise, not a real error #> }
        }
    } else {
        Write-Host "  [7/7] Deleting merged feature branch '$originalBranch'..."

        # Delete the local branch. -d (not -D) is a safety net: it refuses to delete
        # a branch that is NOT fully merged, so an unexpected state can never silently
        # discard work. The merge above guarantees it is reachable from main.
        try { git branch -d $originalBranch | Out-Null } catch { <# guarded below #> }

        # Delete the remote branch. Wrapped in try/catch because git exits non-zero
        # (tripping 'Stop') when the branch was never pushed to the remote.
        try { git push origin --delete $originalBranch 2>$null } catch { <# no remote branch to delete #> }

        Write-Host "       ✅ Feature branch cleaned up (now on main)"
    }
} finally {
    Pop-Location
}

Write-Host "       ✅ GitHub Release $GitTag published"
Write-Host ""
Write-Host "  ✅ Release complete:"
Write-Host "     ZIP:  $ReleaseZipOutputPath"
Write-Host "     URL:  https://github.com/mikejsmith1985/NodeToolbox/releases/tag/$GitTag"
Write-Host ""

# Reaching this line means the release genuinely succeeded: every failure path above
# throws under $ErrorActionPreference = 'Stop' and never gets here. Without an explicit
# exit, PowerShell returns the exit code of the last native command run — and the
# idempotent cleanup steps (deleting an already-absent remote tag or feature branch) can
# leave a non-zero $LASTEXITCODE behind even when their errors were caught. Exit 0
# explicitly so a clean release never reports as a failed background task.
exit 0
