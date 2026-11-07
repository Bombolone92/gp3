param([Parameter(Mandatory=$true)][string]$SourceFullPath,[Parameter(Mandatory=$true)][string]$OutputJson,[string]$TextPattern='.',[int]$MaxCharacters=128)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong source opened'}
 $doc.Repaginate();$results=@()
 foreach($paragraph in $doc.Paragraphs){
  $range=$paragraph.Range;$raw=[string]$range.Text;$label=($raw -replace '\s+',' ').Trim().Trim([char]7).Trim()
  if(!$label -or $label -notmatch $TextPattern){continue}
  if($raw.Length -gt $MaxCharacters){throw 'Selected paragraph exceeds MaxCharacters'}
  $positions=@()
  for($offset=0;$offset -lt $raw.Length;$offset++){
   if([int][char]$raw[$offset] -in @(7,13)){continue}
   $caret=$doc.Range($range.Start+$offset,$range.Start+$offset)
   $x=$caret.Information(5);$y=$caret.Information(6)
   if($x -lt 0 -or $y -lt 0){throw ('Unavailable native geometry for '+$label+' at '+$offset)}
   $positions+=@{offset=$offset;x=$x;y=$y;page=$caret.Information(3)}
  }
  $results+=@{text=$label;raw=$raw;start=$range.Start;positions=$positions}
 }
 if(!$results.Count){throw 'No matching paragraphs'}
 $data=@{sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();referenceBuild=[string]$word.Build;zoom=$doc.ActiveWindow.View.Zoom.Percentage;pages=$doc.ComputeStatistics(2);cases=$results}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputJson),($data|ConvertTo-Json -Depth 9)+"`n",(New-Object Text.UTF8Encoding $false))
 Write-Output ('Recorded '+$results.Count+' native paragraph range-position sequences')
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
