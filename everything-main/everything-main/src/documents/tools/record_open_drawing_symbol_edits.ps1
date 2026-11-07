param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$OutputRoot,[Parameter(Mandatory)][string]$ExpectedSha256)
# Helper-opened owned fixture only. Edit scratch memory and SaveAs a separate
# output; no application open/close/Quit or shared UI/view/selection setters.
$ErrorActionPreference='Stop'
$symbolSource=[IO.Path]::GetFullPath($Source);$symbolRoot=[IO.Path]::GetFullPath($OutputRoot)
$symbolOutput=Join-Path $symbolRoot 'native-edited.docx';$symbolMetadata=Join-Path $symbolRoot 'native-edits.json'
if(-not(Test-Path -LiteralPath $symbolRoot -PathType Container) -or (Test-Path -LiteralPath $symbolOutput) -or (Test-Path -LiteralPath $symbolMetadata)){throw 'Use a fresh output directory'}
function SourceHash {
 $stream=[IO.File]::Open($symbolSource,'Open','Read','ReadWrite');$hash=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose();$stream.Dispose()}
}
$before=SourceHash;if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
$symbolDocument=[Runtime.InteropServices.Marshal]::BindToMoniker($symbolSource)
try {
 if($symbolDocument.FullName -ne $symbolSource -or -not $symbolDocument.Saved -or $symbolDocument.ReadOnly -or $symbolDocument.Paragraphs.Count -ne 5 -or $symbolDocument.Shapes.Count -ne 2){throw 'Wrong owned document/state'}
 $standalone=$symbolDocument.Shapes.Item(1);$group=$symbolDocument.Shapes.Item(2)
 if($standalone.Name -ne 'Drawing 1' -or $group.Name -ne 'Drawing 2' -or $group.Type -ne 6 -or $group.GroupItems.Count -ne 2){throw 'Wrong shapes'}
 $frames=@($standalone,$group.GroupItems.Item(1),$group.GroupItems.Item(2));$titles=@('Standalone title','Left grouped title','Right grouped title');$observed=@()
 for($i=0;$i -lt 3;$i++) {
  $text=$frames[$i].TextFrame.TextRange
  if($text.Text -ne ($titles[$i]+"`rL ( R`r")){throw 'Unexpected native frame text'}
  $character=$text.Paragraphs.Item(2).Range.Characters.Item(3)
  $observed+=@{title=$titles[$i];before=$text.Text;symbolComCode=[int][char]$character.Text;underlyingFont=[string]$character.Font.Name;allCaps=[int]$character.Font.AllCaps;smallCaps=[int]$character.Font.SmallCaps;widthPt=[double]$frames[$i].Width;heightPt=[double]$frames[$i].Height}
 }
 foreach($edit in @(@{index=0;length=10;replacement='Updated'},@{index=1;length=4;replacement='Revised'})) {
  $range=$frames[$edit.index].TextFrame.TextRange.Duplicate
  try {$range.End=$range.Start+$edit.length;$range.Text=$edit.replacement} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
 }
 for($i=0;$i -lt 3;$i++){$observed[$i].after=$frames[$i].TextFrame.TextRange.Text}
 $symbolDocument.SaveAs2([string]$symbolOutput,16)
 if($symbolDocument.FullName -ne $symbolOutput -or -not $symbolDocument.Saved -or (SourceHash) -ne $before){throw 'Saved reference/source mismatch'}
 @{scope='Native edits of helper-opened owned WPS symbol frames, saved separately; source unchanged, no UI setters';sourceSha256=$before;sourceUnchanged=$true;referenceBuild=$symbolDocument.Application.Build;frames=$observed} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $symbolMetadata -Encoding utf8
 Write-Output 'Saved native drawing-symbol edits; original unchanged'
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($symbolDocument)}
