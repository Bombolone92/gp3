param([string]$Directory = (Join-Path $PSScriptRoot '../tests/fixtures/field-refresh'), [switch]$IncludePdf)
$ErrorActionPreference = 'Stop'
$taskDirectory = (Resolve-Path -LiteralPath $Directory).Path
$taskResults = @()
function Read-Hash([string]$path) {
  $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}
function Read-Fields($document) {
  $rows = @()
  foreach ($field in $document.Fields) {
    $rows += [ordered]@{ code = $field.Code.Text; result = $field.Result.Text; locked = [bool]$field.Locked; type = [int]$field.Type }
  }
  return ,$rows
}
foreach ($name in @('absent', 'false', 'true')) {
  $source = Join-Path $taskDirectory ($name + '.docx')
  Write-Output "Hashing $name"
  $hash = (Read-Hash $source)
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $document = $null
  try {
    Write-Output "Opening $name"
    $document = $word.Documents.Open($source, $false, $true)
    if ($document.FullName -ne $source) { throw 'The reference application opened a different file.' }
    Write-Output "Reading fields $name"
    $row = [ordered]@{ name = $name; sourceSha256 = $hash; referenceBuild = $word.Build; updateFieldsAtPrint = [bool]$word.Options.UpdateFieldsAtPrint; opened = (Read-Fields $document) }
    Write-Output "Repaginating $name"
    $document.Repaginate()
    $row.repaginated = Read-Fields $document
    $row | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskDirectory ($name + '-opening.json')) -Encoding utf8
    if ($IncludePdf) {
      $pdf = Join-Path $taskDirectory ($name + '-printed.pdf')
      Write-Output "Exporting $name"
      $document.ExportAsFixedFormat($pdf, 17)
      $row.exported = Read-Fields $document
      $row.pdfSha256 = (Get-FileHash -LiteralPath $pdf -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    Write-Output "Updating $name"
    $row.updateResult = $document.Fields.Update()
    $row.explicitUpdate = Read-Fields $document
    $taskResults += $row
  } finally {
    if ($document) { $document.Close([ref]0); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    $word.Quit([ref]0)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
  }
  if ((Read-Hash $source) -ne $hash) { throw 'Source changed during native capture.' }
}
$taskResults | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskDirectory 'reference.json') -Encoding utf8
$taskResults | ForEach-Object { [pscustomobject]@{ name = $_.name; opened = ($_.opened.result -join ','); repaginated = ($_.repaginated.result -join ','); exported = ($_.exported.result -join ','); updated = ($_.explicitUpdate.result -join ',') } } | Format-Table
