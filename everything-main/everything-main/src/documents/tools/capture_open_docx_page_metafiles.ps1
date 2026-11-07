param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256,
 [Parameter(Mandatory)][int]$ExpectedPages,
 [Parameter(Mandatory)][int]$ExpectedParagraphs,
 [Parameter(Mandatory)][double]$WidthPt,
 [Parameter(Mandatory)][double]$HeightPt
)
# Run the document-opening helper first on an owned scratch copy. Observe that
# exact open document without opening another instance, changing UI or saving.
# Writable copies are allowed, but Saved and the source hash must stay unchanged.
$ErrorActionPreference='Stop'
$captureSource=[IO.Path]::GetFullPath($Source)
$captureRoot=[IO.Path]::GetFullPath($OutputRoot)
if($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $ExpectedPages -lt 1 -or $ExpectedParagraphs -lt 1 -or $WidthPt -le 0 -or $HeightPt -le 0){throw 'Invalid capture bounds'}
if(-not(Test-Path -LiteralPath $captureRoot -PathType Container)){throw 'Create a fresh capture directory first'}
if(Test-Path -LiteralPath (Join-Path $captureRoot 'page-capture.json')){throw 'Capture metadata already exists'}
function SourceHash {
 $stream=[IO.File]::Open($captureSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $hash=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally {$hash.Dispose();$stream.Dispose()}
}
$before=SourceHash
if($before -ne $ExpectedSha256.ToLowerInvariant()){throw 'Source differs'}
$doc=[Runtime.InteropServices.Marshal]::BindToMoniker($captureSource)
try {
 if($doc.FullName -ne $captureSource -or -not $doc.Saved -or $doc.Paragraphs.Count -ne $ExpectedParagraphs){throw 'Wrong source/state'}
 $pages=$doc.ActiveWindow.Panes.Item(1).Pages
 if($pages.Count -ne $ExpectedPages){throw 'Page count differs'}
 $captures=@()
 for($i=1;$i -le $ExpectedPages;$i++){
  $page=$pages.Item($i)
  if($page.Width -ne $WidthPt -or $page.Height -ne $HeightPt){throw 'Page geometry differs'}
  $name='page-'+$i+'.emf';$path=Join-Path $captureRoot $name
  if(Test-Path -LiteralPath $path){throw 'Page capture already exists'}
  $bits=[byte[]]$page.EnhMetaFileBits;[IO.File]::WriteAllBytes($path,$bits)
  $captures+=@{page=$i;file=$name;length=$bits.Length;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();widthPt=$WidthPt;heightPt=$HeightPt}
 }
 if((SourceHash) -ne $before -or -not $doc.Saved){throw 'Capture mutated document'}
 @{sourceSha256=$before;sourceUnchanged=$true;readOnly=$doc.ReadOnly;savedBefore=$true;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;captures=$captures;scope='Read-only observation of exact helper-opened document; no source save or UI mutation'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $captureRoot 'page-capture.json') -Encoding utf8
 Write-Output ('Captured '+$ExpectedPages+' native pages; source unchanged and Saved true')
} finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc) }
