param([string]$OutputPath='.private-svg-translucent-native.json')
# Native GDI+ playback of the retained, hash-bound native reference SVG metafile.
# No reference application automation, original-document edits, fonts or canvas screenshots.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$folder=Join-Path $PSScriptRoot '../tests/fixtures/svg-external-backdrop'
$bound=Get-Content -LiteralPath (Join-Path $folder 'native-colors.json') -Raw|ConvertFrom-Json
foreach($name in @('native.emf','capture.emf','control.docx','cases.json')) {
 if((Get-FileHash -LiteralPath (Join-Path $folder $name)).Hash.ToLowerInvariant() -ne $bound.hashes.$name){throw "Native reference hash mismatch: $name"}
}
$meta=[System.Drawing.Imaging.Metafile]::new((Join-Path $folder 'native.emf'))
$samples=@()
function Get-PremultPixel($bitmap,$x,$y) {
 $bits=$bitmap.LockBits([System.Drawing.Rectangle]::new($x,$y,1,1),[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
 try {
  $raw=New-Object byte[] 4
  [Runtime.InteropServices.Marshal]::Copy($bits.Scan0,$raw,0,4)
  return ,@([int]$raw[2],[int]$raw[1],[int]$raw[0],[int]$raw[3])
 }finally{$bitmap.UnlockBits($bits)}
}
try {
 foreach($alpha in @(0,25,76,128,254,255)) {
  foreach($background in @('FFFFFF','F2F2F2','808080','202020')) {
   $bitmap=[System.Drawing.Bitmap]::new(1200,900,[System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
   $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
   try {
    $color=[System.Drawing.ColorTranslator]::FromHtml('#'+$background)
    $graphics.Clear([System.Drawing.Color]::FromArgb($alpha,$color))
    $before=$bitmap.GetPixel(600,50)
    $beforePremult=Get-PremultPixel $bitmap 600 50
    $graphics.DrawImage($meta,[System.Drawing.Rectangle]::new(0,0,1200,900))
    $colors=@();$premultColors=@()
    for($row=0;$row -lt 9;$row++) {
     $pixel=$bitmap.GetPixel(600,$row*100+50)
     $colors+=,@([int]$pixel.R,[int]$pixel.G,[int]$pixel.B,[int]$pixel.A)
     $premultColors+=,(Get-PremultPixel $bitmap 600 ($row*100+50))
    }
    $samples+=@{background=$background;alpha=$alpha;before=@([int]$before.R,[int]$before.G,[int]$before.B,[int]$before.A);colors=$colors;beforePremult=$beforePremult;premultColors=$premultColors}
   }finally{$graphics.Dispose();$bitmap.Dispose()}
  }
 }
}finally{$meta.Dispose()}
@{nativeSha256=$bound.hashes.'native.emf';referenceBuild=$bound.referenceBuild;pixelFormat='Format32bppPArgb';recorderSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash.ToLowerInvariant();samples=$samples}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $OutputPath -Encoding utf8
