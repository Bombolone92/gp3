param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$Cases,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256
)
# Observe an exact already-opened visible control; never open, save or quit the reference application.
# Use Open-OfficeDocument.ps1 and confirm the owned control is visible first.
$ErrorActionPreference='Stop'
$captureSource=(Resolve-Path -LiteralPath $Source).Path
$captureRoot=[IO.Path]::GetFullPath($OutputRoot)
$casePath=(Resolve-Path -LiteralPath $Cases).Path
$expected=$ExpectedSha256.ToLowerInvariant()
function SourceHash {
 $stream=[IO.File]::Open($captureSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$algorithm.Dispose();$stream.Dispose()}
}
if((SourceHash) -ne $expected){throw 'Wrong source bytes'}
$caseList=Get-Content -LiteralPath $casePath -Raw | ConvertFrom-Json
if(-not $caseList.Count){throw 'No page cases'}
if(Test-Path -LiteralPath $captureRoot){throw 'Use a fresh capture directory'}
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $captureSource
try {
 if(-not $doc.Saved -or -not $doc.Application.Visible -or -not $doc.ActiveWindow.Visible){throw 'Control must be visible and Saved'}
 $pages=$doc.ActiveWindow.Panes.Item(1).Pages
 if($pages.Count -ne $caseList.Count){throw "Wrong page count $($pages.Count)"}
 [void][IO.Directory]::CreateDirectory($captureRoot)
 $metadata=@()
 for($i=1;$i -le $caseList.Count;$i++){
  $page=$pages.Item($i)
  $case=$caseList[$i-1]
  if($page.Width -ne $case.pageWidthPt -or $page.Height -ne $case.pageHeightPt){throw "Wrong page geometry $i"}
  $file=Join-Path $captureRoot "page-$i.emf"
  [IO.File]::WriteAllBytes($file,[byte[]]$page.EnhMetaFileBits)
  $metadata+=@{page=$i;widthPt=$page.Width;heightPt=$page.Height;sha256=(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
 }
 if((SourceHash) -ne $expected -or -not $doc.Saved){throw 'Source changed'}
 @{sourceSha256=$expected;sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;pages=$metadata;method='Read-only page-metafile observation of exact already-opened visible owned source; no source save or UI changes'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $captureRoot 'metadata.json') -Encoding utf8
 Write-Output "Captured $($pages.Count) exact native page metafiles; source unchanged"
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
