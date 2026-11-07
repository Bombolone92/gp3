param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/script-format-commands'))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Root).Path
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
$doc = $null
$records = @()
try {
  foreach ($command in @('Bold', 'Italic')) {
    $source = Join-Path $root 'control.docx'
    $copy = Join-Path $root "input-$command.docx"
    Copy-Item -LiteralPath $source -Destination $copy -Force
    $source = $copy
    $doc = $word.Documents.Open($source, $false, $false)
    if ($doc.FullName -ne $source) { throw 'Wrong source' }
    for ($i = 1; $i -le $doc.Paragraphs.Count; $i++) {
      $p = $doc.Paragraphs.Item($i).Range
      $doc.Range($p.Start, $p.End - 1).Select()
      $f = $word.Selection.Font
      $before = @{ bold = $f.Bold; boldCs = $f.BoldBi; italic = $f.Italic; italicCs = $f.ItalicBi; size = $f.Size; sizeCs = $f.SizeBi }
      $before.pressed = $word.CommandBars.GetPressedMso($command)
      if ($command -eq 'Bold') { $word.CommandBars.ExecuteMso('Bold') }
      elseif ($command -eq 'Italic') { $word.CommandBars.ExecuteMso('Italic') }
      $f = $word.Selection.Font
      $records += @{ index = $i - 1; command = $command; before = $before; after = @{ bold = $f.Bold; boldCs = $f.BoldBi; italic = $f.Italic; italicCs = $f.ItalicBi; size = $f.Size; sizeCs = $f.SizeBi } }
    }
    $out = Join-Path $root "$command.docx"
    $doc.SaveAs2([string]$out, 16)
    $doc.Close([ref]0); $doc = $null
  }
  $hashes = @{}
  foreach ($name in @('control.docx','cases.json','Bold.docx','Italic.docx')) { $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $root $name) -Algorithm SHA256).Hash.ToLower() }
  [IO.File]::WriteAllText((Join-Path $root 'native-commands.json'), (@{ build = [string]$word.Build; records = $records; hashes = $hashes } | ConvertTo-Json -Depth 8))
} finally {
  if ($null -ne $doc) { $doc.Close([ref]0) }
  $word.Quit([ref]0)
}
