param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/script-input'))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Root).Path
$source = Join-Path ([IO.Path]::GetTempPath()) (([Guid]::NewGuid().ToString()) + '.docx')
Copy-Item -LiteralPath (Join-Path $root 'control.docx') -Destination $source -Force
$cases = Get-Content -LiteralPath (Join-Path $root 'cases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
$doc = $null
try {
 $doc=$word.Documents.Open($source,$false,$false)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 for($i=0;$i -lt $cases.Count;$i++){
  $p=$doc.Paragraphs.Item($i+1).Range
  $doc.Range($p.Start+1,$p.Start+1).Select()
  $word.Selection.TypeText([string]$cases[$i].text)
 }
 $doc.SaveAs2([string](Join-Path $root 'native.docx'),16)
 $doc.Close([ref]0); $doc=$null
 $hashes=@{}
 foreach($name in @('control.docx','native.docx','cases.json')){$hashes[$name]=(Get-FileHash -LiteralPath (Join-Path $root $name) -Algorithm SHA256).Hash.ToLower()}
 [IO.File]::WriteAllText((Join-Path $root 'native-recording.json'),(@{build=[string]$word.Build;method='Selection.TypeText';hashes=$hashes;caseCount=$cases.Count}|ConvertTo-Json -Depth 5))
}finally{
 try { if($null -ne $doc){$doc.Close([ref]0)} }
 finally { $word.Quit([ref]0); Remove-Item -LiteralPath $source }
}
