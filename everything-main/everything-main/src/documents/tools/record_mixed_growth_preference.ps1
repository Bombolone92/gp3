# Native read-only measurements for the independently authored growth controls.
$ErrorActionPreference='Stop'
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/mixed-growth-preference'))
$source=Join-Path $folder 'control.docx';$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true);if($doc.FullName -ne $source){throw 'Wrong source'};$doc.Repaginate()
 $widths=@();for($i=1;$i -le $doc.Tables.Count;$i++){$row=@();for($j=1;$j -le 4;$j++){$row += [double]$doc.Tables.Item($i).Cell(3,$j).Width};$widths+=,$row}
 $cases=Get-Content (Join-Path $folder 'cases.json') -Raw | ConvertFrom-Json;if($widths.Count -ne $cases.Count){throw 'Unexpected matrix size'}
 $hashes=@{};foreach($name in @('control.docx','cases.json')){$hashes[$name]=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $folder $name)).Hash.ToLowerInvariant()}
 @{referenceBuild=$word.Build;method='Read-only exact source; Repaginate; Cell(3,column).Width in points. No PDF export.';widthsBeforePdf=$widths;hashes=$hashes} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $folder 'native-widths.json') -Encoding UTF8
 Write-Output ('Recorded '+$widths.Count+' native tables')
}finally{if($doc){$doc.Close([ref]0)};$word.Quit([ref]0)}
