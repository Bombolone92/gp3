param(
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256
)
# Observe only the exact already-opened visible owned control. No open/save/quit.
$ErrorActionPreference='Stop'
$taskSource=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public/fixtures/svg-disabled-shapes.docx'))
$taskRoot=[IO.Path]::GetFullPath($OutputRoot)
if(Test-Path -LiteralPath $taskRoot){throw 'Use a fresh capture directory'}
function SourceHash{
 $stream=[IO.File]::Open($taskSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try{([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally{$algorithm.Dispose();$stream.Dispose()}
}
$expected=$ExpectedSha256.ToLowerInvariant()
if((SourceHash) -ne $expected){throw 'Wrong source bytes'}
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $taskSource
try{
 if(-not $doc.Saved -or -not $doc.Application.Visible -or -not $doc.ActiveWindow.Visible){throw 'Control must be visible and Saved'}
 if($doc.InlineShapes.Count -lt 1){throw 'No inline picture to observe'}
 [byte[]]$bytes=$doc.InlineShapes.Item(1).Range.EnhMetaFileBits
 if((SourceHash) -ne $expected -or -not $doc.Saved){throw 'Source changed'}
 [void][IO.Directory]::CreateDirectory($taskRoot)
 $capture=Join-Path $taskRoot 'capture.emf'
 [IO.File]::WriteAllBytes($capture,$bytes)
 @{sourceSha256=$expected;captureSha256=(Get-FileHash -LiteralPath $capture).Hash.ToLowerInvariant();
   sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;captureReadOnly=$true;
   readOnly=$doc.ReadOnly;referenceBuild=$doc.Application.Build;pictureIndex=1;
   method='Read-only first inline range metafile observation of exact visible Saved owned source; no open/save/quit'} |
   ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'capture.json') -Encoding utf8
 Write-Output 'Captured exact native SVG control; source unchanged'
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
