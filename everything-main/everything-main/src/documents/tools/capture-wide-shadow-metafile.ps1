param([string]$FixtureDirectory, [switch]$RenderExisting)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$folder=if($FixtureDirectory){(Resolve-Path -LiteralPath $FixtureDirectory).Path}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/scaled-picture-shadows'))}
$out=Join-Path $folder 'metafile'; New-Item -ItemType Directory -Force -Path $out | Out-Null
if(-not $RenderExisting) {
$source=Join-Path $folder 'source.docx'; $word=New-Object -ComObject Word.Application
$word.Visible=$false; $word.DisplayAlerts=0; $doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 $doc.Repaginate()
 if($doc.ComputeStatistics(2) -ne 14){throw 'Expected fourteen control pages'}
 $range=$doc.Range($doc.GoTo(1,1,14).Start,($doc.Content.End-1))
 [byte[]]$bytes=$range.EnhMetaFileBits
 [IO.File]::WriteAllBytes((Join-Path $out 'capture.emf'),$bytes)
 Write-Output ('Captured exact source in reference build '+$word.Build)
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
}
[byte[]]$bytes=[IO.File]::ReadAllBytes((Join-Path $out 'capture.emf'))
$meta=[System.Drawing.Imaging.Metafile]::new((Join-Path $out 'capture.emf'))
try {$width=$meta.Width; $height=$meta.Height; $bounds=@(0,1,2,3 | ForEach-Object {[BitConverter]::ToInt32($bytes,(8+4*$_))})}finally{$meta.Dispose()}
$oldBottom=[BitConverter]::ToInt32($bytes,36)
$newBottom=[int][Math]::Ceiling($oldBottom*($bounds[3]+128)/$height)
$factor=$newBottom/$oldBottom
# Expand only the viewport, not any drawing/image/transform record. Preserve
# the original scale exactly by multiplying the destination height as well.
[BitConverter]::GetBytes($newBottom).CopyTo($bytes,36)
[IO.File]::WriteAllBytes((Join-Path $out 'expanded.emf'),$bytes)
foreach($item in @(@('capture',1),@('expanded',$factor))) {
 $meta=[System.Drawing.Imaging.Metafile]::new((Join-Path $out ($item[0]+'.emf')))
 $bitmap=[System.Drawing.Bitmap]::new($width,([int][Math]::Ceiling($height*$item[1]))); $g=[System.Drawing.Graphics]::FromImage($bitmap)
 try {
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($meta,[System.Drawing.RectangleF]::new(0,0,$width,[single]($height*$item[1])))
  $bitmap.Save((Join-Path $out ($item[0]+'.png')),[System.Drawing.Imaging.ImageFormat]::Png)
 }finally{$g.Dispose();$bitmap.Dispose();$meta.Dispose()}
}
@{width=$width;height=$height;factor=$factor;bounds=$bounds} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'viewport.json')
