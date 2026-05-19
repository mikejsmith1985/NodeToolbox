@echo off
:: Launch Toolbox.bat — visible diagnostic bootstrapper for NodeToolbox.
::
:: Most users should double-click "Launch Toolbox Silent.vbs". This batch file
:: does the same version-pointer resolution with a visible console so startup
:: errors can be read by a user or help desk technician.

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "CURRENT_POINTER=current.txt"
set "VERSIONS_DIR=versions"
set "PAYLOAD_EXE=nodetoolbox.exe"
set "SELECTED_VERSION="
set "PAYLOAD_PATH="
set "RUN_SOURCE_SERVER="

if exist "%CURRENT_POINTER%" (
    set /p SELECTED_VERSION=<"%CURRENT_POINTER%"
)

if defined SELECTED_VERSION (
    set "CANDIDATE_PATH=%VERSIONS_DIR%\!SELECTED_VERSION!\%PAYLOAD_EXE%"
    if exist "!CANDIDATE_PATH!" (
        set "PAYLOAD_PATH=!CANDIDATE_PATH!"
    )
)

if not defined PAYLOAD_PATH (
    set "SELECTED_VERSION="
    for /d %%D in ("%VERSIONS_DIR%\*") do (
        if exist "%%~fD\%PAYLOAD_EXE%" (
            set "CANDIDATE_VERSION=%%~nxD"
            call :SelectHigherVersion "!CANDIDATE_VERSION!" "!SELECTED_VERSION!"
            if "!SHOULD_SELECT_VERSION!"=="1" (
                set "SELECTED_VERSION=!CANDIDATE_VERSION!"
                set "PAYLOAD_PATH=%%~fD\%PAYLOAD_EXE%"
            )
        )
    )
    if defined SELECTED_VERSION (
        >"%CURRENT_POINTER%" echo !SELECTED_VERSION!
    )
)

if not defined PAYLOAD_PATH (
    for /f "delims=" %%E in ('dir /b /a-d "nodetoolbox-v*.exe" 2^>nul ^| sort') do (
        set "PAYLOAD_PATH=%%E"
    )
)

if not defined PAYLOAD_PATH (
    if exist "server.js" (
        set "RUN_SOURCE_SERVER=1"
    )
)

if not defined PAYLOAD_PATH if not defined RUN_SOURCE_SERVER (
    echo.
    echo  ERROR: NodeToolbox payload not found.
    echo.
    echo  Expected current.txt and versions\^<version^>\nodetoolbox.exe in:
    echo  %CD%
    echo.
    echo  Please re-extract the NodeToolbox release zip and try again.
    echo.
    pause
    exit /b 1
)

echo.
if defined RUN_SOURCE_SERVER (
    echo  Starting NodeToolbox from source: server.js
) else (
    echo  Starting NodeToolbox from: %PAYLOAD_PATH%
)
echo  Close this window to stop the server.
echo.

if defined RUN_SOURCE_SERVER (
    node server.js --open
) else (
    "%PAYLOAD_PATH%" --open
)
exit /b %ERRORLEVEL%

:SelectHigherVersion
set "CANDIDATE_VERSION_VALUE=%~1"
set "CURRENT_BEST_VERSION_VALUE=%~2"
set "SHOULD_SELECT_VERSION=0"
if not defined CURRENT_BEST_VERSION_VALUE (
    set "SHOULD_SELECT_VERSION=1"
    exit /b 0
)
call :ReadVersionParts "%CANDIDATE_VERSION_VALUE%" CANDIDATE_MAJOR_VERSION CANDIDATE_MINOR_VERSION CANDIDATE_PATCH_VERSION
call :ReadVersionParts "%CURRENT_BEST_VERSION_VALUE%" CURRENT_MAJOR_VERSION CURRENT_MINOR_VERSION CURRENT_PATCH_VERSION
if %CANDIDATE_MAJOR_VERSION% GTR %CURRENT_MAJOR_VERSION% set "SHOULD_SELECT_VERSION=1"
if %CANDIDATE_MAJOR_VERSION% LSS %CURRENT_MAJOR_VERSION% exit /b 0
if %CANDIDATE_MINOR_VERSION% GTR %CURRENT_MINOR_VERSION% set "SHOULD_SELECT_VERSION=1"
if %CANDIDATE_MINOR_VERSION% LSS %CURRENT_MINOR_VERSION% exit /b 0
if %CANDIDATE_PATCH_VERSION% GTR %CURRENT_PATCH_VERSION% set "SHOULD_SELECT_VERSION=1"
exit /b 0

:ReadVersionParts
set "VERSION_TEXT=%~1"
set "VERSION_TEXT=%VERSION_TEXT:v=%"
for /f "tokens=1-3 delims=." %%A in ("%VERSION_TEXT%") do (
    set "%~2=%%A"
    set "%~3=%%B"
    set "%~4=%%C"
)
if not defined %~2 set "%~2=0"
if not defined %~3 set "%~3=0"
if not defined %~4 set "%~4=0"
exit /b 0
