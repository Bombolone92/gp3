$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'tests\fixtures\column-flow'
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    foreach ($name in @('short', 'equal-flow', 'unequal', 'separator', 'explicit-break', 'wide-table', 'page-break', 'table-flow')) {
        $sourcePath = [IO.Path]::GetFullPath((Join-Path $fixtureRoot ($name + '.docx')))
        $taskDoc = $taskWord.Documents.Open($sourcePath, $false, $true)
        try {
            if ($taskDoc.FullName -ne $sourcePath) { throw 'The reference application opened an unexpected document' }
            Write-Output ('Confirmed: ' + $taskDoc.FullName)
            Write-Output ('Reference application: ' + $taskWord.Version + ' build ' + $taskWord.Build)
            $taskDoc.ExportAsFixedFormat([IO.Path]::ChangeExtension($sourcePath, '.pdf'), 17)
            Write-Output ('Pages: ' + $taskDoc.ComputeStatistics(2))
        } finally { $taskDoc.Close([ref]0) }
    }
} finally { $taskWord.Quit([ref]0) }
