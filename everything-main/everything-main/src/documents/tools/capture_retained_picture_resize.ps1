# Read an exact helper-opened, textless authored picture control through the ROT.
# No opening, saving, closing, selection, UI setters, PDF export or font-program access.
# Shapes collections need not follow source order: match floating pictures by name.
param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$OutputRoot,[Parameter(Mandatory)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$ownedSource=(Resolve-Path -LiteralPath $Source).Path
$ownedOutput=[IO.Path]::GetFullPath($OutputRoot)
if(Test-Path -LiteralPath $ownedOutput){throw 'Capture needs a fresh directory'}
function Hash-Source {
 $stream=[IO.File]::Open($ownedSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);$hash=[Security.Cryptography.SHA256]::Create()
 try { ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }finally{$hash.Dispose();$stream.Dispose()}
}
if((Hash-Source) -ne $ExpectedSha256){throw 'Wrong owned source'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageStream=[IO.File]::Open($ownedSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$package=[IO.Compression.ZipArchive]::new($packageStream,[IO.Compression.ZipArchiveMode]::Read,$false)
try { $reader=[IO.StreamReader]::new($package.GetEntry('word/document.xml').Open());try{$xml=[xml]$reader.ReadToEnd()}finally{$reader.Dispose()} }finally{$package.Dispose()}
$ns=[Xml.XmlNamespaceManager]::new($xml.NameTable);$ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main');$ns.AddNamespace('wp','http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing');$ns.AddNamespace('a','http://schemas.openxmlformats.org/drawingml/2006/main')
if($xml.SelectNodes('//w:t',$ns).Count){throw 'Use a textless authored control'}
$frames=$xml.SelectNodes('//wp:anchor | //wp:inline',$ns)
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $ownedSource
try {
 $savedBefore=[bool]$doc.Saved;$pageCount=$doc.ComputeStatistics(2)
 if($pageCount -ne $frames.Count -or $doc.Shapes.Count+$doc.InlineShapes.Count -ne $frames.Count){throw 'Wrong native page/picture counts'}
 $viewBefore=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 $native=@();$floatingIndex=0;$inlineIndex=0
 foreach($frame in $frames){
  $metadata=$frame.SelectSingleNode('wp:docPr',$ns);$extent=$frame.SelectSingleNode('wp:extent',$ns)
  $isInline=$frame.LocalName -eq 'inline'
  $shape=if($isInline){$inlineIndex++;$doc.InlineShapes.Item($inlineIndex)}else{$floatingIndex++;$doc.Shapes.Item([string]$metadata.name)}
  try {
   $range=if($isInline){$shape.Range}else{$shape.Anchor}
   try {$page=[int]$range.Information(3)}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
   if($page -ne [int]$metadata.id){throw 'Wrong native picture page identity'}
   if(-not $isInline -and $shape.Name -ne $metadata.name){throw 'Wrong native picture name'}
   $physical=@{}
   if($frame.SelectSingleNode('.//a:ln[@w]',$ns)){$physical.outlineWidthPt=[double]$shape.Line.Weight}
   if($frame.SelectSingleNode('.//a:outerShdw',$ns)){$physical.shadowBlurPt=[double]$shape.Shadow.Blur;$physical.shadowOffsetXPt=[double]$shape.Shadow.OffsetX;$physical.shadowOffsetYPt=[double]$shape.Shadow.OffsetY}
   if($frame.SelectSingleNode('.//a:sp3d',$ns)){$physical.extrusionDepthPt=[double]$shape.ThreeD.Depth}
   $native+=@{physical=$physical;id=[int]$metadata.id;inline=$isInline;page=$page;widthPt=[double]$shape.Width;heightPt=[double]$shape.Height;lockAspectRatio=[int]$shape.LockAspectRatio;sourceWidthPt=[long]$extent.cx/12700;sourceHeightPt=[long]$extent.cy/12700;name=[string]$metadata.name}
  }finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shape)}
 }
 [void][IO.Directory]::CreateDirectory($ownedOutput);$captures=@()
 for($i=1;$i -le $pageCount;$i++){
  $start=$doc.GoTo(1,1,$i).Start;$end=if($i -eq $pageCount){$doc.Content.End}else{$doc.GoTo(1,1,($i+1)).Start}
  $range=$doc.Range($start,$end-1)
  try {$bits=[byte[]]$range.EnhMetaFileBits;$file="page-$i.emf";$path=Join-Path $ownedOutput $file;[IO.File]::WriteAllBytes($path,$bits);$captures+=@{page=$i;file=$file;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()};Write-Output "Captured owned picture page $i"}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($range)}
 }
 if((Hash-Source) -ne $ExpectedSha256 -or [bool]$doc.Saved -ne $savedBefore){throw 'Source or Saved state changed'}
 $viewAfter=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 if($viewBefore.type -ne $viewAfter.type -or $viewBefore.zoomPercent -ne $viewAfter.zoomPercent){throw 'View changed'}
 @{sourceSha256=$ExpectedSha256;sourceUnchanged=$true;savedBefore=$savedBefore;savedAfter=[bool]$doc.Saved;referenceBuild=$doc.Application.Build;native=$native;captures=$captures;viewBefore=$viewBefore;viewAfter=$viewAfter;scope='Textless authored picture metadata and page-range metafiles; not screen/PDF or whole-template certification'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $ownedOutput 'capture.json') -Encoding utf8
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
