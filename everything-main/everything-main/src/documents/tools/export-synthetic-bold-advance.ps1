param([string]$Name='modern')
$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/synthetic-bold-advance'))
$sourceName=if($Name -eq 'weights'){'../synthetic-bold/weights.docx'}else{$Name+'.docx'}
$source=(Resolve-Path -LiteralPath (Join-Path $folder $sourceName)).Path
$cases=Get-Content -LiteralPath (Join-Path $folder ($Name+'-cases.json')) -Raw | ConvertFrom-Json
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null;$results=@()
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong document'}
 for($i=0;$i -lt $cases.Count;$i++){
  $case=$cases[$i];$p=$doc.Paragraphs.Item($i+1);$low=1;$high=10800
  foreach($edge in @($low,$high)){$p.Format.RightIndent=540-$edge/20.0;$doc.Repaginate();$lines=$p.Range.ComputeStatistics(1);if(($edge -eq $low -and $lines -eq 1) -or ($edge -eq $high -and $lines -ne 1)){throw 'Boundary not bracketed'}}
  while($high-$low -gt 1){$mid=[int][Math]::Floor(($low+$high)/2);$p.Format.RightIndent=540-$mid/20.0;$doc.Repaginate();$lines=$p.Range.ComputeStatistics(1);if($lines -eq 1){$high=$mid}else{$low=$mid}}
  $results+=@{index=$i;family=$case.family;size=$case.size;bold=$case.bold;minimumTwips=$high;nativeFont=$p.Range.Font.Name;nativeSize=$p.Range.Font.Size;nativeKerning=$p.Range.Font.Kerning}
  Write-Output ('Case '+$i+' '+$case.family+' minimum '+($high/20.0));$p.Format.RightIndent=0
 }
 $doc.Repaginate();$doc.ExportAsFixedFormat([IO.Path]::GetFullPath((Join-Path $folder ($Name+'-native.pdf'))),17)
 @{sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();referenceBuild=$word.Build;cases=$results} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $folder ($Name+'-native.json'))
} finally {try{if($null -ne $doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
