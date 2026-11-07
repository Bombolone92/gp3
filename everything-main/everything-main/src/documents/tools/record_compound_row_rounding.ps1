$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/compound-row-rounding'))
$source=Join-Path $folder 'control.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source){throw 'Wrong document opened'}
 $document.Repaginate()
 $positions=@()
 for($t=1;$t -le $document.Tables.Count;$t++) {
  $table=$document.Tables.Item($t)
  for($r=1;$r -le $table.Rows.Count;$r++) {
   $range=$table.Cell($r,1).Range.Duplicate;$range.Collapse(1)
   $positions+=@{case=$t;row=$r;y=$range.Information(6);page=$range.Information(3)}
  }
 }
 @{build=$word.Build;sourceSha256=(Get-FileHash $source -Algorithm SHA256).Hash.ToLower();positions=$positions} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $folder 'native-positions.json')
 Write-Output ('Recorded '+$positions.Count+' native row positions')
} finally {try {if($document){$document.Close([ref]0)}} finally {$word.Quit([ref]0)}}
