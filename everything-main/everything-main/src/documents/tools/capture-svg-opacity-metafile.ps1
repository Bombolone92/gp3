param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256,
 [int]$PictureIndex=1
)
# Read-only native picture capture: no reference application view, selection or UI changes.
# Confirm an owned scratch copy with the document-opening helper before invoking.
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($Source)
$root=[IO.Path]::GetFullPath($OutputRoot)
function SourceHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $sha=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally { $sha.Dispose();$stream.Dispose() }
}
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $PictureIndex -lt 1 -or !(Test-Path -LiteralPath $root -PathType Container)) {throw 'Invalid capture bounds'}
if((SourceHash) -ne $ExpectedSha256.ToLowerInvariant()) {throw 'Source differs'}
$before=@(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
$word=New-Object -ComObject Word.Application
$owned=@(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $before } | ForEach-Object Id)
$document=$null
try {
 $document=$word.Documents.Open($source,$false,$true)
 if($document.FullName -ne $source -or !$document.ReadOnly -or !$document.Saved) {throw 'Wrong source or state'}

 [byte[]]$bytes=$document.InlineShapes.Item($PictureIndex).Range.EnhMetaFileBits
 $path=Join-Path $root 'capture.emf'
 [IO.File]::WriteAllBytes($path,$bytes)
 if((SourceHash) -ne $ExpectedSha256.ToLowerInvariant()) {throw 'Source changed'}
 @{sourceSha256=(SourceHash);sourceUnchanged=$true;readOnly=$document.ReadOnly;savedAfter=$document.Saved;referenceBuild=$word.Build;pictureIndex=$PictureIndex;captureSha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();newProcessCandidates=$owned} |
 ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'capture.json') -Encoding UTF8
 Write-Output ('Captured exact source; reference build '+$word.Build+'; owned process candidates '+($owned -join ','))
} finally {
 if($document -and $document.FullName -eq $source) {$document.Close([ref]0)}
 if($owned.Count -eq 1) {$word.Quit([ref]0)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
