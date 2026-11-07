param([Parameter(Mandatory=$true)][string]$InputFolder)
# Native diagnostic only. Does not participate in browser rendering.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$taskFolder=[IO.Path]::GetFullPath($InputFolder)
foreach($taskFile in Get-ChildItem -LiteralPath $taskFolder -Filter '*-input.png') {
    $taskSource=[Drawing.Image]::FromFile($taskFile.FullName)
    $taskBitmap=[Drawing.Bitmap]::new(16,60)
    $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
    $taskAttributes=[Drawing.Imaging.ImageAttributes]::new()
    try {
        $taskAttributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $taskGraphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $taskGraphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::Half
        $taskGraphics.DrawImage($taskSource,[Drawing.Rectangle]::new(0,0,16,60),0,0,$taskSource.Width,$taskSource.Height,[Drawing.GraphicsUnit]::Pixel,$taskAttributes)
        $taskOutput=Join-Path $taskFolder ($taskFile.BaseName.Replace('-input','-output')+'.png')
        $taskBitmap.Save($taskOutput,[Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $taskAttributes.Dispose();$taskGraphics.Dispose();$taskBitmap.Dispose();$taskSource.Dispose()
    }
}
