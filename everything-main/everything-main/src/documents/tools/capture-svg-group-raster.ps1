param([Parameter(Mandatory=$true)][string]$OutputPath,[string]$SourcePath)
$ErrorActionPreference = 'Stop'
$taskSource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public/fixtures/svg-group-raster.docx'))
if ($SourcePath) { $taskSource = [IO.Path]::GetFullPath($SourcePath) }
$taskOutput = [IO.Path]::GetFullPath($OutputPath)
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    $taskDoc = $taskWord.Documents.Open($taskSource,$false,$true)
    try {
        if ($taskDoc.FullName -ne $taskSource) { throw 'Unexpected document path' }
        [byte[]]$taskBytes = $taskDoc.InlineShapes.Item(1).Range.EnhMetaFileBits
        [IO.File]::WriteAllBytes($taskOutput,$taskBytes)
        Write-Output ('Captured first inline range; reference build ' + $taskWord.Build)
    } finally { $taskDoc.Close([ref]0) }
} finally { $taskWord.Quit([ref]0) }
