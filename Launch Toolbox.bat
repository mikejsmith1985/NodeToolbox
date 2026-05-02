@echo off
:: Launch Toolbox.bat — starts NodeToolbox and opens the browser.
::
:: Uses %~dp0 so this works correctly regardless of where the zip
:: was extracted. Double-click this file to launch NodeToolbox.
::
:: Requirements:
::   - Node.js must be installed and on your PATH
::   - Run the /setup wizard on first launch to enter credentials

cd /d "%~dp0"
start "" /b node server.js --open
