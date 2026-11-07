param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path (Join-Path $PSScriptRoot '../tests/fixtures/cell-text-direction/control.docx')).Path
$stream = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$sha = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLower() }
finally { $stream.Dispose(); $sha.Dispose() }
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$document = $null
try {
  $document = $word.Documents.Open($source, $false, $true)
  if ($document.FullName -ne $source) { throw 'The reference application opened a different source' }
  $document.Repaginate()
  $records = @()
  foreach ($tableIndex in @(1, 4, 5)) {
    foreach ($cellIndex in @(1, 2, 3)) {
      $cell = $document.Tables.Item($tableIndex).Cell(1, $cellIndex)
      foreach ($offset in @(0, 3, 7)) {
        foreach ($command in @('MoveLeft', 'MoveRight', 'MoveUp', 'MoveDown', 'HomeKey', 'EndKey')) {
          $position = $cell.Range.Start + $offset
          $document.Range($position, $position).Select()
          $selection = $word.Selection
          $before = @{ start = $selection.Start; x = $selection.Information(5); y = $selection.Information(6) }
          switch ($command) {
            'MoveLeft' { $null = $selection.MoveLeft(1, 1, 0) }
            'MoveRight' { $null = $selection.MoveRight(1, 1, 0) }
            'MoveUp' { $null = $selection.MoveUp(5, 1, 0) }
            'MoveDown' { $null = $selection.MoveDown(5, 1, 0) }
            'HomeKey' { $null = $selection.HomeKey(5, 0) }
            'EndKey' { $null = $selection.EndKey(5, 0) }
          }
          $records += @{ table = $tableIndex; cell = $cellIndex; direction = @('lrTb','btLr','tbRl')[$cellIndex - 1]; offset = $offset; command = $command; before = $before;
            after = @{ start = $selection.Start; x = $selection.Information(5); y = $selection.Information(6) }; delta = $selection.Start - $position }
        }
      }
    }
  }
  $data = @{ sourceSha256 = $sourceHash; referenceVersion = $word.Version; referenceBuild = $word.Build;
    method = 'Reference Selection API commands; physical keyboard dispatch has not been measured'; cases = $records }
  $json = $data | ConvertTo-Json -Depth 8
  if ($OutputPath) { [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json + "`n", (New-Object Text.UTF8Encoding $false)) }
  else { $json }
} finally {
  try { if ($null -ne $document) { $document.Close([ref]0) } } finally { $word.Quit([ref]0) }
}
