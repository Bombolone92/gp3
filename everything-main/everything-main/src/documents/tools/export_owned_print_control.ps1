# Export an exact, already-opened scratch copy. Never save or quit the reference application.
param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$OutputRoot,[Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256,[switch]$CloseOwnedDocument)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'export_owned_native_pdf.ps1')
$source=(Resolve-Path -LiteralPath $Source).Path
$root=[IO.Path]::GetFullPath($OutputRoot)
[void][IO.Directory]::CreateDirectory($root)
function SourceHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try{([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally{$algorithm.Dispose();$stream.Dispose()}
}
if ((SourceHash) -ne $ExpectedSha256.ToLowerInvariant()){throw 'Wrong native control copy'}
$word=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
$doc=$null
try {
 foreach($candidate in $word.Documents){
  if([string]::Equals($candidate.FullName,$source,[StringComparison]::OrdinalIgnoreCase)){$doc=$candidate;break}
 }
 if(-not $doc){throw 'The exact control is not open in the active reference application; use the document opener first. No document was opened implicitly.'}
 if ($doc.FullName -ne $source){throw 'Wrong open native control'}
 if(-not $word.Visible -or -not $doc.ActiveWindow.Visible){throw 'The exact control is open in a hidden reference automation instance. Open it in a visible reference window before capture; no export was attempted.'}
 $before=$doc.Saved
 Write-Output 'Exporting the exact already-opened native control'
 [OwnedWordPdfExport]::Export($doc,(Join-Path $root 'native.pdf'))
 if ((SourceHash) -ne $ExpectedSha256.ToLowerInvariant()){throw 'Native export changed source bytes'}
 @{sourceSha256=$ExpectedSha256.ToLowerInvariant();sourceUnchanged=$true;savedBefore=$before;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;method='Read-only fixed-format export of already-opened exact owned control; no source save or application UI changes'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'native-state.json') -Encoding UTF8
 Write-Output 'Exported native print control with unchanged source bytes'
}finally{
 if ($CloseOwnedDocument -and $doc -and $doc.FullName -eq $source){$doc.Close([ref]0)}
 if($doc){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
