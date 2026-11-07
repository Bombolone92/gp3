param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/script-size-commands'))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Root).Path
$source = Join-Path $root 'control.docx'
$copy = Join-Path ([IO.Path]::GetTempPath()) (([Guid]::NewGuid().ToString()) + '.docx')
Copy-Item -LiteralPath $source -Destination $copy
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
$doc = $null
try {
  $doc = $word.Documents.Open($copy, $false, $false)
  if ($doc.FullName -ne $copy) { throw 'Wrong source' }
  $control = $word.CommandBars.FindControl(4,1731)
  if ($null -eq $control) { throw 'Native Font Size command unavailable' }
  $records = @()
  for ($i=1; $i -le $doc.Paragraphs.Count; $i++) {
    $p = $doc.Paragraphs.Item($i).Range
    $doc.Range($p.Start,$p.End-1).Select()
    $before = @{size=$word.Selection.Font.Size;sizeCs=$word.Selection.Font.SizeBi;controlText=$control.Text}
    $control.Text = '18.5'
    $control.Execute()
    $records += @{index=$i-1;before=$before;after=@{size=$word.Selection.Font.Size;sizeCs=$word.Selection.Font.SizeBi;controlText=$control.Text}}
  }
  $doc.SaveAs2([string](Join-Path $root 'native.docx'),16)
  $doc.Close([ref]0); $doc = $null
  $hashes = @{}
  foreach ($name in @('control.docx','cases.json','native.docx')) { $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $root $name) -Algorithm SHA256).Hash.ToLower() }
  [IO.File]::WriteAllText((Join-Path $root 'native-commands.json'), (@{build=[string]$word.Build;commandId=$control.Id;records=$records;hashes=$hashes} | ConvertTo-Json -Depth 6))
} finally {
  try { if ($null -ne $doc) { $doc.Close([ref]0) } }
  finally { $word.Quit([ref]0); Remove-Item -LiteralPath $copy }
}
