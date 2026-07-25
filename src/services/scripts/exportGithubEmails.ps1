# exportGithubEmails.ps1 — Save GitHub notification emails from an Outlook folder to a local drop folder
# as .msg files, so NodeToolbox's GitHub Email Intake can process them. Invoked by the server
# (src/services/outlookEmailExport.js) before each intake sweep; NOT meant to be run by hand.
#
# No macros, no admin, no GitHub API: it attaches to Outlook via COM, exports each mail in the source
# folder to .msg, then moves it to a "processed" folder so it is never exported twice. It touches only
# non-sensitive properties (Subject, EntryID, MessageClass, SaveAs, Move), so Outlook's programmatic-access
# guard does not prompt. The final line is a machine-readable "EXPORT_RESULT {json}" the server parses.

param(
    [string]$SourceFolderPath    = 'Inbox\GitHub Intake',
    [string]$ProcessedFolderPath = 'Inbox\GitHub Processed',
    [string]$DropFolder          = (Join-Path $env:USERPROFILE 'Documents\gh_emails')
)

# olMSGUnicode: preserves the Unicode transport headers (X-GitHub-Sender, List-ID, etc.) the engine reads.
$OL_SAVE_AS_MSG_UNICODE = 9
# olFolderInbox: well-known id for the default Inbox, the anchor for folder-path lookups.
$OL_FOLDER_INBOX = 6

# Walks an Outlook folder path like "Inbox\GitHub Intake" and returns the MAPIFolder, or throws.
function Resolve-OutlookFolder($namespace, [string]$folderPath) {
    $parts = $folderPath -split '\\' | Where-Object { $_ -ne '' }
    $inbox = $namespace.GetDefaultFolder($OL_FOLDER_INBOX)

    if ($parts[0] -ieq 'Inbox') {
        $current = $inbox
        $remaining = $parts | Select-Object -Skip 1
    } else {
        $current = $inbox.Parent
        $remaining = $parts
    }

    foreach ($name in $remaining) {
        $next = $null
        foreach ($sub in $current.Folders) {
            if ($sub.Name -ieq $name) { $next = $sub; break }
        }
        if ($null -eq $next) {
            throw "Outlook folder not found: '$name' under '$($current.Name)'. Create it in Outlook first."
        }
        $current = $next
    }
    return $current
}

# Turns an email subject into a safe .msg filename, made unique with a slice of the mail's EntryID.
function Get-SafeFileName([string]$subject, [string]$entryId) {
    $safeSubject = ($subject -replace '[\\/:*?"<>|\r\n\t]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($safeSubject)) { $safeSubject = 'github-notification' }
    if ($safeSubject.Length -gt 120) { $safeSubject = $safeSubject.Substring(0, 120) }
    $uniqueSuffix = $entryId.Substring(0, [Math]::Min(12, $entryId.Length))
    return ('{0}_{1}.msg' -f $safeSubject, $uniqueSuffix)
}

# Emits the machine-readable result line the server looks for, then stops.
function Write-ExportResult([int]$exported, [int]$total, [string]$errorMessage) {
    $summary = @{ exported = $exported; total = $total; error = $errorMessage }
    Write-Output ('EXPORT_RESULT ' + (ConvertTo-Json $summary -Compress))
}

$outlook = $null
$namespace = $null
try {
    if (-not (Test-Path $DropFolder)) {
        New-Item -ItemType Directory -Path $DropFolder -Force | Out-Null
    }

    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')

    $sourceFolder = Resolve-OutlookFolder $namespace $SourceFolderPath
    $processedFolder = Resolve-OutlookFolder $namespace $ProcessedFolderPath

    # Snapshot to a fixed array first — moving items while iterating a live .Items collection skips messages.
    $items = @($sourceFolder.Items)
    $exportedCount = 0
    foreach ($item in $items) {
        if ($item.MessageClass -notlike 'IPM.Note*') { continue }
        try {
            $fileName = Get-SafeFileName $item.Subject $item.EntryID
            $fullPath = Join-Path $DropFolder $fileName
            $item.SaveAs($fullPath, $OL_SAVE_AS_MSG_UNICODE)
            # Only move AFTER a successful save, so a failed export retries next run.
            [void]$item.Move($processedFolder)
            $exportedCount += 1
        } catch {
            Write-Output ("WARN export failed for '$($item.Subject)': $($_.Exception.Message)")
        }
    }

    Write-ExportResult $exportedCount $items.Count $null
} catch {
    Write-ExportResult 0 0 $_.Exception.Message
} finally {
    if ($namespace) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($namespace) | Out-Null }
    if ($outlook)   { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
