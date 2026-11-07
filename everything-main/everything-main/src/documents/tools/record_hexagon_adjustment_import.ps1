$ErrorActionPreference = 'Stop'
$folder = Join-Path $PSScriptRoot '../tests/fixtures/hexagon-shapes'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$results = @()
try {
  foreach ($name in @('empty','partial','ordered','reversed')) {
    $path = (Resolve-Path (Join-Path $folder "adjustments-$name.docx")).Path
    $doc = $null
    $entry = [ordered]@{ name=$name; sourceSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower(); opened=$false }
    try {
      $doc = $word.Documents.Open($path, $false, $true)
      if ($doc.FullName -ne $path) { throw 'The reference application opened a different document.' }
      $entry.opened = $true
    } catch { $entry.error = $_.Exception.Message }
    finally { if ($doc) { $doc.Close(0) } }
    $results += $entry
  }
  [ordered]@{referenceVersion="$($word.Build)";results=$results} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $folder 'adjustment-import.json')
} finally { $word.Quit() }
