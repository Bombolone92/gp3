param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$OutputRoot
)
# Confirm this exact owned scratch copy with Open-OfficeDocument.ps1 first.
# Reads the existing document/page API only; no view/UI setters or font data.
# Does not close documents or quit the reference application. Only metadata and page EMFs are saved.
$ErrorActionPreference='Stop'
$sourcePath=[IO.Path]::GetFullPath($Source)
$captureRoot=[IO.Path]::GetFullPath($OutputRoot)
$fixture=Join-Path $PSScriptRoot '../tests/fixtures/picture-3d-textures/control.docx'
$fixtureStream=[IO.File]::Open($fixture,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$fixtureHasher=[Security.Cryptography.SHA256]::Create()
try{$expected=([BitConverter]::ToString($fixtureHasher.ComputeHash($fixtureStream))).Replace('-','').ToLowerInvariant()}
finally{$fixtureHasher.Dispose();$fixtureStream.Dispose()}
$expectedPages=8
function SourceHash {
 $s=[IO.File]::Open($sourcePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $a=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($a.ComputeHash($s))).Replace('-','').ToLowerInvariant() }
 finally { $a.Dispose();$s.Dispose() }
}
if((SourceHash) -ne $expected){throw 'Source differs from the authored control'}
if(Test-Path -LiteralPath $captureRoot){throw 'Choose a fresh capture directory'}
[void](New-Item -ItemType Directory -Path $captureRoot)
$doc=[Runtime.InteropServices.Marshal]::BindToMoniker($sourcePath)
try {
 if($doc.FullName -ne $sourcePath -or -not $doc.Saved){throw 'Wrong source or unsaved document'}
 $pages=$doc.ActiveWindow.Panes.Item(1).Pages
 if($pages.Count -ne $expectedPages){throw "Unexpected page count $($pages.Count)"}
 $captures=@()
 for($i=1;$i -le $pages.Count;$i++){
  $page=$pages.Item($i)
  if($page.Width -ne 612 -or $page.Height -ne 792){throw 'Unexpected physical page'}
  $bits=[byte[]]$page.EnhMetaFileBits
  $name='page-'+$i+'.emf';$path=Join-Path $captureRoot $name
  [IO.File]::WriteAllBytes($path,$bits)
  $captures+=@{page=$i;file=$name;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant();length=$bits.Length;widthPt=$page.Width;heightPt=$page.Height}
  Write-Output "Captured page $i"
 }
 if(-not $doc.Saved -or (SourceHash) -ne $expected){throw 'Source changed during capture'}
 @{sourceSha256=$expected;sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;readOnly=$doc.ReadOnly;referenceBuild=$doc.Application.Build;captures=$captures} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $captureRoot 'capture.json') -Encoding UTF8
}finally{if([Runtime.InteropServices.Marshal]::IsComObject($doc)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}}
