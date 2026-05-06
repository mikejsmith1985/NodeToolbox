@echo off
:: Launch Toolbox.bat — starts NodeToolbox and opens the browser.
::
:: This window IS the server — keep it open while you use the Toolbox.
:: Close it (or press Ctrl+C) to stop the server.
::
:: On first run (or after a version upgrade to a new folder), production
:: dependencies are installed automatically via "npm ci". This typically
:: takes 15-30 seconds and only happens once per extracted folder.
::
:: Your credentials are saved in AppData\Roaming\NodeToolbox\ and persist
:: across version upgrades — no need to re-run the setup wizard.
::
:: Requirements:
::   - Node.js (v18+) must be installed and on your PATH

cd /d "%~dp0"

:: Auto-install production dependencies when this folder is freshly extracted.
:: "npm ci" uses package-lock.json for a fast, reproducible install.
if not exist "node_modules" (
    echo.
    echo  Installing dependencies, first run only -- takes about 30 seconds...
    echo  If this hangs, check that npm can reach your registry.
    echo.
    npm ci --omit=dev
    if errorlevel 1 (
        echo.
        echo  ERROR: Dependency install failed. Common causes:
        echo    - Node.js is not installed, get it at https://nodejs.org
        echo    - npm cannot reach the package registry, check corporate proxy / VPN
        echo    - Run "npm config set registry https://registry.npmjs.org" and retry
        echo.
        pause
        exit /b 1
    )
    echo  Done.
    echo.
)

:: Check that the React UI has been built. In ZIP distributions the build is
:: included automatically. In git-clone installations the developer must run
:: "npm run build:client" once before launching. If the source is present we
:: attempt the build automatically; if not we show a clear error.
if not exist "client\dist\index.html" (
    if exist "client\package.json" (
        echo.
        echo  Building React UI - first run from source, takes about 60 seconds...
        echo.
        cd client
        npm install
        npm run build
        if errorlevel 1 (
            echo.
            echo  ERROR: React build failed. Check the output above for details.
            echo.
            pause
            exit /b 1
        )
        cd ..
        echo  Done.
        echo.
    ) else (
        echo.
        echo  ERROR: React UI not found - client\dist\index.html is missing.
        echo  This installation may be corrupted. Re-download NodeToolbox and try again.
        echo.
        pause
        exit /b 1
    )
)

:: Run the server directly in this window so errors are visible.
:: This window stays open while the server runs -- close it to stop NodeToolbox.
node server.js --open
