param([string]$OutputDirectory = (Join-Path $PSScriptRoot '../tests/fixtures/plain-text-controls'))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($OutputDirectory)
$source = Join-Path $root 'control.docx'
$cases = Get-Content -LiteralPath (Join-Path $root 'cases.json') -Raw | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
try {
  foreach ($case in $cases) {
    $doc = $word.Documents.Open($source, $false, $true)
    try {
      if ($doc.FullName -ne $source) { throw 'Wrong reference document' }
      if ($results.Count -eq 0) { $doc.ExportAsFixedFormat((Join-Path $root 'native.pdf'), 17) }
      $control = $doc.SelectContentControlsByTitle($case.name).Item(1)
      $start = $control.Range.Start
      $range = $doc.Range($start + 2, $start + 4)
      if ($case.name -like '*format') {
        if ($case.name -like '*caret*') { $range = $doc.Range($start + 2, $start + 2) }
        $range.Font.Bold = -1
      } else {
        $range = $doc.Range($start + 2, $start + 2)
        if ($case.name -like '*enter' -or $case.name -eq 'existing-break') {
          $doc.Activate(); $range.Select(); $word.Selection.TypeText([string][char]11)
        } else { $range.Text = 'X' }
      }
      $doc.SaveAs2((Join-Path $root ($case.name + '-native.docx')), 16)
      $results += @{ case = $case.name; controls = $doc.ContentControls.Count }
    } finally { $doc.Close([ref]0) }
  }
} finally { $word.Quit([ref]0) }
$results | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'native-edits.json')
