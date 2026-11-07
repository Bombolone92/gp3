$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$folder=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/svg-external-backdrop'))
$meta=[System.Drawing.Imaging.Metafile]::new((Join-Path $folder 'native.emf'))
$samples=@()
try {
 foreach ($background in @('FFFFFF','F2F2F2','808080','202020')) {
  $bitmap=[System.Drawing.Bitmap]::new(1200,900)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {
   $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#'+$background))
   $graphics.DrawImage($meta,[System.Drawing.Rectangle]::new(0,0,1200,900))
   $colors=@()
   for ($row=0;$row -lt 9;$row++) {
    $pixel=$bitmap.GetPixel(600,$row*100+50)
    $colors+=,@([int]$pixel.R,[int]$pixel.G,[int]$pixel.B)
   }
   $samples+=@{background=$background;colors=$colors}
   $bitmap.Save((Join-Path $folder ($background+'.png')),[System.Drawing.Imaging.ImageFormat]::Png)
  } finally {$graphics.Dispose();$bitmap.Dispose()}
 }
} finally {$meta.Dispose()}
$hashes=@{}
foreach ($name in @('control.docx','cases.json','native.emf','capture.emf','FFFFFF.png','F2F2F2.png','808080.png','202020.png')) {
 $hashes[$name]=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $folder $name)).Hash.ToLowerInvariant()
}
@{referenceBuild='16.0.20326';hashes=$hashes;samples=$samples} | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $folder 'native-colors.json')
