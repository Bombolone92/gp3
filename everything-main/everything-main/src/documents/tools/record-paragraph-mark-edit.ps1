param([string]$Root = (Join-Path $PSScriptRoot '../tests/fixtures/paragraph-mark-edit'))
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($Root)
$source=Join-Path $root 'input.docx'
Copy-Item -LiteralPath (Join-Path $root 'control.docx') -Destination $source -Force
$cases=Get-Content (Join-Path $root 'cases.json') -Raw|ConvertFrom-Json
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try{
 $doc=$word.Documents.Open($source,$false,$false)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 $version=$word.Version; $build=$word.Build
 $records=@()
 for($i=$cases.Count-1;$i -ge 0;$i--){
  $c=$cases[$i];$p=$doc.Paragraphs.Item(2*$i+1).Range
  $doc.Range($p.Start+[int]$c.start,$p.Start+[int]$c.end).Select()
  $beforeCount=$doc.Paragraphs.Count
  $selectedText=$word.Selection.Text
  if($c.text -eq ''){$null=$word.Selection.Delete(1,1)}
  elseif($c.text -eq "`n"){$word.Selection.TypeParagraph()}
  else{$word.Selection.TypeText(([string]$c.text).Replace("`n","`r"))}
  $count=2+$doc.Paragraphs.Count-$beforeCount
  $texts=@();for($j=0;$j -lt $count;$j++){$texts+=$doc.Paragraphs.Item(2*$i+1+$j).Range.Text}
  $records+=@{index=$i;count=$count;selectedText=$selectedText;texts=$texts}
 }
 $doc.SaveAs2([string](Join-Path $root 'native.docx'),16)
 [IO.File]::WriteAllText((Join-Path $root 'records.json'),($records|Sort-Object index|ConvertTo-Json -Depth 5))
}finally{if($null -ne $doc){$doc.Close([ref]0)};$word.Quit([ref]0)}

$hashes=@{};foreach($name in @('control.docx','native.docx','cases.json','records.json')){$hashes[$name]=(Get-FileHash (Join-Path $root $name) -Algorithm SHA256).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText((Join-Path $root 'native-recording.json'),(@{version=$version;build=$build;method='Selection.TypeParagraph / Selection.TypeText / Selection.Delete(1,1)';hashes=$hashes}|ConvertTo-Json -Depth 5))
