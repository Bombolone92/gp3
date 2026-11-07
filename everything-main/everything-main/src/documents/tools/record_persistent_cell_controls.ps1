# Native reference behavior of independently authored persistent cell controls.
param([switch]$SaveEditedPackage, [switch]$ExportPdf)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/persistent-cell-controls'))
$taskPath = Join-Path $taskRoot 'control.docx'
$taskWorkingPath = Join-Path ([IO.Path]::GetTempPath()) ('persistent-cell-' + [guid]::NewGuid().ToString('N') + '.docx')
Copy-Item -LiteralPath $taskPath -Destination $taskWorkingPath
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    Write-Output "Opening disposable copy: $taskWorkingPath"
    $taskDoc = $taskWord.Documents.Open($taskWorkingPath, $false, $false)
    if ($taskDoc.FullName -ne $taskWorkingPath) { throw 'Wrong document' }
    if ($taskDoc.ReadOnly) { throw 'Editing probe opened read-only' }
    Write-Output 'Opened writable copy; recording behavior before optional PDF export'
    $taskResults = @()
    foreach ($taskName in @('insert','replace','delete-all','split','format','placeholder','temporary-false','two-paragraphs')) {
        Write-Output "Editing case: $taskName"
        $taskControl = $taskDoc.SelectContentControlsByTitle($taskName).Item(1)
        $taskBefore = $taskControl.Range.Text
        $taskRange = $taskControl.Range.Duplicate
        # Cell terminators are structure, not editable text contents.
        if ($taskRange.Text.EndsWith("`r`a")) { $taskRange.End -= 2 }
        elseif ($taskRange.Text.EndsWith("`r")) { $taskRange.End -= 1 }
        $taskError = $null
        try {
            switch ($taskName) {
                'insert' { $taskRange.SetRange($taskRange.Start + 2, $taskRange.Start + 2); $taskRange.Text = 'NEW ' }
                'split' { $taskRange.SetRange($taskRange.Start + 5, $taskRange.Start + 5); $taskRange.Text = "`r" }
                'format' { $taskRange.SetRange($taskRange.Start, $taskRange.Start + 5); $taskRange.Font.Bold = -1 }
                'delete-all' { $taskRange.Text = '' }
                default { $taskRange.Text = 'Edited value' }
            }
        } catch { $taskError = $_.Exception.Message }
        $taskRemaining = $taskDoc.SelectContentControlsByTitle($taskName)
        $taskResults += @{ name=$taskName; before=$taskBefore; count=$taskRemaining.Count; error=$taskError;
            after=$(if ($taskRemaining.Count) { $taskRemaining.Item(1).Range.Text } else { '' });
            placeholder=$(if ($taskRemaining.Count) { $taskRemaining.Item(1).ShowingPlaceholderText } else { $false }) }
    }
    @{ referenceBuild=$taskWord.Build; sourceSha256=(Get-FileHash $taskPath -Algorithm SHA256).Hash;
        cases=$taskResults } | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $taskRoot 'native-results.json')
    Write-Output 'Recorded native results'
    if ($SaveEditedPackage) {
        Write-Output 'Saving edited package'
        $taskDestination = Join-Path $taskRoot 'native-edited.docx'
        $taskDoc.SaveAs2($taskDestination, 12)
    }
    if ($ExportPdf) {
        Write-Output 'Exporting edited PDF'
        $taskDoc.Repaginate()
        $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot 'native-after.pdf'), 17)
    }
    $taskDoc.Close([ref]0)
} finally { $taskWord.Quit([ref]0) }
