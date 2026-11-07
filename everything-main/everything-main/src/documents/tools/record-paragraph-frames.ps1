param([string]$Directory = (Join-Path $PSScriptRoot '../tests/fixtures/paragraph-frames'), [string[]]$Names = @('page', 'margin', 'style', 'grouped', 'different'), [switch]$MetadataOnly)
$ErrorActionPreference = 'Stop'
$taskDirectory = (Resolve-Path -LiteralPath $Directory).Path
$taskRows = @()
function Read-SharedFrameHash([string]$Path) {
  # The required document-opening helper can leave this exact input open.
  # Share reads/writes with the reference application; the before/after check still rejects edits.
  $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
  try { return (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant() }
  finally { $stream.Dispose() }
}
foreach ($name in $Names) {
  $source = Join-Path $taskDirectory ($name + '.docx')
  $hash = Read-SharedFrameHash $source
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0
  $document = $null
  try {
    Write-Output "Opening $name"
    $document = $word.Documents.Open($source, $false, $true)
    if ($document.FullName -ne $source) { throw 'The reference application opened a different source.' }
    Write-Output "Repaginating $name"
    $document.Repaginate()
    $frames = @()
    foreach ($frame in $document.Frames) {
      $frames += [ordered]@{ text=$frame.Range.Text; width=[double]$frame.Width; height=[double]$frame.Height; x=[double]$frame.HorizontalPosition; y=[double]$frame.VerticalPosition; horizontalBase=[int]$frame.RelativeHorizontalPosition; verticalBase=[int]$frame.RelativeVerticalPosition; wrap=[int]$frame.TextWrap }
    }
    $paragraphs = @()
    foreach ($paragraph in $document.Paragraphs) {
      $range = $paragraph.Range.Duplicate; $range.Collapse(1)
      $paragraphs += [ordered]@{ text=$paragraph.Range.Text; x=[double]$range.Information(5); y=[double]$range.Information(6); page=[int]$range.Information(3) }
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
    }
    $row = [ordered]@{name=$name; sourceSha256=$hash; referenceBuild=$word.Build; frames=$frames; paragraphs=$paragraphs; pages=[int]$document.ComputeStatistics(2)}
    $footers = @()
    foreach ($section in $document.Sections) {
      $footer = $section.Footers.Item(1)
      if (!$footer.Exists) { continue }
      Write-Output "Inspecting primary footer $name"
      $document.ActiveWindow.View.Type = 3
      $document.ActiveWindow.View.SeekView = 4
      $footerFrames = @(); $footerParagraphs = @()
      foreach ($frame in $footer.Range.Frames) {
        $footerFrames += [ordered]@{text=$frame.Range.Text; width=[double]$frame.Width; height=[double]$frame.Height; x=[double]$frame.HorizontalPosition; y=[double]$frame.VerticalPosition; horizontalBase=[int]$frame.RelativeHorizontalPosition; verticalBase=[int]$frame.RelativeVerticalPosition; wrap=[int]$frame.TextWrap}
      }
      foreach ($paragraph in $footer.Range.Paragraphs) {
        $range = $paragraph.Range.Duplicate; $range.Collapse(1)
        $footerParagraphs += [ordered]@{text=$paragraph.Range.Text; x=[double]$range.Information(5); y=[double]$range.Information(6); page=[int]$range.Information(3)}
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
      }
      $footers += [ordered]@{frames=$footerFrames; paragraphs=$footerParagraphs}
      $document.ActiveWindow.View.SeekView = 0
    }
    if ($footers.Length) { $row.footers = $footers }
    $row | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskDirectory ($name+'-native.json')) -Encoding utf8
    if (!$MetadataOnly) {
      Write-Output "Exporting $name"
      $pdf = Join-Path $taskDirectory ($name+'-native.pdf')
      $document.ExportAsFixedFormat($pdf,17)
      $row.pdfSha256 = (Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $taskRows += $row
    $referenceName = if ($MetadataOnly) { 'native-metadata-reference.json' } else { 'reference.json' }
    $taskRows | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskDirectory $referenceName) -Encoding utf8
  } finally {
    if ($document) { $document.Close([ref]0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    $word.Quit([ref]0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  }
  if ((Read-SharedFrameHash $source) -ne $hash) { throw 'Native capture modified a source.' }
  Write-Output "Recorded $name"
}
