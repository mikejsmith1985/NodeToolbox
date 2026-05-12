' Launch Toolbox Silent.vbs — Starts NodeToolbox without a visible console window.
'
' Double-click this file to launch NodeToolbox silently in the background.
' The dashboard will open automatically in your default browser once the
' server is ready (usually within 3–5 seconds).
'
' Works with both distribution types:
'   * Exe distribution  — finds and runs nodetoolbox-*.exe with a hidden window.
'   * Zip distribution  — runs "Launch Toolbox.bat" with a hidden window.
'
' Why a VBScript? WScript.Shell.Run() with windowStyle = 0 (SW_HIDE) is the
' standard Windows technique for starting a process with no visible window.
' It runs on every corporate Windows machine without special permissions or
' execution-policy changes.
'
' Corporate-PC reliability (v0.5.2):
'   After launching the exe, the script polls the server port for up to
'   SERVER_READY_TIMEOUT_SECONDS seconds.  Once the port is listening, the
'   browser is opened directly from this VBS — a belt-and-suspenders backup
'   for sites where the exe's built-in "start" browser command is blocked by
'   group policy.  If the server never responds, a diagnostic MsgBox explains
'   the most likely causes (SmartScreen, port conflict, missing client/dist).

Option Explicit

' ── Configuration constants ────────────────────────────────────────────────────

' TCP port NodeToolbox binds to — must match the "port" default in server.js.
Const SERVER_PORT = 5555

' How many seconds to wait for the server port to become ready before giving up.
Const SERVER_READY_TIMEOUT_SECONDS = 30

' Milliseconds between each port-readiness poll attempt.
' 1 000 ms (1 second) balances responsiveness against CPU usage.
Const POLL_INTERVAL_MS = 1000

' ── Script entry point ─────────────────────────────────────────────────────────

Dim objFSO, objShell

Set objFSO   = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

Main

Set objShell = Nothing
Set objFSO   = Nothing

' ── Main logic ─────────────────────────────────────────────────────────────────
'
' Wrapped in a Sub so Exit Sub can short-circuit once the browser is open
' without needing nested If blocks three levels deep.

Sub Main()
    ' Resolve the directory that contains this VBScript so all file paths are
    ' portable — the script works wherever the user extracts the release zip.
    Dim scriptDirectory
    scriptDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)

    ' ── Exe distribution: find the NEWEST packaged executable ──────────────────
    ' The exe is named nodetoolbox-vX.Y.Z.exe so we search by prefix rather than
    ' hard-coding a version number.  We iterate ALL matching files and track the
    ' one with the latest DateLastModified — this prevents older stuck versions
    ' from being launched when multiple versions exist in the same folder.
    Dim latestExePath, latestExeDate, objCandidate
    latestExePath = ""
    latestExeDate = CDate("1900-01-01")

    For Each objCandidate In objFSO.GetFolder(scriptDirectory).Files
        If LCase(Left(objCandidate.Name, 12)) = "nodetoolbox-" And LCase(Right(objCandidate.Name, 4)) = ".exe" Then
            ' DateLastModified wins over filesystem sort order — always runs the newest build
            If objCandidate.DateLastModified > latestExeDate Then
                latestExeDate = objCandidate.DateLastModified
                latestExePath = objCandidate.Path
            End If
        End If
    Next

    ' ── Launch the server process ───────────────────────────────────────────────
    '
    ' NOTE: We intentionally do NOT short-circuit here, even if port 5555 is
    ' already listening. A stale process from an older NodeToolbox version may be
    ' occupying the port and serving broken content (e.g. "React build not found").
    ' Launching the new exe unconditionally lets portManager.js detect the conflict,
    ' kill the old process, wait 1500ms for the OS to release the binding, and then
    ' bind fresh on port 5555. The polling loop below will wait out that gap and
    ' open the browser only once the NEW process is confirmed ready.
    If latestExePath <> "" Then
        ' Window style 0 = SW_HIDE — the exe starts with no console window.
        ' False = fire-and-forget; the VBS continues to the polling loop below.
        ' --no-open tells the exe to skip its own browser-open so the VBS
        ' exclusively controls when the browser opens (after the port-ready poll).
        objShell.Run Chr(34) & latestExePath & Chr(34) & " --no-open", 0, False

    Else
        ' ── Zip distribution: run the bat launcher silently ────────────────────
        Dim batPath
        batPath = objFSO.BuildPath(scriptDirectory, "Launch Toolbox.bat")

        If objFSO.FileExists(batPath) Then
            ' cmd /c runs the bat and exits the cmd window when done.
            ' Window style 0 keeps that cmd window hidden throughout.
            objShell.Run "cmd /c " & Chr(34) & batPath & Chr(34), 0, False
        Else
            ' Neither the exe nor the bat was found — guide the user.
            MsgBox "NodeToolbox launcher not found." & vbNewLine & vbNewLine & _
                   "Expected to find one of the following in:" & vbNewLine & _
                   scriptDirectory & vbNewLine & vbNewLine & _
                   "  nodetoolbox-vX.Y.Z.exe  (exe distribution)" & vbNewLine & _
                   "  Launch Toolbox.bat      (zip distribution)" & vbNewLine & vbNewLine & _
                   "Please re-extract the release zip and try again.", _
                   16, "NodeToolbox Launch Error"
            Exit Sub
        End If
    End If

    ' ── Poll until the server is ready, then open the browser ──────────────────
    '
    ' This loop is the key corporate-PC safety net:
    '   * If the exe's built-in browser-open ("start" command) is blocked by IT
    '     group policy, the VBS opens the browser itself once the port is ready.
    '   * If the exe is blocked by antivirus or SmartScreen, the timeout fires
    '     and shows a diagnostic MsgBox instead of leaving the user with silence.
    '   * If port 5555 is locked by an un-killable process (EADDRINUSE), the
    '     server never binds and the timeout message explains what happened.
    Dim pollAttempt
    Dim serverBecameReady
    serverBecameReady = False

    For pollAttempt = 1 To SERVER_READY_TIMEOUT_SECONDS
        WScript.Sleep POLL_INTERVAL_MS
        If IsPortListening(SERVER_PORT) Then
            serverBecameReady = True
            Exit For
        End If
    Next

    If serverBecameReady Then
        ' The VBS is the single point of browser-open when launching via the exe.
        ' The exe is started with --no-open so it does not race the VBS to open
        ' the browser — this prevents two tabs from appearing on every launch.
        OpenDashboardInBrowser SERVER_PORT
    Else
        ' The server did not respond within the timeout window.
        ' Show a diagnostic message to help the user (or IT) report the problem.
        Dim exeDisplayPath
        If latestExePath <> "" Then
            exeDisplayPath = latestExePath
        Else
            exeDisplayPath = scriptDirectory & "\nodetoolbox-vX.Y.Z.exe"
        End If

        MsgBox "NodeToolbox did not start within " & SERVER_READY_TIMEOUT_SECONDS & " seconds." & vbNewLine & vbNewLine & _
               "Possible causes:" & vbNewLine & _
               "  " & Chr(149) & " Antivirus or Windows SmartScreen blocked the executable." & vbNewLine & _
               "    If you see a SmartScreen warning, click 'More info' " & ChrW(8594) & " 'Run anyway'." & vbNewLine & _
               "  " & Chr(149) & " Port " & SERVER_PORT & " is in use and could not be freed." & vbNewLine & _
               "    Open Task Manager and end any 'nodetoolbox' processes, then try again." & vbNewLine & vbNewLine & _
               "To diagnose, open a Command Prompt in this folder and run:" & vbNewLine & _
               "  " & Chr(34) & exeDisplayPath & Chr(34) & vbNewLine & _
               "Then look for error messages in the console window.", _
               48, "NodeToolbox Startup Timeout"
    End If
End Sub

' ── Private helpers ────────────────────────────────────────────────────────────

' Checks whether a TCP port is in LISTENING state by running netstat and
' searching for the localhost address + port combination.
'
' Returns True if the port is listening, False if it is not.
'
' Why netstat? It is available on every Windows machine without elevated
' permissions, PowerShell, or WinHttp — all of which may be restricted by
' corporate IT.  The findstr exit code (0 = found, 1 = not found) is the
' only information we need; no output parsing required.
'
Function IsPortListening(portNumber)
    ' Run netstat in a hidden cmd window and wait for it to exit (True).
    ' findstr exit code 0 means the address:port pattern was found.
    Dim checkExitCode
    checkExitCode = objShell.Run( _
        "cmd /c netstat -ano | findstr " & Chr(34) & "127.0.0.1:" & portNumber & Chr(34), _
        0, True)
    IsPortListening = (checkExitCode = 0)
End Function

' Opens the NodeToolbox dashboard in the user's default browser.
'
' Uses "cmd /c start" which delegates to the Windows shell association for
' http:// URLs — the same mechanism used by the bat launcher.  The empty
' first argument ("") is required by the start command to prevent it from
' treating the URL as the window title parameter.
'
Sub OpenDashboardInBrowser(portNumber)
    Dim dashboardUrl
    dashboardUrl = "http://localhost:" & portNumber
    objShell.Run "cmd /c start " & Chr(34) & Chr(34) & " " & Chr(34) & dashboardUrl & Chr(34), 0, False
End Sub
