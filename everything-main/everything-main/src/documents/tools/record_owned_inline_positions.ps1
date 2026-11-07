# Read-only native inline-marker observations, bound to a visible owned copy.
param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][int]$ExpectedHwnd,[Parameter(Mandatory=$true)][ValidateRange(1,64)][int]$ExpectedCount)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $Source).Path
if(Test-Path -LiteralPath $Output){throw 'Fresh output required'}
function OwnedHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$algorithm=[Security.Cryptography.SHA256]::Create()
 try{([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$algorithm.Dispose();$stream.Dispose()}
}
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $source
try{
 if((OwnedHash) -ne $ExpectedSha256.ToLowerInvariant() -or -not $doc.Saved -or -not $doc.Application.Visible -or $doc.ActiveWindow.Hwnd -ne $ExpectedHwnd){throw 'Source/window/Saved guard failed'}
 if($doc.InlineShapes.Count -ne $ExpectedCount){throw 'Unexpected inline marker count'}
 $markers=@()
 for($i=1;$i -le $ExpectedCount;$i++){
  $shape=$doc.InlineShapes.Item($i);$range=$shape.Range
  $x=[double]$range.Information(5);$repeat=[double]$range.Information(5)
  if($x -lt 0 -or $x -ne $repeat){throw 'Marker is not laid out or repeated position differs'}
  $markers+=@{index=$i;xPt=$x;widthPt=$shape.Width;heightPt=$shape.Height;repeatIdentical=$true}
 }
 if((OwnedHash) -ne $ExpectedSha256.ToLowerInvariant() -or -not $doc.Saved){throw 'Source state changed'}
 $record=@{sourceSha256=$ExpectedSha256.ToLowerInvariant();sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;observedHwnd=$doc.ActiveWindow.Hwnd;markers=$markers;method='Already-opened visible owned source; InlineShape.Range.Information(wdHorizontalPositionRelativeToPage), repeated numeric observations. No font-file, glyph-outline, source-save, repagination or view calls.'}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),($record | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
