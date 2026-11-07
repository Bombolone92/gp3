$ErrorActionPreference = 'Stop'
$taskFolder = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/flat-line-baseline'))
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    Write-Output "Reference application $($taskWord.Version), build $($taskWord.Build)"
    foreach ($mode in @(12,15)) {
        $taskSource = Join-Path $taskFolder "mode-$mode.docx"
        $taskDoc = $taskWord.Documents.Open($taskSource, $false, $true)
        if ($taskDoc.FullName -ne $taskSource) { throw 'Wrong document opened' }
        $taskDoc.ExportAsFixedFormat((Join-Path $taskFolder "mode-$mode.pdf"),17)
        Write-Output "Mode $mode pages: $($taskDoc.ComputeStatistics(2))"
        $taskDoc.Close([ref]0)
    }
} finally { $taskWord.Quit([ref]0) }
