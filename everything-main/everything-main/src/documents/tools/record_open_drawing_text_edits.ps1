param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256
)
# Use the opening helper first on a fresh, owned fixture copy. This recorder
# deliberately edits that copy's in-memory drawing text and saves a new file.
# It never opens/closes the reference application, changes UI state, or saves over the source.
$ErrorActionPreference='Stop'
$drawingSource=[IO.Path]::GetFullPath($Source)
$drawingRoot=[IO.Path]::GetFullPath($OutputRoot)
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or -not(Test-Path -LiteralPath $drawingRoot -PathType Container)){throw 'Invalid capture arguments'}
$drawingOutput=Join-Path $drawingRoot 'native-edited.docx'
$drawingMetadata=Join-Path $drawingRoot 'native-edits.json'
if((Test-Path -LiteralPath $drawingOutput) -or (Test-Path -LiteralPath $drawingMetadata)){throw 'Use a fresh output directory'}
function SourceHash {
 $stream=[IO.File]::Open($drawingSource,'Open','Read','ReadWrite')
 $hash=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$hash.Dispose();$stream.Dispose()}
}
$before=SourceHash
if($before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
$drawingDocument=[Runtime.InteropServices.Marshal]::BindToMoniker($drawingSource)
try {
 if($drawingDocument.FullName -ne $drawingSource -or -not $drawingDocument.Saved -or $drawingDocument.ReadOnly -or $drawingDocument.Paragraphs.Count -ne 5 -or $drawingDocument.Shapes.Count -ne 2){throw 'Wrong owned fixture/state'}
 $standalone=$drawingDocument.Shapes.Item(1)
 $group=$drawingDocument.Shapes.Item(2)
 if($standalone.Name -ne 'Drawing 1' -or $group.Name -ne 'Drawing 2' -or $group.Type -ne 6 -or $group.GroupItems.Count -ne 2){throw 'Wrong fixture shapes'}
 $frames=@($standalone,$group.GroupItems.Item(1),$group.GroupItems.Item(2))
 $titles=@('Standalone title','Left grouped title','Right grouped title')
 $observed=@()
 for($i=0;$i -lt 3;$i++) {
  $text=$frames[$i].TextFrame.TextRange
  if($text.Text -ne ($titles[$i]+"`rOriginal second paragraph`r")){throw 'Unexpected native frame text'}
  $observed+=@{title=$titles[$i];before=$text.Text;widthPt=[double]$frames[$i].Width;heightPt=[double]$frames[$i].Height;firstParagraphBold=[int]$text.Paragraphs.Item(1).Range.Font.Bold;secondParagraphBold=[int]$text.Paragraphs.Item(2).Range.Font.Bold}
 }
 foreach($edit in @(@{index=0;length=10;replacement='Updated'},@{index=1;length=4;replacement='Revised'})) {
  $range=$frames[$edit.index].TextFrame.TextRange.Duplicate
  try {$range.End=$range.Start+$edit.length;$range.Text=$edit.replacement}
  finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
 }
 for($i=0;$i -lt 3;$i++) {
  $text=$frames[$i].TextFrame.TextRange
  $observed[$i].after=$text.Text
  $observed[$i].afterFirstParagraphBold=[int]$text.Paragraphs.Item(1).Range.Font.Bold
  $observed[$i].afterSecondParagraphBold=[int]$text.Paragraphs.Item(2).Range.Font.Bold
 }
 if($observed[0].after -ne "Updated title`rOriginal second paragraph`r" -or $observed[1].after -ne "Revised grouped title`rOriginal second paragraph`r" -or $observed[2].after -ne $observed[2].before){throw 'Unexpected native editing result'}
 $drawingDocument.SaveAs2([string]$drawingOutput,16)
 if($drawingDocument.FullName -ne $drawingOutput -or -not $drawingDocument.Saved -or (SourceHash) -ne $before){throw 'Saved reference/source mismatch'}
 @{scope='Native reference range edits on an exact helper-opened owned fixture copy; separate SaveAs2 result, source bytes unchanged, no UI setters or application open/close/quit';sourceSha256=$before;sourceUnchanged=$true;referenceBuild=$drawingDocument.Application.Build;frames=$observed} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $drawingMetadata -Encoding utf8
 Write-Output 'Recorded two drawing-text edits; neighboring text/formatting retained and original bytes unchanged'
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($drawingDocument)}
