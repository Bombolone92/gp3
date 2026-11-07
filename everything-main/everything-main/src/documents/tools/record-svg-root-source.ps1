param([Parameter(Mandatory)][string]$OutputRoot)
# Owned nested metafiles only. No reference application instance, UI, font or corpus data access.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$svgOutput=[IO.Path]::GetFullPath($OutputRoot)
if(Test-Path -LiteralPath $svgOutput){throw 'Use a fresh capture directory'}
[void][IO.Directory]::CreateDirectory($svgOutput)
$svgRecords=@()
foreach($svgName in @('svg-backdrop-compositing','svg-external-backdrop')) {
 $svgFolder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../tests/fixtures/$svgName"))
 $svgReference=Get-Content -LiteralPath (Join-Path $svgFolder 'native-colors.json') -Raw | ConvertFrom-Json
 $svgPath=Join-Path $svgFolder 'native.emf'
 $svgSha=(Get-FileHash -LiteralPath $svgPath).Hash.ToLowerInvariant()
 $svgExpected=if($svgName -eq 'svg-external-backdrop'){$svgReference.hashes.'native.emf'}else{$svgReference.nativeSha256}
 if($svgSha -ne $svgExpected){throw 'Changed owned native metafile'}
 $svgTargetFolder=Join-Path $svgOutput $svgName
 [void][IO.Directory]::CreateDirectory($svgTargetFolder)
 $svgMeta=[Drawing.Imaging.Metafile]::new($svgPath)
 try {
  $svgUnit=[Drawing.GraphicsUnit]::Pixel
  $svgBounds=$svgMeta.GetBounds([ref]$svgUnit)
  $svgBackgrounds=if($svgName -eq 'svg-external-backdrop'){@('FFFFFF','F2F2F2','808080','202020')}else{@('FFFFFF')}
  foreach($svgBackground in $svgBackgrounds) {
   $svgBitmap=[Drawing.Bitmap]::new(1200,900)
   $svgGraphics=[Drawing.Graphics]::FromImage($svgBitmap)
   try {
    $svgGraphics.Clear([Drawing.ColorTranslator]::FromHtml('#'+$svgBackground))
    $svgGraphics.DrawImage($svgMeta,[Drawing.RectangleF]::new(0,0,1200,900),[Drawing.RectangleF]::new(0,0,120,90),[Drawing.GraphicsUnit]::Pixel)
    $svgTarget=Join-Path $svgTargetFolder "$svgBackground.png"
    $svgBitmap.Save($svgTarget,[Drawing.Imaging.ImageFormat]::Png)
    $svgRecords+=@{fixture=$svgName;background=$svgBackground;nativeSha256=$svgSha;pngSha256=(Get-FileHash -LiteralPath $svgTarget).Hash.ToLowerInvariant();sourceRect=@(0,0,120,90);destinationRect=@(0,0,1200,900);defaultSourceBounds=@([double]$svgBounds.X,[double]$svgBounds.Y,[double]$svgBounds.Width,[double]$svgBounds.Height);scope='Owned nested-metafile playback with explicit nominal pixel-source rectangle; correspondence to authored SVG coordinates unproven. Not default frame stretch, native screen or final document placement'}
   }finally{$svgGraphics.Dispose();$svgBitmap.Dispose()}
  }
 }finally{$svgMeta.Dispose()}
}
$svgManifest=$svgRecords | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $svgOutput 'manifest.json'),$svgManifest,[Text.UTF8Encoding]::new($false))
Write-Output "Recorded $($svgRecords.Count) hash-bound root-viewport diagnostic bitmaps."
