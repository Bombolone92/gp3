param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/bidi-layout'))
$ErrorActionPreference = 'Stop'
$rootPath = (Resolve-Path -LiteralPath $Root).Path
$source = Join-Path $rootPath 'control.docx'
# The reference application may already have the source open in the user's separate instance.
$stream = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
$sha = [Security.Cryptography.SHA256]::Create()
try { $sourceHash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLower() }
finally { $stream.Dispose(); $sha.Dispose() }
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
$document = $null; $saved = $null; $records = @()
try {
  $saved = $word.Options.CursorMovement
  $document = $word.Documents.Open($source, $false, $true)
  if ($document.FullName -ne $source) { throw 'The reference application opened a different source' }
  $document.Repaginate()
  foreach ($mode in @(0, 1)) {
    $word.Options.CursorMovement = $mode
    foreach ($index in @(7, 9, 14, 17)) {
      $paragraph = $document.Paragraphs.Item(2 * $index + 2).Range
      foreach ($command in @('CharLeft', 'CharRight')) {
        $document.Range($paragraph.Start + 8, $paragraph.Start + 8).Select()
        $steps = @()
        for ($i = 0; $i -lt 8; $i++) {
          $selection = $word.Selection
          $x = $selection.Information(5); $y = $selection.Information(6)
          if ($x -lt 0 -or $y -lt 0) { throw 'Native range position unavailable' }
          $steps += @{ offset = $selection.Start - $paragraph.Start; x = $x; y = $y }
          if ($command -eq 'CharRight') { $null = $word.WordBasic.CharRight(1) }
          else { $null = $word.WordBasic.CharLeft(1) }
        }
        $records += @{ index = $index; mode = $mode; command = $command; steps = $steps }
      }
    }
  }
  $result = @{ originalCursorMovement = $saved; referenceVersion = [string]$word.Build; sourceSha256 = $sourceHash; cases = $records }
} finally {
  try {
    if ($null -ne $saved) {
      $word.Options.CursorMovement = $saved
      if ($word.Options.CursorMovement -ne $saved) { throw 'Could not restore cursor movement preference' }
    }
    if ($null -ne $document) { $document.Close([ref]0) }
  } finally { $word.Quit([ref]0) }
}
[IO.File]::WriteAllText((Join-Path $rootPath 'native-navigation.json'), ($result | ConvertTo-Json -Depth 10) + "`n", (New-Object Text.UTF8Encoding $false))
Write-Output 'Recorded native character commands in logical and visual modes; restored original preference.'
