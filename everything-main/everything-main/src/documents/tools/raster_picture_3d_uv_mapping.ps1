param(
 [Parameter(Mandatory)][string]$CaptureRoot,
 [Parameter(Mandatory)][string]$OutputRoot,
 [ValidateSet("Default","Half")][string]$PixelMode="Default"
)
# Play the hash-bound native EMF+ stream, not its reduced-color GDI fallback.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$capturePath=[IO.Path]::GetFullPath($CaptureRoot)
$outputPath=[IO.Path]::GetFullPath($OutputRoot)
$capture=Get-Content -LiteralPath (Join-Path $capturePath 'capture.json') -Raw | ConvertFrom-Json
if(-not $capture.sourceUnchanged -or -not $capture.savedBefore -or -not $capture.savedAfter -or $capture.captures.Count -notin @(1,5)){throw 'Unverified native capture'}
if(Test-Path -LiteralPath $outputPath){throw 'Choose a fresh raster directory'}
[void](New-Item -ItemType Directory -Path $outputPath)
foreach($entry in $capture.captures){
 $file='page-'+$entry.page+'.emf'
 if($entry.file -ne $file -or $entry.widthPt -ne 612 -or $entry.heightPt -ne 792){throw 'Unexpected page geometry'}
 $path=Join-Path $capturePath $file
 if((Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Native capture hash mismatch'}
 $image=[Drawing.Imaging.Metafile]::new($path)
 try{
  if($image.GetMetafileHeader().Type -ne [Drawing.Imaging.MetafileType]::EmfPlusDual){throw 'Expected EMF+ dual stream'}
  $bitmap=[Drawing.Bitmap]::new(2448,3168)
  try{
   $graphics=[Drawing.Graphics]::FromImage($bitmap)
   try{
    $graphics.Clear([Drawing.Color]::White)
    $graphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::$PixelMode
    # Page API 612 x 792pt and verified logical window 5100 x 6600, avoiding
    # the rounded physical millimetre frame. Recorder rechecks this mapping.
    $graphics.DrawImage($image,[Drawing.RectangleF]::new(0,0,2448,3168),[Drawing.RectangleF]::new(0,0,5100,6600),[Drawing.GraphicsUnit]::Pixel)
    $bitmap.Save((Join-Path $outputPath ($PixelMode.ToLowerInvariant()+'-'+$entry.page+'.png')),[Drawing.Imaging.ImageFormat]::Png)
   }finally{$graphics.Dispose()}
  }finally{$bitmap.Dispose()}
 }finally{$image.Dispose()}
 Write-Output ('Rasterized page '+$entry.page)
}
