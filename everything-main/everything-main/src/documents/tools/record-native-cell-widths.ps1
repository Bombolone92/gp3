param(
  [Parameter(Mandatory=$true)][string]$SourceFullPath,
  [Parameter(Mandatory=$true)][string]$OutputJson,
  [string]$OutputPdf
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $SourceFullPath).Path
$destination = [IO.Path]::GetFullPath($OutputJson)
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$temporaryPdf = !$OutputPdf
$pdf = if ($OutputPdf) { [IO.Path]::GetFullPath($OutputPdf) } else {
  Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '-native-cell-widths.pdf')
}
if ($destination -eq $source -or $pdf -eq $source -or $pdf -eq $destination) {
  throw 'Source, JSON and PDF paths must be distinct.'
}
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$document = $null
try {
  $document = $word.Documents.Open($source, $false, $true)
  if ($document.FullName -ne $source -or !$document.ReadOnly) { throw 'Expected exact read-only source.' }
  $document.Repaginate()
  # AutoFit can remain lazily initialized after Repaginate alone. Export
  # finishes the reference print layout before inspecting its cell API.
  $document.ExportAsFixedFormat($pdf, 17)
  $tables = @(
    foreach ($table in $document.Tables) {
      $cells = @(
        foreach ($cell in $table.Range.Cells) {
          $width = [double]$cell.Width
          if ([double]::IsNaN($width) -or [double]::IsInfinity($width) -or $width -le 0 -or $width -ge 9999999) {
            throw 'The reference application did not return a usable cell width.'
          }
          [ordered]@{row=[int]$cell.RowIndex; column=[int]$cell.ColumnIndex; width=$width}
        }
      )
      ,$cells
    }
  )
  $result = [ordered]@{
    source=[IO.Path]::GetFileName($source); sha256=$hash
    referenceVersion=$word.Version; referenceBuild=$word.Build
    measurement='Reference Cell.Width in points after Repaginate; not PDF fill bounds'
    layoutInitialization='PDF export before cell inspection'
    tables=$tables
  }
  if ($OutputPdf) {
    $result['pdf'] = [IO.Path]::GetFileName($pdf)
    $result['pdfSha256'] = (Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLowerInvariant()
  }
} finally {
  try {
    try { if ($null -ne $document) { $document.Close([ref]0) } }
    finally { $word.Quit([ref]0) }
  } finally {
    if ($temporaryPdf -and (Test-Path -LiteralPath $pdf)) { Remove-Item -LiteralPath $pdf }
  }
}
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
  throw 'Source changed during measurement.'
}
[IO.File]::WriteAllText($destination, ($result | ConvertTo-Json -Depth 10) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('Recorded cell widths: ' + $destination)
