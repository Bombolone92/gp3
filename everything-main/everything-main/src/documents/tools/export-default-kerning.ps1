$ErrorActionPreference = 'Stop'
$folder = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot -Parent) 'tests/fixtures/default-kerning'))
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$records = @()
try {
  foreach ($case in (Get-Content (Join-Path $folder 'cases.json') -Raw | ConvertFrom-Json)) {
    $source = (Resolve-Path -LiteralPath (Join-Path $folder ($case.name + '.docx'))).Path
    $document = $null
    try {
      Write-Output ('Opening ' + $source)
      $document = $word.Documents.Open($source, $false, $true)
      if ($document.FullName -ne $source) { throw 'The reference application opened a different document.' }
      Write-Output ('Confirmed ' + $document.FullName)
      $document.Repaginate()
      $destination = [IO.Path]::GetFullPath((Join-Path $folder ($case.name + '-native.pdf')))
      Write-Output ('Exporting ' + $destination)
      $document.ExportAsFixedFormat($destination, 17)
      $thresholds = @($document.Paragraphs | ForEach-Object { $_.Range.Font.Kerning })
      $records += @{ name = $case.name; thresholds = $thresholds; version = $word.Version; build = $word.Build }
      Write-Output ($case.name + ': ' + ($thresholds -join ', '))
    } finally { if ($null -ne $document) { $document.Close([ref]0) } }
  }
} finally { $word.Quit([ref]0) }
ConvertTo-Json -Depth 5 -InputObject $records | Set-Content (Join-Path $folder 'native-com.json') -Encoding UTF8
