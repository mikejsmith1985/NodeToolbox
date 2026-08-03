Attribute VB_Name = "GithubEmailExport"
' GithubEmailExport.bas — Sweeps the "GitHub Intake" Outlook folder into the NodeToolbox drop folder.
'
' This is HALF ONE of the NodeToolbox Outlook export macro (v2). Half two is the small block in
' ThisOutlookSession.txt (same folder) — it MUST go into "ThisOutlookSession", not a module,
' or the automatic triggers silently never run (that is exactly how v1 died).
'
' ── What v2 fixes over v1 ──
'   • No lookback window. v1 skipped everything older than 24h, so a backlog could never drain.
'     The source folder itself is the "since last run" state: everything in it is by definition
'     unexported (successful exports are moved out), so every sweep takes the FULL backlog.
'   • Every sweep appends one line to a log file (_export-log.txt in the drop folder), so
'     "is it running?" is answered by a file, not by memory.
'
' ── INSTALL (one time, ~3 minutes, on the PC that runs Outlook) ──
'   1. Outlook -> Alt+F11 -> File > Import File... -> pick this .bas file.
'      (Or: Insert > Module, then paste this file's contents.)
'   2. Open "ThisOutlookSession" under "Microsoft Outlook Objects" in the left tree and paste the
'      contents of ThisOutlookSession.txt there. That location is NOT optional.
'   3. Set DROP_FOLDER below to the exact folder configured in NodeToolbox Admin Hub -> GitHub
'      Email Intake. Check SOURCE_FOLDER / PROCESSED_FOLDER match your Inbox subfolder names.
'   4. Press Ctrl+S in the VBA editor (saves VbaProject.OTM). Outlook DISCARDS unsaved macros at
'      exit — skipping this step is the most common way the macro "disappears".
'   5. File > Options > Trust Center > Trust Center Settings > Macro Settings ->
'      "Notifications for all macros" (click Enable at Outlook start), or ask IT to trust it.
'      If macros are disabled without notification, this code exists but never runs.
'   6. Alt+F8 -> run InitGithubAutoExport once to activate without restarting Outlook.
'   7. To run at every sign-in: make OUTLOOK itself start at sign-in (Win+R -> shell:startup ->
'      drop a shortcut to OUTLOOK.EXE there). The startup sweep then drains everything that
'      arrived since the last run, every time you log on.

Option Explicit

' ── Configuration ──

Private Const SOURCE_FOLDER    As String = "GitHub Intake"      ' subfolder of Inbox a rule files into
Private Const PROCESSED_FOLDER As String = "GitHub Processed"   ' subfolder of Inbox exported mail moves to
Private Const DROP_FOLDER      As String = "C:\CHANGE-ME\gh_emails"  ' NodeToolbox drop folder (Admin Hub setting)
Private Const OL_MSG_UNICODE   As Long = 9                      ' SaveAs type: keeps Unicode transport headers

' Manual run (Alt+F8 or F5) — sweeps everything and shows a summary popup.
Public Sub ExportGithubEmails()
    ExportGithubEmailsCore True, "manual"
End Sub

' Silent run — used by the ThisOutlookSession triggers. Never pops a dialog.
Public Sub ExportGithubEmailsSilent(ByVal runTrigger As String)
    ExportGithubEmailsCore False, runTrigger
End Sub

Private Sub ExportGithubEmailsCore(ByVal showMessage As Boolean, ByVal runTrigger As String)
    Dim mapiNamespace As Outlook.NameSpace
    Dim inboxFolder As Outlook.Folder
    Dim sourceFolder As Outlook.Folder
    Dim processedFolder As Outlook.Folder
    Dim currentItem As Object
    Dim currentMail As Outlook.MailItem
    Dim itemIndex As Long
    Dim foundCount As Long
    Dim exportedCount As Long
    Dim errorCount As Long
    Dim exportFullPath As String

    Set mapiNamespace = Application.GetNamespace("MAPI")
    Set inboxFolder = mapiNamespace.GetDefaultFolder(olFolderInbox)

    On Error Resume Next
    Set sourceFolder = inboxFolder.Folders(SOURCE_FOLDER)
    Set processedFolder = inboxFolder.Folders(PROCESSED_FOLDER)
    On Error GoTo 0

    ' A silent run must never pop a dialog — log the problem and exit.
    If sourceFolder Is Nothing Or processedFolder Is Nothing Then
        AppendRunLog runTrigger, 0, 0, 0, "source/processed folder missing under Inbox"
        If showMessage Then MsgBox "GitHub Intake / GitHub Processed folder not found under Inbox.", vbExclamation
        Exit Sub
    End If

    If Len(Dir(DROP_FOLDER, vbDirectory)) = 0 Then MkDir DROP_FOLDER

    ' NO date cutoff (the v1 bug): everything still in the source folder is unexported by
    ' definition, because a successful export moves the mail out. Sweep it all, every time.
    ' Iterate BACKWARDS so moving an item mid-loop cannot skip the next one.
    For itemIndex = sourceFolder.Items.Count To 1 Step -1
        Set currentItem = sourceFolder.Items(itemIndex)
        If TypeName(currentItem) = "MailItem" Then
            Set currentMail = currentItem
            foundCount = foundCount + 1
            exportFullPath = DROP_FOLDER & "\" & SafeFileName(currentMail.Subject) & "_" & Left(currentMail.EntryID, 12) & ".msg"
            On Error Resume Next
            currentMail.SaveAs exportFullPath, OL_MSG_UNICODE
            If Err.Number = 0 Then
                currentMail.Move processedFolder      ' only move AFTER a successful save
                exportedCount = exportedCount + 1
            Else
                errorCount = errorCount + 1
            End If
            On Error GoTo 0
        End If
    Next itemIndex

    AppendRunLog runTrigger, foundCount, exportedCount, errorCount, ""

    If showMessage Then
        MsgBox "Found " & foundCount & ", exported " & exportedCount & _
               IIf(errorCount > 0, ", " & errorCount & " error(s)", "") & _
               vbCrLf & "Drop folder: " & DROP_FOLDER & vbCrLf & "Log: " & RunLogPath(), vbInformation
    End If
End Sub

' ── Run log — one line per sweep, so "is it running?" is answered by a file ──

Private Function RunLogPath() As String
    RunLogPath = DROP_FOLDER & "\_export-log.txt"
End Function

Private Sub AppendRunLog(ByVal runTrigger As String, ByVal foundCount As Long, _
                         ByVal exportedCount As Long, ByVal errorCount As Long, ByVal note As String)
    On Error Resume Next   ' logging must never break an export sweep
    Dim fileNumber As Integer
    fileNumber = FreeFile
    Open RunLogPath() For Append As #fileNumber
    Print #fileNumber, Format(Now, "yyyy-mm-dd hh:nn:ss") & " | " & runTrigger & _
                       " | found=" & foundCount & " | exported=" & exportedCount & _
                       " | errors=" & errorCount & IIf(Len(note) > 0, " | " & note, "")
    Close #fileNumber
    On Error GoTo 0
End Sub

' ── Helpers ──

Private Function SafeFileName(ByVal rawSubject As String) As String
    Dim forbiddenCharacters As Variant
    Dim forbiddenCharacter As Variant
    forbiddenCharacters = Array("\", "/", ":", "*", "?", """", "<", ">", "|", vbCr, vbLf, vbTab)
    For Each forbiddenCharacter In forbiddenCharacters
        rawSubject = Replace(rawSubject, forbiddenCharacter, "_")
    Next forbiddenCharacter
    rawSubject = Trim(rawSubject)
    If Len(rawSubject) = 0 Then rawSubject = "github-notification"
    If Len(rawSubject) > 120 Then rawSubject = Left(rawSubject, 120)
    SafeFileName = rawSubject
End Function
