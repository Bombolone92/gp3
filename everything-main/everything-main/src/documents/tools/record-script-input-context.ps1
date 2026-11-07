param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/script-input-context'))
$ErrorActionPreference = 'Stop'
$root=[IO.Path]::GetFullPath($Root)
$source=Join-Path $root 'input.docx'
Copy-Item -LiteralPath (Join-Path $root 'control.docx') -Destination $source -Force
$cases=Get-Content -LiteralPath (Join-Path $root 'cases.json') -Raw -Encoding UTF8|ConvertFrom-Json
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try{
 $doc=$word.Documents.Open($source,$false,$false)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 $version=$word.Version;$build=$word.Build
 for($i=$cases.Count-1;$i -ge 0;$i--){
  $p=$doc.Paragraphs.Item($i+1).Range
  $doc.Range($p.Start+1,$p.Start+1).Select()
  foreach($step in $cases[$i].steps){
   if($step -eq "`n"){$word.Selection.TypeParagraph()}
   else{$word.Selection.TypeText(([string]$step).Replace("`n","`r"))}
  }
 }
 $doc.SaveAs2([string](Join-Path $root 'native.docx'),16)
}finally{if($null -ne $doc){$doc.Close([ref]0)};$word.Quit([ref]0)}

$hashes=@{};foreach($name in @('control.docx','native.docx','cases.json')){$hashes[$name]=(Get-FileHash (Join-Path $root $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText((Join-Path $root 'native-recording.json'),(@{caseCount=$cases.Count;version=$version;build=$build;method='Sequential Selection.TypeText / Selection.TypeParagraph';hashes=$hashes}|ConvertTo-Json -Depth 5))
