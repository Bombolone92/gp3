param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256
)
$ErrorActionPreference='Stop'
$drawingSource=[IO.Path]::GetFullPath($Source)
$drawingRoot=[IO.Path]::GetFullPath($OutputRoot)
$drawingOutput=Join-Path $drawingRoot 'native-edited.docx'
$drawingMetadata=Join-Path $drawingRoot 'native-edits.json'
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or -not(Test-Path -LiteralPath $drawingRoot -PathType Container)){throw 'Invalid capture arguments'}
if((Test-Path -LiteralPath $drawingOutput) -or (Test-Path -LiteralPath $drawingMetadata)){throw 'Use fresh native output paths'}
function SourceHash {
 $stream=[IO.File]::Open($drawingSource,'Open','Read','ReadWrite');$hash=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$hash.Dispose();$stream.Dispose()}
}
$before=SourceHash
if($before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Wrong source hash'}
# Opening is done by the document-opening helper, on an owned fixture copy. This script
# uses native range edits and separate SaveAs2; no UI setters, open/close/quit.
$drawingDocument=[Runtime.InteropServices.Marshal]::BindToMoniker($drawingSource)
try {
 if($drawingDocument.FullName -ne $drawingSource -or $drawingDocument.ReadOnly -or $drawingDocument.Shapes.Count -ne 2){throw 'Wrong owned document/state'}
 $frames=@();$story=$drawingDocument.StoryRanges.Item(5)
 while($null -ne $story){$frames+=,$story;$story=$story.NextStoryRange;if($frames.Count -gt 3){throw 'Unexpected text story'}}
 if($frames.Count -ne 3){throw 'Missing drawing text story'}
 $titles=@('Standalone title','Left grouped title','Right grouped title')
 $observed=@()
 for($i=0;$i -lt 3;$i++) {
  $text=$frames[$i]
  if(-not $text.Text.StartsWith($titles[$i]+"`rBefore ")){throw 'Wrong drawing story correspondence'}
  if($text.Fields.Count -ne @(1,1,3)[$i]){throw 'Unexpected field count'}
  $fields=@();for($j=1;$j -le $text.Fields.Count;$j++){$f=$text.Fields.Item($j);$fields+=@{code=$f.Code.Text;result=$f.Result.Text;locked=[bool]$f.Locked}}
  $observed+=@{title=$titles[$i];before=$text.Text;fieldsBefore=$fields}
  $range=$text.Paragraphs.Item(2).Range.Duplicate
  try {$range.End=$range.Start+6;if($range.Text -ne 'Before'){throw 'Wrong neighboring text'};$range.Text='Edited'}
  finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
  $text=$frames[$i]
  $fields=@();for($j=1;$j -le $text.Fields.Count;$j++){$f=$text.Fields.Item($j);$fields+=@{code=$f.Code.Text;result=$f.Result.Text;locked=[bool]$f.Locked}}
  $observed[$i].after=$text.Text;$observed[$i].fieldsAfter=$fields
  if(($observed[$i].fieldsBefore | ConvertTo-Json -Depth 5 -Compress) -ne ($fields | ConvertTo-Json -Depth 5 -Compress)){throw 'Neighbor edit changed native fields'}
 }
 $drawingDocument.SaveAs2([string]$drawingOutput,16)
 if($drawingDocument.FullName -ne $drawingOutput -or -not $drawingDocument.Saved -or (SourceHash) -ne $before){throw 'Saved reference/source mismatch'}
 @{scope='Native neighboring text edits in standalone/grouped drawing page fields; separate SaveAs2 result, unchanged source';sourceSha256=$before;sourceUnchanged=$true;referenceBuild=$drawingDocument.Application.Build;frames=$observed} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $drawingMetadata -Encoding utf8
 Write-Output 'Native neighboring edits retain all five page fields'
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($drawingDocument)}
