param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][string]$ExpectedSha256,
 [Parameter(Mandatory)][int]$ExpectedPages,
 [int]$ExpectedParagraphs=0,
 [Parameter(Mandatory)][double]$WidthPt,
 [Parameter(Mandatory)][double]$HeightPt,
 [string]$ExpectedFontFamily=''
)
# Read-only page picture capture. No screen/view changes or UI input.
# ExpectedFontFamily verifies availability only. Verify the painted font in the
# captured records separately; the reference application's font collection can list a substituted face.
# Open and confirm an owned scratch copy with the document-opening helper beforehand.
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($Source)
$captureRoot=[IO.Path]::GetFullPath($OutputRoot)
$expected=$ExpectedSha256.ToLowerInvariant()
if ($expected -notmatch '^[a-f0-9]{64}$' -or $ExpectedPages -lt 1 -or $WidthPt -le 0 -or $HeightPt -le 0) { throw 'Invalid capture bounds' }
if (-not (Test-Path -LiteralPath $captureRoot -PathType Container)) { throw 'Create a fresh capture directory first' }
function SourceHash {
 $stream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
 finally { $algorithm.Dispose();$stream.Dispose() }
}
if ((SourceHash) -ne $expected) { throw 'Source differs' }
$before=@(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
$captureWord=New-Object -ComObject Word.Application
$owned=@(Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $before } | ForEach-Object Id)
Write-Output ('New reference process candidates: '+($owned -join ','))
$document=$null
try {
 $availableFontFamily=''
 if($ExpectedFontFamily){
  $fontNames=$captureWord.FontNames
  try{
   for($fontIndex=1;$fontIndex -le $fontNames.Count;$fontIndex++){
    if($fontNames.Item($fontIndex) -eq $ExpectedFontFamily){$availableFontFamily=$ExpectedFontFamily;break}
   }
  }finally{if([Runtime.InteropServices.Marshal]::IsComObject($fontNames)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($fontNames)}}
  if(-not $availableFontFamily){throw 'Expected control face is absent from the capture instance font collection'}
  Write-Output ('Confirmed available control face: '+$availableFontFamily)
 }
 $document=$captureWord.Documents.Open($source,$false,$true)
 if ($document.FullName -ne $source -or -not $document.ReadOnly -or -not $document.Saved) { throw 'Wrong open source/state' }
 if ($ExpectedParagraphs -gt 0 -and $document.Paragraphs.Count -ne $ExpectedParagraphs) { throw 'Paragraph count differs' }
 Write-Output ('Confirmed source '+$document.FullName+'; reference build '+$captureWord.Build)
 $pages=$document.ActiveWindow.Panes.Item(1).Pages
 Write-Output ('Native pages: '+$pages.Count)
 if ($pages.Count -ne $ExpectedPages) { throw 'Native page count differs' }
 $captures=@()
 for ($index=1;$index -le $pages.Count;$index++) {
  $page=$pages.Item($index)
  if ($page.Width -ne $WidthPt -or $page.Height -ne $HeightPt) { throw 'Unexpected page geometry' }
  $bits=[byte[]]$page.EnhMetaFileBits
  $name='page-'+$index+'.emf'
  $output=Join-Path $captureRoot $name
  [IO.File]::WriteAllBytes($output,$bits)
  $captures+=@{page=$index;file=$name;sha256=(Get-FileHash -LiteralPath $output).Hash.ToLowerInvariant();length=$bits.Length;widthPt=$page.Width;heightPt=$page.Height}
  Write-Output ('Captured native page '+$index)
 }
 if ((SourceHash) -ne $expected) { throw 'Source changed' }
 @{sourceSha256=$expected;sourceUnchanged=$true;readOnly=$document.ReadOnly;savedAfter=$document.Saved;referenceBuild=$captureWord.Build;captures=$captures;newProcessCandidates=$owned;availableFontFamily=$availableFontFamily} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $captureRoot 'page-capture.json') -Encoding UTF8
} finally {
 if ($document -and $document.FullName -eq $source) { $document.Close([ref]0) }
 if ($owned.Count -eq 1) { $captureWord.Quit([ref]0) }
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($captureWord)
}
