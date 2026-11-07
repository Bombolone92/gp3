param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$Cases,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
 [switch]$IncludePdf
)
# Exact already-open visible owned control. Read ranges; never select, save,
# open/close a document, quit the reference application, or read font programs.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'export_owned_native_pdf.ps1')
$shadowSource=(Resolve-Path -LiteralPath $Source).Path
$shadowCases=(Resolve-Path -LiteralPath $Cases).Path
$shadowOutput=[IO.Path]::GetFullPath($OutputRoot)
function SourceHash {
 $stream=[IO.File]::Open($shadowSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$algorithm.Dispose();$stream.Dispose()}
}
$expected=$ExpectedSha256.ToLowerInvariant()
if((SourceHash) -ne $expected){throw 'Wrong source bytes'}
if(Test-Path -LiteralPath $shadowOutput){throw 'Use a fresh capture directory'}
$caseList=Get-Content -LiteralPath $shadowCases -Raw | ConvertFrom-Json
if(-not $caseList.Count){throw 'No shadow cases'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceStream=[IO.File]::Open($shadowSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$package=[IO.Compression.ZipArchive]::new($sourceStream,[IO.Compression.ZipArchiveMode]::Read,$true)
try {
 $reader=[IO.StreamReader]::new($package.GetEntry('word/document.xml').Open())
 try {$xml=[xml]$reader.ReadToEnd()} finally {$reader.Dispose()}
 $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable)
 $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
 $ns.AddNamespace('wp','http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing')
 $ns.AddNamespace('a','http://schemas.openxmlformats.org/drawingml/2006/main')
 if($xml.SelectNodes('//w:t',$ns).Count){throw 'Use a textless authored control'}
 $anchors=$xml.SelectNodes('//wp:anchor',$ns)
 if($anchors.Count -ne $caseList.Count){throw 'Wrong authored anchor count'}
 for($i=0;$i -lt $caseList.Count;$i++){
  $extent=$anchors[$i].SelectSingleNode('wp:extent',$ns)
  $shadow=$anchors[$i].SelectSingleNode('.//a:outerShdw',$ns)
  if([long]$extent.cx -ne [Math]::Round($caseList[$i].widthPt*12700) -or [long]$extent.cy -ne [Math]::Round($caseList[$i].heightPt*12700) -or [long]$shadow.blurRad -ne [Math]::Round($caseList[$i].blurPt*12700)){throw 'Wrong authored effect extent'}
 }
} finally {$package.Dispose();$sourceStream.Dispose()}
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $shadowSource
try {
 if(-not $doc.Application.Visible -or -not $doc.ActiveWindow.Visible){throw 'Owned control must be visible'}
 # The reference application can mark an authored compatibility control dirty while normalizing its
 # import. Keep that state explicit; never save it or pretend it was pristine.
 $savedBefore=[bool]$doc.Saved
 if($doc.Shapes.Count -ne $caseList.Count){throw 'Expected one floating picture per case'}
 $pages=$doc.ComputeStatistics(2)
 if($pages -ne $caseList.Count){throw 'Expected one native page per case'}
 # Source extents were checked above. Native API widths may be twip-quantized;
 # record them independently instead of claiming that they are painted bounds.
 $nativeShapes=@()
 for($i=1;$i -le $caseList.Count;$i++){
  $shape=$doc.Shapes.Item($i)
  try {
   if([int]$shape.Anchor.Information(3) -ne $i){throw 'Wrong shape page'}
   if($shape.Name -ne $caseList[$i-1].name){throw 'Wrong native picture identity'}
   $nativeShapes+=@{page=$i;name=$shape.Name;widthPt=[double]$shape.Width;heightPt=[double]$shape.Height}
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape)}
 }
 $viewBefore=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 [void][IO.Directory]::CreateDirectory($shadowOutput)
 $captures=@()
 for($i=1;$i -le $pages;$i++){
  $start=$doc.GoTo(1,1,$i).Start
  $end=if($i -eq $pages){$doc.Content.End}else{$doc.GoTo(1,1,($i+1)).Start}
  $range=$doc.Range($start,($end-1))
  try {
   $path=Join-Path $shadowOutput ("page-$i.emf")
   $bytes=[byte[]]$range.EnhMetaFileBits
   $file=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
   try {$file.Write($bytes,0,$bytes.Length)} finally {$file.Dispose()}
   $captures+=@{page=$i;file="page-$i.emf";sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
   Write-Output "Captured native shadow grid page $i"
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
 }
 $pdfHash=$null
 if($IncludePdf){
  $pdfPath=Join-Path $shadowOutput 'native.pdf'
  if(Test-Path -LiteralPath $pdfPath){throw 'PDF destination already exists'}
  [OwnedWordPdfExport]::Export($doc,$pdfPath)
  $pdfHash=(Get-FileHash -LiteralPath $pdfPath).Hash.ToLowerInvariant()
 }
 if((SourceHash) -ne $expected -or [bool]$doc.Saved -ne $savedBefore){throw 'Source bytes or saved state changed'}
 for($i=1;$i -le $caseList.Count;$i++){
  $shape=$doc.Shapes.Item($i)
  try {
   $before=$nativeShapes[$i-1]
   if($shape.Name -ne $before.name -or [double]$shape.Width -ne $before.widthPt -or [double]$shape.Height -ne $before.heightPt -or [int]$shape.Anchor.Information(3) -ne $i){throw 'Native picture state changed'}
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape)}
 }
 $viewAfter=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 if($viewBefore.type -ne $viewAfter.type -or $viewBefore.zoomPercent -ne $viewAfter.zoomPercent){throw 'View changed'}
 @{sourceSha256=$expected;casesSha256=(Get-FileHash -LiteralPath $shadowCases).Hash.ToLowerInvariant();
   sourceUnchanged=$true;referenceBuild=$doc.Application.Build;pages=$pages;viewBefore=$viewBefore;viewAfter=$viewAfter;
   savedBefore=$savedBefore;savedAfter=$doc.Saved;captures=$captures;nativeShapeProperties=$nativeShapes;pdfSha256=$pdfHash;
   scope='Textless authored picture-shadow native page metafiles; not screen or PDF certification'} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $shadowOutput 'capture.json') -Encoding utf8
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
