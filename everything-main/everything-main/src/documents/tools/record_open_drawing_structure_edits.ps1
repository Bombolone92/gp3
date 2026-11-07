param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$OutputRoot,[Parameter(Mandatory)][string]$ExpectedSha256)
# Exact helper-opened owned fixture. Detached ranges; fresh separate save.
# No application Open/Close/Quit, selection or shared UI setters.
$ErrorActionPreference='Stop'
$structureSource=[IO.Path]::GetFullPath($Source);$structureRoot=[IO.Path]::GetFullPath($OutputRoot)
$structureOutput=Join-Path $structureRoot 'native-edited.docx';$structureMetadata=Join-Path $structureRoot 'native-edits.json'
if(-not(Test-Path -LiteralPath $structureRoot -PathType Container) -or (Test-Path -LiteralPath $structureOutput) -or (Test-Path -LiteralPath $structureMetadata)){throw 'Use a fresh output directory'}
function SourceHash {
 $stream=[IO.File]::Open($structureSource,'Open','Read','ReadWrite');$hash=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant()} finally {$hash.Dispose();$stream.Dispose()}
}
$before=SourceHash;if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
$structureDocument=[Runtime.InteropServices.Marshal]::BindToMoniker($structureSource)
try {
 if($structureDocument.FullName -ne $structureSource -or -not $structureDocument.Saved -or $structureDocument.ReadOnly -or $structureDocument.Shapes.Count -ne 2 -or $structureDocument.Paragraphs.Count -ne 5){throw 'Wrong owned document/state'}
 $standalone=$structureDocument.Shapes.Item(1);$group=$structureDocument.Shapes.Item(2)
 if($standalone.Name -ne 'Drawing 1' -or $group.Type -ne 6 -or $group.GroupItems.Count -ne 2){throw 'Wrong shapes'}
 $frames=@($standalone,$group.GroupItems.Item(1),$group.GroupItems.Item(2));$observed=@()
 for($i=0;$i -lt 3;$i++){
  $range=$frames[$i].TextFrame.TextRange
  $observed+=@{before=$range.Text;tablesBefore=$range.Tables.Count;controlsBefore=@($range.ContentControls | ForEach-Object {@{tag=$_.Tag;id=$_.ID;placeholder=$_.ShowingPlaceholderText;temporary=$_.Temporary}})}
 }
 if(($observed[0].controlsBefore.tag -join ',') -ne 'temp-table,persistent-table' -or $observed[1].controlsBefore.Count -ne 0 -or ($observed[2].controlsBefore.tag -join ',') -ne 'temp-frame'){throw 'Wrong controls'}
 foreach($edit in @(@{index=0;find='First cell';replacement='Edited cell'},@{index=0;find='Prompt A';replacement='Filled prompt'},@{index=0;find='Persistent A';replacement='Kept value'},@{index=0;find='Nested two';replacement='Nested edited'},@{index=1;find='Group cell';replacement='Group edited'},@{index=2;find='Prompt B';replacement='Filled frame'})){
  $range=$frames[$edit.index].TextFrame.TextRange.Duplicate
  try {
   $find=$range.Find;$find.ClearFormatting();$find.Text=$edit.find;$find.Forward=$true;$find.Wrap=0;$find.Format=$false;$find.MatchCase=$true;$find.MatchWildcards=$false
   if(-not $find.Execute() -or $range.Text -ne $edit.find){throw 'Exact owned text not found'}
   $range.Text=$edit.replacement
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
 }
 for($i=0;$i -lt 3;$i++){
  $range=$frames[$i].TextFrame.TextRange
  $observed[$i].after=$range.Text;$observed[$i].tablesAfter=$range.Tables.Count
  $observed[$i].controlsAfter=@($range.ContentControls | ForEach-Object {@{tag=$_.Tag;id=$_.ID;placeholder=$_.ShowingPlaceholderText;temporary=$_.Temporary}})
 }
 if($observed[0].controlsAfter.Count -ne 1 -or $observed[0].controlsAfter[0].tag -ne 'persistent-table' -or $observed[0].controlsAfter[0].placeholder -or $observed[2].controlsAfter.Count -ne 0){throw 'Unexpected native wrapper lifetime'}
 $structureDocument.SaveAs2([string]$structureOutput,16)
 if($structureDocument.FullName -ne $structureOutput -or -not $structureDocument.Saved -or (SourceHash) -ne $before){throw 'Saved reference/source mismatch'}
 @{scope='Native detached edits in owned standalone/grouped WPS tables and controls, source unchanged; not transformed pointer evidence';sourceSha256=$before;sourceUnchanged=$true;referenceBuild=$structureDocument.Application.Build;frames=$observed} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $structureMetadata -Encoding utf8
 Write-Output 'Saved native drawing table/control edits; original unchanged'
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($structureDocument)}
