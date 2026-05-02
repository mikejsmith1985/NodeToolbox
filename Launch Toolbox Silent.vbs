' Launch Toolbox Silent.vbs — Starts NodeToolbox without a visible console window.
'
' Double-click this file to launch NodeToolbox silently in the background.
' The dashboard will open automatically in your default browser as usual.
'
' Works with both distribution types:
'   * Exe distribution  — finds and runs nodetoolbox-*.exe with a hidden window.
'   * Zip distribution  — runs "Launch Toolbox.bat" with a hidden window.
'
' Why a VBScript? WScript.Shell.Run() with windowStyle = 0 (SW_HIDE) is the
' standard Windows technique for starting a process with no visible window.
' It runs on every corporate Windows machine without special permissions or
' execution-policy changes.

Option Explicit

Dim objFSO, objShell, scriptDirectory, exePath, batPath

Set objFSO   = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

' Resolve the directory that contains this VBScript so paths are portable —
' the script works no matter where the user extracts the release zip.
scriptDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)

' ── Exe distribution: find the NEWEST packaged executable ──────────────────
' The exe is named nodetoolbox-vX.Y.Z.exe so we search by prefix rather than
' hard-coding a version number. We iterate ALL matching files and track the one
' with the latest DateLastModified — this prevents older stuck versions from
' being launched when multiple versions exist in the same folder.
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

exePath = latestExePath

If exePath <> "" Then
    ' Window style 0 = SW_HIDE — the exe starts with no console window.
    ' False = do not wait for the process to finish (fire-and-forget).
    objShell.Run Chr(34) & exePath & Chr(34), 0, False

Else
    ' ── Zip distribution: run the bat launcher silently ──────────────────────
    batPath = objFSO.BuildPath(scriptDirectory, "Launch Toolbox.bat")

    If objFSO.FileExists(batPath) Then
        ' cmd /c runs the bat and exits the cmd window when done.
        ' Window style 0 keeps that cmd window hidden throughout.
        objShell.Run "cmd /c """ & batPath & """", 0, False
    Else
        ' Neither the exe nor the bat was found — guide the user.
        MsgBox "NodeToolbox launcher not found." & vbNewLine & vbNewLine & _
               "Expected to find one of the following in:" & vbNewLine & _
               scriptDirectory & vbNewLine & vbNewLine & _
               "  nodetoolbox-vX.Y.Z.exe  (exe distribution)" & vbNewLine & _
               "  Launch Toolbox.bat      (zip distribution)" & vbNewLine & vbNewLine & _
               "Please re-extract the release zip and try again.", _
               16, "NodeToolbox Launch Error"
    End If
End If

Set objShell = Nothing
Set objFSO   = Nothing
