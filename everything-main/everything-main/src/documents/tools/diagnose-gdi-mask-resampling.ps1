param([Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$OutputFolder)
# Native Windows probe for the original 128x480 grayscale image-mask controls.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskFolder=[IO.Path]::GetFullPath($OutputFolder)
[IO.Directory]::CreateDirectory($taskFolder) | Out-Null
$taskSource=[Drawing.Image]::FromFile(([IO.Path]::GetFullPath($SourcePath)))
try {
 foreach($taskMode in @('NearestNeighbor','Bilinear','Bicubic','HighQualityBilinear','HighQualityBicubic')) {
  foreach($taskOffset in @('Default','Half','None','HighQuality')) {
   $taskBitmap=New-Object Drawing.Bitmap 16,60
   $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
   try {
    $taskGraphics.InterpolationMode=[Enum]::Parse([Drawing.Drawing2D.InterpolationMode],$taskMode)
    $taskGraphics.PixelOffsetMode=[Enum]::Parse([Drawing.Drawing2D.PixelOffsetMode],$taskOffset)
    $taskGraphics.DrawImage($taskSource,(New-Object Drawing.Rectangle 0,0,16,60),0,0,128,480,[Drawing.GraphicsUnit]::Pixel)
    $taskBitmap.Save((Join-Path $taskFolder "$taskMode-$taskOffset.png"),[Drawing.Imaging.ImageFormat]::Png)
   } finally {$taskGraphics.Dispose();$taskBitmap.Dispose()}
  }
 }
} finally {$taskSource.Dispose()}
