param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256,
 [int]$PictureIndex=1
)
# Run Open-OfficeDocument.ps1 for this exact owned copy first. Read-only API
# operations on the existing document: no open/save, UI setters, close or Quit.
$ErrorActionPreference='Stop'
$taskSource=[IO.Path]::GetFullPath($Source)
$taskRoot=[IO.Path]::GetFullPath($OutputRoot)
function SourceHash {
 $taskStream=[IO.File]::Open($taskSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $taskHasher=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant() }
 finally { $taskHasher.Dispose();$taskStream.Dispose() }
}
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $PictureIndex -lt 1){throw 'Invalid capture bounds'}
if((SourceHash) -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
if(Test-Path -LiteralPath $taskRoot){throw 'Choose a fresh capture directory'}
$taskDocument=[Runtime.InteropServices.Marshal]::BindToMoniker($taskSource)
try {
 if($taskDocument.FullName -ne $taskSource -or !$taskDocument.Saved){throw 'Wrong source or unsaved document'}
 if($taskDocument.InlineShapes.Count -lt $PictureIndex){throw 'Picture is absent'}
 [void](New-Item -ItemType Directory -Path $taskRoot)
 [byte[]]$taskBytes=$taskDocument.InlineShapes.Item($PictureIndex).Range.EnhMetaFileBits
 $taskPath=Join-Path $taskRoot 'capture.emf'
 [IO.File]::WriteAllBytes($taskPath,$taskBytes)
 if(!$taskDocument.Saved -or (SourceHash) -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source changed'}
 @{sourceSha256=(SourceHash);sourceUnchanged=$true;captureReadOnly=$true;savedBefore=$true;
   readOnly=$taskDocument.ReadOnly;savedAfter=$taskDocument.Saved;referenceBuild=$taskDocument.Application.Build;
   pictureIndex=$PictureIndex;captureSha256=(Get-FileHash -LiteralPath $taskPath).Hash.ToLowerInvariant()} |
  ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskRoot 'capture.json') -Encoding UTF8
 Write-Output 'Captured the exact helper-opened picture; source unchanged'
} finally {
 if([Runtime.InteropServices.Marshal]::IsComObject($taskDocument)){
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($taskDocument)
 }
}
