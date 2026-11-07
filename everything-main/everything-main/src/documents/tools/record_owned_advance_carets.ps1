# Numeric observations only: the independently authored repeated-letter control.
param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Output,
 [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256,
 [Parameter(Mandatory=$true)][int]$ExpectedHwnd)
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
 if((OwnedHash) -ne $ExpectedSha256.ToLowerInvariant() -or -not $doc.Saved -or -not $doc.Application.Visible -or $doc.ActiveWindow.Hwnd -ne $ExpectedHwnd){throw 'Source/Visible/Saved/window guard failed'}
 if($doc.Paragraphs.Count -ne 8){throw 'Wrong control paragraph count'}
 $rows=@()
 for($i=1;$i -le 8;$i++){
  $range=$doc.Paragraphs.Item($i).Range;$text=$range.Text.TrimEnd([char]13)
  if($text -cne 'EEEEEEEEEEEE'){throw 'Outside independently authored control'}
  $carets=@()
  for($j=0;$j -le $text.Length;$j++){
   $caret=$range.Duplicate;$caret.SetRange($range.Start+$j,$range.Start+$j)
   $x=[double]$caret.Information(5);$repeat=[double]$caret.Information(5);$y=[double]$caret.Information(6)
   if($x -lt 0 -or $y -lt 0 -or $x -ne $repeat){throw 'Caret unavailable or unstable'}
   $carets+=@{index=$j;xPt=$x;yPt=$y}
  }
  $rows+=@{text=$text;family=$range.Font.Name;sizePt=$range.Font.Size;bold=$range.Font.Bold;spacingPt=$range.Font.Spacing;kerningPt=$range.Font.Kerning;carets=$carets}
 }
 if((OwnedHash) -ne $ExpectedSha256.ToLowerInvariant() -or -not $doc.Saved -or $doc.ActiveWindow.Hwnd -ne $ExpectedHwnd){throw 'Source/window changed'}
 $record=@{sourceSha256=$ExpectedSha256.ToLowerInvariant();sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;observedHwnd=$ExpectedHwnd;rows=$rows;method='Exact already-open visible independent control; repeated collapsed Range.Information(5/6). Screen positions have 0.75-point resolution. No font programs, edits, save, repagination or view calls.'}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($Output),($record | ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
