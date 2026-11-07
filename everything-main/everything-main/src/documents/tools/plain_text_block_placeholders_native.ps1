param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../tests/fixtures/plain-text-block-placeholders'))
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath($OutputDirectory)
$taskCases = Get-Content -LiteralPath (Join-Path $taskRoot 'cases.json') -Raw | ConvertFrom-Json
$taskWord = New-Object -ComObject Word.Application
$taskWord.Visible = $false
$taskWord.DisplayAlerts = 0
$taskResults = @()
try {
  foreach ($taskCase in $taskCases) {
    $taskSource = Join-Path $taskRoot ($taskCase.name + '-source.docx')
    foreach ($taskOperation in @('inspect', 'format', 'replace')) {
      try { $taskDoc = $taskWord.Documents.Open($taskSource, $false, $true) }
      catch {
        $taskResults += @{ case=$taskCase.name; operation=$taskOperation; error=$_.Exception.Message }
        Write-Output ($taskCase.name + ': ' + $_.Exception.Message)
        break
      }
      try {
        if ($taskDoc.FullName -ne $taskSource) { throw 'Wrong reference document' }
        $taskControl = $taskDoc.SelectContentControlsByTitle($taskCase.name).Item(1)
        $taskResult = @{ case=$taskCase.name; operation=$taskOperation; type=$taskControl.Type; placeholder=$taskControl.ShowingPlaceholderText; text=$taskControl.Range.Text; paragraphs=$taskControl.Range.Paragraphs.Count }
        if ($taskOperation -eq 'inspect') { $taskDoc.ExportAsFixedFormat((Join-Path $taskRoot ($taskCase.name + '-native.pdf')),17) }
        $taskStart = $taskControl.Range.Start
        if ($taskOperation -eq 'format') {
          $taskDoc.Activate(); $taskDoc.Range($taskStart + 2, $taskStart + 4).Select()
          $taskWord.Selection.Font.Bold = -1
        }
        if ($taskOperation -eq 'replace') {
          $taskDoc.Activate(); $taskDoc.Range($taskStart + 2, $taskStart + 2).Select()
          $taskWord.Selection.TypeText('Replacement')
        }
        $taskResult.afterText = $taskDoc.Content.Text
        $taskResult.afterControls = $taskDoc.ContentControls.Count
        $taskDoc.SaveAs2((Join-Path $taskRoot ($taskCase.name + '-' + $taskOperation + '-native.docx')),16)
        $taskResults += $taskResult
        Write-Output ($taskCase.name + ' ' + $taskOperation + ' type=' + $taskResult.type + ' paragraphs=' + $taskResult.paragraphs)
      } finally { $taskDoc.Close([ref]0) }
    }
  }
} finally { $taskWord.Quit([ref]0) }
$taskResults | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskRoot 'native-edits.json')
