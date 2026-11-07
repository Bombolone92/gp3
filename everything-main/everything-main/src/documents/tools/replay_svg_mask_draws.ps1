param([string]$Report,[string]$Output)
# Isolated public GDI+ calls on owned retained PNGs. This is not metafile
# playback: clipping, background/fallback and outer device transforms are omitted.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
if(Test-Path -LiteralPath $Output){throw 'Output exists'}
$taskReport=Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
$taskRoot=(Get-Location).Path
$taskRows=@()
foreach($taskFixture in $taskReport.fixtures){
 $taskReferences=Get-Content -LiteralPath (Join-Path $taskRoot "tests/fixtures/$($taskFixture.fixture)/metafile-reference.json") -Raw | ConvertFrom-Json
 foreach($taskDraw in $taskFixture.draws){
  if($taskDraw.worldTransform[0] -ne 1 -or $taskDraw.worldTransform[1] -ne 0 -or $taskDraw.worldTransform[2] -ne 0 -or $taskDraw.worldTransform[3] -ne 1){throw 'Non-translation world transform'}
  if($taskDraw.pageTransform.unit -ne 2 -or $taskDraw.pageTransform.scale -ne 1 -or $taskDraw.interpolationMode -ne 7 -or $taskDraw.pixelOffsetMode -ne 4 -or $null -ne $taskDraw.imageAttributes){throw 'Unsupported captured drawing state'}
  if($taskDraw.sourceRect[0] -ne -0.5 -or $taskDraw.sourceRect[1] -ne -0.5){throw 'Unexpected source rectangle'}
  foreach($taskCoordinate in $taskDraw.worldTransform[4..5]){if($taskCoordinate -ne [Math]::Truncate($taskCoordinate)){throw 'Fractional translation cannot be omitted from this crop probe'}}
  $taskIndex=$taskDraw.index
  $taskPath=Join-Path $taskRoot "tests/fixtures/$($taskFixture.fixture)/$($taskReferences.images[$taskIndex].path)"
  if((Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskDraw.pngSha256){throw 'PNG hash mismatch'}
  $taskSource=[Drawing.Bitmap]::new($taskPath)
  try{
   if($taskDraw.sourceRect[2] -ne $taskSource.Width -or $taskDraw.sourceRect[3] -ne $taskSource.Height -or $taskDraw.points[0][0] -ne 0 -or $taskDraw.points[0][1] -ne 0 -or $taskDraw.points[1][0] -ne $taskSource.Width -or $taskDraw.points[1][1] -ne 0 -or $taskDraw.points[2][0] -ne 0 -or $taskDraw.points[2][1] -ne $taskSource.Height){throw 'Unsupported destination/source extents'}
   foreach($taskOffset in @(-0.5,0.0)){
    $taskBitmap=[Drawing.Bitmap]::new($taskSource.Width,$taskSource.Height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $taskGraphics=[Drawing.Graphics]::FromImage($taskBitmap)
    try{
     $taskGraphics.Clear([Drawing.Color]::Transparent)
     $taskGraphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
     $taskGraphics.PixelOffsetMode=[Drawing.Drawing2D.PixelOffsetMode]::Half
     # Older audit reports omit this state and retain their previous API path.
     if($null -ne $taskDraw.antiAliasMode){
      if($taskDraw.antiAliasMode.enabled -and $taskDraw.antiAliasMode.mode -eq 4){$taskGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias}
      elseif(-not $taskDraw.antiAliasMode.enabled){$taskGraphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::None}
      else{throw 'Unsupported anti-alias mode'}
     }
     $taskPoints=[Drawing.PointF[]]@([Drawing.PointF]::new(0,0),[Drawing.PointF]::new($taskSource.Width,0),[Drawing.PointF]::new(0,$taskSource.Height))
     $taskRect=[Drawing.RectangleF]::new($taskOffset,$taskOffset,$taskSource.Width,$taskSource.Height)
     $taskGraphics.DrawImage($taskSource,$taskPoints,$taskRect,[Drawing.GraphicsUnit]::Pixel)
     $taskDifferent=0;$taskTotal=0;$taskMax=0
     for($taskY=0;$taskY -lt $taskSource.Height;$taskY++){
      for($taskX=0;$taskX -lt $taskSource.Width;$taskX++){
       $taskError=[Math]::Abs([int]$taskBitmap.GetPixel($taskX,$taskY).A-[int]$taskSource.GetPixel($taskX,$taskY).A)
       if($taskError){$taskDifferent++};$taskTotal+=$taskError;$taskMax=[Math]::Max($taskMax,$taskError)
      }
     }
     $taskRows+=[pscustomobject]@{fixture=$taskFixture.fixture;index=$taskIndex;sourceOffset=$taskOffset;differentAlpha=$taskDifferent;totalAlphaError=$taskTotal;maximumAlphaError=$taskMax}
    }finally{$taskGraphics.Dispose();$taskBitmap.Dispose()}
   }
  }finally{$taskSource.Dispose()}
 }
}
[pscustomobject]@{scope='Isolated GDI+ alpha comparisons; not full native metafile/page playback';reportSha256=(Get-FileHash -LiteralPath $Report -Algorithm SHA256).Hash.ToLowerInvariant();powershellVersion=$PSVersionTable.PSVersion.ToString();drawingAssembly=[Drawing.Bitmap].Assembly.FullName;rows=$taskRows} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding utf8
$taskRows | Group-Object sourceOffset | ForEach-Object {Write-Output "offset=$($_.Name) cases=$($_.Count) exact=$(@($_.Group | Where-Object differentAlpha -eq 0).Count)"}
