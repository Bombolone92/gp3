$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/table-margin-defaults'))
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
try {
  foreach ($taskSource in Get-ChildItem -LiteralPath $taskRoot -Filter '*.docx') {
    $taskDoc = $null
    try {
      $taskDoc = $taskWord.Documents.Open($taskSource.FullName, $false, $true)
      if ($taskDoc.FullName -ne $taskSource.FullName) { throw 'Wrong reference document' }
      $taskDoc.ExportAsFixedFormat([IO.Path]::ChangeExtension($taskSource.FullName, '.pdf'), 17)
      $taskTable = $taskDoc.Tables.Item(1)
      @{ word = "$($taskWord.Build)"; leftPadding = $taskTable.LeftPadding; rightPadding = $taskTable.RightPadding } | ConvertTo-Json | Set-Content (Join-Path $taskRoot ($taskSource.BaseName + '-native.json'))
      Write-Output "$($taskSource.Name): left=$($taskTable.LeftPadding), right=$($taskTable.RightPadding)"
    } finally { if ($taskDoc) { $taskDoc.Close([ref]0) } }
  }
} finally { $taskWord.Quit([ref]0) }
