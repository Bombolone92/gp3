# Read-only observation of an already opened owned control copy. No UI changes.
param(
 [Parameter(Mandatory=$true)][string]$Source,
 [Parameter(Mandatory=$true)][string]$OutputRoot,
 [ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256='1fa3a9e2e8141c6cd4733975d88ee57e7c05c7e52d3e941ce10a7fd2f6aa5ce2',
 [switch]$CloseOwnedDocument
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $Source).Path
$root=[IO.Path]::GetFullPath($OutputRoot)
$expected=$ExpectedSha256.ToLowerInvariant()
[void][IO.Directory]::CreateDirectory($root)
function SourceHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try{([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally{$algorithm.Dispose();$stream.Dispose()}
}
if((SourceHash) -ne $expected){throw 'Wrong scratch control'}
$document=[Runtime.InteropServices.Marshal]::BindToMoniker($source)
try{
 if($document.FullName -ne $source -or -not $document.Saved){throw 'Wrong open control/state'}
 $savedBefore=$document.Saved
 $pages=$document.ActiveWindow.Panes.Item(1).Pages
 if($pages.Count -ne 1){throw 'Expected one native page'}
 $bits=[byte[]]$pages.Item(1).EnhMetaFileBits
 [IO.File]::WriteAllBytes((Join-Path $root 'page-1.emf'),$bits)
 $rows=@()
 for($i=1;$i -le $document.Paragraphs.Count;$i++){
  $range=$document.Paragraphs.Item($i).Range
  $text=$range.Text.TrimEnd([char]13)
  if(-not $text){continue}
  if($text -notmatch '^[\x20-\x7e]+$' -or $text.Length -gt 100){throw 'Outside authored ASCII control'}
  $start=$range.Start
  $carets=@()
  for($j=0;$j -le $text.Length;$j++){
   $caret=$range.Duplicate;$caret.SetRange($start+$j,$start+$j)
   $x=[double]$caret.Information(5);$y=[double]$caret.Information(6)
   if($x -lt 0 -or $y -lt 0){throw 'Native range is outside the visible screen; no coordinate inferred'}
   $carets+=@{index=$j;xPt=$x;yPt=$y}
  }
  $rows+=@{paragraph=$i;start=$start;text=$text;family=$range.Font.Name;sizePt=$range.Font.Size;kerningPt=$range.Font.Kerning;carets=$carets}
  Write-Output ('Captured paragraph '+$i+'; '+$carets.Count+' detached caret positions')
 }
 if($rows.Count -ne 4 -or (SourceHash) -ne $expected -or -not $document.Saved){throw 'Source/layout changed'}
 @{sourceSha256=$expected;sourceUnchanged=$true;savedBefore=$savedBefore;savedAfter=$document.Saved;referenceBuild=$document.Application.Build;zoom=$document.ActiveWindow.View.Zoom.Percentage;rows=$rows;nativePageSha256=(Get-FileHash -LiteralPath (Join-Path $root 'page-1.emf')).Hash.ToLowerInvariant();method='Detached collapsed Range.Information(5/6); no UI selection or edits'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'native-carets.json') -Encoding UTF8
}finally{
 if($CloseOwnedDocument -and $document -and $document.FullName -eq $source){$document.Close([ref]0)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)
}
