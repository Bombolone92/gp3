param([Parameter(Mandatory=$true)][string]$Report,[Parameter(Mandatory=$true)][string]$Output)
# Complete playback of pinned owned EMF+ controls through Windows GDI+.
# This does not capture the reference application, a printer, or the original corpus document.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
if(Test-Path -LiteralPath $Output){throw 'Output exists'}
$taskAudit=Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
$taskNames=@('svg-mask-opacity','svg-mask-opacity-expanded','svg-mask-opaque','svg-mask-luminance-coefficients','svg-mask-quantization','svg-mask-quantization-boundary','svg-mask-composition','svg-mask-nested','svg-image-masks','svg-image-masks-scaled','svg-image-masks-step','svg-mask-edges')
if($taskAudit.fixtures.Count -ne 12){throw 'Expected twelve audited fixture sets'}
if(@($taskAudit.fixtures.fixture | Sort-Object -Unique).Count -ne 12){throw 'Duplicate fixture set'}
[IO.Directory]::CreateDirectory($Output)|Out-Null
$taskRows=@();$taskHeaders=@()
foreach($taskEntry in $taskAudit.fixtures){
 $taskFixture=$taskEntry.fixture
 if($taskFixture -notin $taskNames){throw 'Unknown fixture'}
 $taskFolder=(Resolve-Path "tests/fixtures/$taskFixture").Path
 $taskReference=Get-Content -LiteralPath (Join-Path $taskFolder 'metafile-reference.json') -Raw | ConvertFrom-Json
 $taskNativePath=Join-Path $taskFolder 'native.emf'
 if((Get-FileHash -LiteralPath $taskNativePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskEntry.nativeSha256 -or $taskEntry.nativeSha256 -ne $taskReference.nativeSha256){throw 'Native hash mismatch'}
 $taskNative=[Drawing.Imaging.Metafile]::new($taskNativePath)
 try{
  if($taskNative.GetMetafileHeader().Type -ne [Drawing.Imaging.MetafileType]::EmfPlusOnly){throw 'Unexpected metafile type'}
  $taskUnit=[Drawing.GraphicsUnit]::Pixel
  $taskBounds=$taskNative.GetBounds([ref]$taskUnit)
  if($taskBounds.Width -gt 130 -or $taskBounds.Height -gt 90 -or $taskBounds.Width -le 0 -or $taskBounds.Height -le 0){throw 'Unexpected bounds'}
  $taskHeaders+=[pscustomobject]@{fixture=$taskFixture;nativeSha256=$taskEntry.nativeSha256;bounds=@($taskBounds.X,$taskBounds.Y,$taskBounds.Width,$taskBounds.Height);dpiX=$taskNative.HorizontalResolution;dpiY=$taskNative.VerticalResolution}
  foreach($taskMode in @('bounds-native-dpi','bounds-96-dpi','unscaled-native-dpi')){
   $taskBitmap=[Drawing.Bitmap]::new(140,100,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
   if($taskMode -ne 'bounds-96-dpi'){$taskBitmap.SetResolution($taskNative.HorizontalResolution,$taskNative.VerticalResolution)}
   $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
   try{
    $taskGraphics.PageUnit=[Drawing.GraphicsUnit]::Pixel
    $taskGraphics.Clear([Drawing.Color]::Transparent)
    $taskGraphics.TranslateTransform(8,8)
    if($taskMode -eq 'unscaled-native-dpi'){$taskGraphics.DrawImageUnscaled($taskNative,0,0)}
    else{
     $taskPoints=[Drawing.PointF[]]@([Drawing.PointF]::new($taskBounds.X,$taskBounds.Y),[Drawing.PointF]::new($taskBounds.Right,$taskBounds.Y),[Drawing.PointF]::new($taskBounds.X,$taskBounds.Bottom))
     $taskGraphics.DrawImage($taskNative,$taskPoints,$taskBounds,[Drawing.GraphicsUnit]::Pixel)
    }
    $taskBitmap.Save((Join-Path $Output "$taskFixture-$taskMode.png"),[Drawing.Imaging.ImageFormat]::Png)
    foreach($taskDraw in $taskEntry.draws){
     if($taskDraw.worldTransform[0] -ne 1 -or $taskDraw.worldTransform[1] -ne 0 -or $taskDraw.worldTransform[2] -ne 0 -or $taskDraw.worldTransform[3] -ne 1){throw 'Unexpected transform for pixel-window comparison'}
     foreach($taskCoordinate in $taskDraw.worldTransform[4..5]){if($taskCoordinate -ne [Math]::Truncate($taskCoordinate)){throw 'Fractional pixel window'}}
     $taskPngPath=Join-Path $taskFolder $taskReference.images[$taskDraw.index].path
     if((Get-FileHash -LiteralPath $taskPngPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDraw.pngSha256){throw 'PNG hash mismatch'}
     $taskSource=[Drawing.Bitmap]::new($taskPngPath)
     try{
      $taskDiff=0;$taskTotal=0;$taskMax=0
      for($taskY=0;$taskY -lt $taskSource.Height;$taskY++){for($taskX=0;$taskX -lt $taskSource.Width;$taskX++){
       $taskError=[Math]::Abs([int]$taskBitmap.GetPixel((8+$taskDraw.worldTransform[4]+$taskX),(8+$taskDraw.worldTransform[5]+$taskY)).A-[int]$taskSource.GetPixel($taskX,$taskY).A)
       if($taskError){$taskDiff++};$taskTotal+=$taskError;$taskMax=[Math]::Max($taskMax,$taskError)
      }}
      $taskRows+=[pscustomobject]@{fixture=$taskFixture;mode=$taskMode;index=$taskDraw.index;differentAlpha=$taskDiff;totalAlphaError=$taskTotal;maximumAlphaError=$taskMax}
     }finally{$taskSource.Dispose()}
    }
   }finally{$taskGraphics.Dispose();$taskBitmap.Dispose()}
  }
 }finally{$taskNative.Dispose()}
}
[pscustomobject]@{scope='Complete owned GDI+ metafile playback; not a fresh reference page capture';reportSha256=(Get-FileHash -LiteralPath $Report -Algorithm SHA256).Hash.ToLowerInvariant();powershellVersion=$PSVersionTable.PSVersion.ToString();drawingAssembly=[Drawing.Bitmap].Assembly.FullName;headers=$taskHeaders;rows=$taskRows} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Output 'replay.json') -Encoding utf8
Write-Output "Completed $($taskHeaders.Count) owned metafiles / $($taskRows.Count) image-window comparisons"
