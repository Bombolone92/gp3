param([Parameter(Mandatory=$true)][string]$OutputDirectory)
# Capture an original fixture's rendered range without using the OS clipboard.
$ErrorActionPreference = 'Stop'
$taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/svg-viewport-geometry'))
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
    foreach ($taskCase in 'small','medium','fractional','odd') {
        $taskPath = Join-Path $taskRoot ($taskCase + '.docx')
        Write-Output ('Opening ' + $taskPath)
        $taskDoc = $taskWord.Documents.Open($taskPath,$false,$true)
        try {
            if ($taskDoc.FullName -ne $taskPath) { throw 'Unexpected source document' }
            Write-Output ('Confirmed; extracting first inline range in reference build ' + $taskWord.Build)
            [byte[]]$taskBytes = $taskDoc.InlineShapes.Item(1).Range.EnhMetaFileBits
            [IO.File]::WriteAllBytes((Join-Path $taskOutput ($taskCase + '.emf')),$taskBytes)
            Write-Output ('Saved ' + $taskBytes.Length + ' bytes')
        } finally { $taskDoc.Close([ref]0) }
    }
} finally { $taskWord.Quit([ref]0) }
