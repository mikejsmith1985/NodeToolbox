@echo off
:: Launch Toolbox.bat — starts NodeToolbox and opens the browser.
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
    echo Installing dependencies ^(first run only ^— this takes about 30 seconds^)...
    npm ci --omit=dev --silent
    if errorlevel 1 (
        echo.
        echo ERROR: Dependency install failed.
        echo Ensure Node.js v18 or later is installed: https://nodejs.org
        pause
        exit /b 1
    )
    echo Done.
)

start "NodeToolbox Server" node server.js --open
