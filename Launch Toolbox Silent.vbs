' Launch Toolbox Silent.vbs — Stable hidden bootstrapper for NodeToolbox.
'
' Double-click this file to launch NodeToolbox like a normal desktop app. The
' script reads current.txt, starts versions\<current>\nodetoolbox.exe hidden,
' waits for the server port, then opens the dashboard in the default browser.
'
' The launcher is intentionally stable across updates: Admin Hub installs new
' payloads under versions\<version> and flips current.txt instead of replacing
' the executable that is currently running.

Option Explicit

' ── Configuration constants ────────────────────────────────────────────────────

Const SERVER_PORT = 5555
Const SERVER_READY_TIMEOUT_SECONDS = 30
Const POLL_INTERVAL_MS = 1000
Const CURRENT_POINTER_FILENAME = "current.txt"
Const VERSIONS_DIRECTORY_NAME = "versions"
Const PAYLOAD_EXE_FILENAME = "nodetoolbox.exe"
Const LEGACY_EXE_PREFIX = "nodetoolbox-v"

' ── Script entry point ─────────────────────────────────────────────────────────

Dim objFSO, objShell

Set objFSO = CreateObject("Scripting.FileSystemObject")
Set objShell = CreateObject("WScript.Shell")

Main

Set objShell = Nothing
Set objFSO = Nothing

' ── Main logic ─────────────────────────────────────────────────────────────────

Sub Main()
    Dim scriptDirectory
    scriptDirectory = objFSO.GetParentFolderName(WScript.ScriptFullName)

    Dim payloadExePath
    payloadExePath = ResolvePayloadExePath(scriptDirectory)

    If payloadExePath <> "" Then
        objShell.Run Chr(34) & payloadExePath & Chr(34) & " --no-open" & BuildForwardedArguments(), 0, False
    Else
        Dim batPath
        batPath = objFSO.BuildPath(scriptDirectory, "Launch Toolbox.bat")

        If objFSO.FileExists(batPath) Then
            objShell.Run "cmd /c " & Chr(34) & batPath & Chr(34), 0, False
        Else
            MsgBox "NodeToolbox launcher not found." & vbNewLine & vbNewLine & _
                   "Expected to find current.txt and versions\<version>\nodetoolbox.exe in:" & vbNewLine & _
                   scriptDirectory & vbNewLine & vbNewLine & _
                   "Please re-extract the NodeToolbox release zip and try again.", _
                   16, "NodeToolbox Launch Error"
            Exit Sub
        End If
    End If

    If WaitForServerReady() Then
        OpenDashboardInBrowser SERVER_PORT
    Else
        ShowStartupTimeout payloadExePath, scriptDirectory
    End If
End Sub

' ── Payload resolution ─────────────────────────────────────────────────────────

Function ResolvePayloadExePath(installRoot)
    Dim selectedVersion
    selectedVersion = ReadCurrentVersion(installRoot)

    If selectedVersion <> "" Then
        Dim selectedPayloadPath
        selectedPayloadPath = BuildPayloadPath(installRoot, selectedVersion)
        If objFSO.FileExists(selectedPayloadPath) Then
            ResolvePayloadExePath = selectedPayloadPath
            Exit Function
        End If
    End If

    Dim highestVersion
    highestVersion = FindHighestInstalledVersion(installRoot)
    If highestVersion <> "" Then
        Dim fallbackPayloadPath
        fallbackPayloadPath = BuildPayloadPath(installRoot, highestVersion)
        If objFSO.FileExists(fallbackPayloadPath) Then
            WriteCurrentVersion installRoot, highestVersion
            ResolvePayloadExePath = fallbackPayloadPath
            Exit Function
        End If
    End If

    ' Legacy bridge: old Admin Hub updaters may leave only nodetoolbox-vX.Y.Z.exe
    ' at the top level. Choose the highest version, not the newest timestamp.
    ResolvePayloadExePath = FindHighestLegacyExe(installRoot)
End Function

Function ReadCurrentVersion(installRoot)
    Dim pointerPath
    pointerPath = objFSO.BuildPath(installRoot, CURRENT_POINTER_FILENAME)

    If Not objFSO.FileExists(pointerPath) Then
        ReadCurrentVersion = ""
        Exit Function
    End If

    Dim pointerFile
    Set pointerFile = objFSO.OpenTextFile(pointerPath, 1, False)
    ReadCurrentVersion = Trim(pointerFile.ReadLine)
    pointerFile.Close
End Function

Sub WriteCurrentVersion(installRoot, versionText)
    On Error Resume Next
    Dim pointerPath, temporaryPointerPath, pointerFile
    pointerPath = objFSO.BuildPath(installRoot, CURRENT_POINTER_FILENAME)
    temporaryPointerPath = pointerPath & ".new"
    Set pointerFile = objFSO.OpenTextFile(temporaryPointerPath, 2, True)
    pointerFile.WriteLine versionText
    pointerFile.Close
    If objFSO.FileExists(pointerPath) Then objFSO.DeleteFile pointerPath, True
    objFSO.MoveFile temporaryPointerPath, pointerPath
    On Error GoTo 0
End Sub

Function BuildPayloadPath(installRoot, versionText)
    BuildPayloadPath = objFSO.BuildPath( _
        objFSO.BuildPath(objFSO.BuildPath(installRoot, VERSIONS_DIRECTORY_NAME), versionText), _
        PAYLOAD_EXE_FILENAME)
End Function

Function FindHighestInstalledVersion(installRoot)
    Dim versionsPath
    versionsPath = objFSO.BuildPath(installRoot, VERSIONS_DIRECTORY_NAME)

    If Not objFSO.FolderExists(versionsPath) Then
        FindHighestInstalledVersion = ""
        Exit Function
    End If

    Dim highestVersion, candidateFolder
    highestVersion = ""

    For Each candidateFolder In objFSO.GetFolder(versionsPath).SubFolders
        If objFSO.FileExists(BuildPayloadPath(installRoot, candidateFolder.Name)) Then
            If highestVersion = "" Or CompareVersions(candidateFolder.Name, highestVersion) > 0 Then
                highestVersion = candidateFolder.Name
            End If
        End If
    Next

    FindHighestInstalledVersion = highestVersion
End Function

Function FindHighestLegacyExe(installRoot)
    Dim highestVersion, highestExePath, candidateFile, candidateVersion
    highestVersion = ""
    highestExePath = ""

    For Each candidateFile In objFSO.GetFolder(installRoot).Files
        If LCase(Left(candidateFile.Name, Len(LEGACY_EXE_PREFIX))) = LEGACY_EXE_PREFIX _
           And LCase(Right(candidateFile.Name, 4)) = ".exe" Then
            candidateVersion = Replace(Mid(candidateFile.Name, Len(LEGACY_EXE_PREFIX) + 1), ".exe", "")
            If highestVersion = "" Or CompareVersions(candidateVersion, highestVersion) > 0 Then
                highestVersion = candidateVersion
                highestExePath = candidateFile.Path
            End If
        End If
    Next

    FindHighestLegacyExe = highestExePath
End Function

Function CompareVersions(firstVersion, secondVersion)
    Dim firstParts, secondParts, partIndex, firstNumber, secondNumber
    firstParts = Split(Replace(firstVersion, "v", ""), ".")
    secondParts = Split(Replace(secondVersion, "v", ""), ".")

    For partIndex = 0 To 2
        firstNumber = ReadVersionPart(firstParts, partIndex)
        secondNumber = ReadVersionPart(secondParts, partIndex)
        If firstNumber > secondNumber Then
            CompareVersions = 1
            Exit Function
        End If
        If firstNumber < secondNumber Then
            CompareVersions = -1
            Exit Function
        End If
    Next

    CompareVersions = 0
End Function

Function ReadVersionPart(versionParts, partIndex)
    If partIndex > UBound(versionParts) Then
        ReadVersionPart = 0
    ElseIf IsNumeric(versionParts(partIndex)) Then
        ReadVersionPart = CInt(versionParts(partIndex))
    Else
        ReadVersionPart = 0
    End If
End Function

Function BuildForwardedArguments()
    Dim argumentText, argumentIndex
    argumentText = ""

    For argumentIndex = 0 To WScript.Arguments.Count - 1
        argumentText = argumentText & " " & Chr(34) & WScript.Arguments(argumentIndex) & Chr(34)
    Next

    BuildForwardedArguments = argumentText
End Function

' ── Startup polling ────────────────────────────────────────────────────────────

Function WaitForServerReady()
    Dim pollAttempt
    WaitForServerReady = False

    For pollAttempt = 1 To SERVER_READY_TIMEOUT_SECONDS
        WScript.Sleep POLL_INTERVAL_MS
        If IsPortListening(SERVER_PORT) Then
            WaitForServerReady = True
            Exit Function
        End If
    Next
End Function

Function IsPortListening(portNumber)
    Dim checkExitCode
    checkExitCode = objShell.Run( _
        "cmd /c netstat -ano | findstr " & Chr(34) & "127.0.0.1:" & portNumber & Chr(34), _
        0, True)
    IsPortListening = (checkExitCode = 0)
End Function

Sub OpenDashboardInBrowser(portNumber)
    Dim dashboardUrl
    dashboardUrl = "http://localhost:" & portNumber
    objShell.Run "cmd /c start " & Chr(34) & Chr(34) & " " & Chr(34) & dashboardUrl & Chr(34), 0, False
End Sub

Sub ShowStartupTimeout(payloadExePath, installRoot)
    Dim diagnosticPath
    If payloadExePath <> "" Then
        diagnosticPath = payloadExePath
    Else
        diagnosticPath = objFSO.BuildPath(installRoot, "versions\<version>\nodetoolbox.exe")
    End If

    MsgBox "NodeToolbox did not start within " & SERVER_READY_TIMEOUT_SECONDS & " seconds." & vbNewLine & vbNewLine & _
           "Possible causes:" & vbNewLine & _
           "  " & Chr(149) & " Antivirus or Windows SmartScreen blocked the executable." & vbNewLine & _
           "    If you see a SmartScreen warning, click 'More info' then 'Run anyway'." & vbNewLine & _
           "  " & Chr(149) & " Port " & SERVER_PORT & " is in use and could not be freed." & vbNewLine & _
           "    Open Task Manager and end any 'nodetoolbox' processes, then try again." & vbNewLine & vbNewLine & _
           "To diagnose, open a Command Prompt in this folder and run:" & vbNewLine & _
           "  " & Chr(34) & diagnosticPath & Chr(34), _
           48, "NodeToolbox Startup Timeout"
End Sub
