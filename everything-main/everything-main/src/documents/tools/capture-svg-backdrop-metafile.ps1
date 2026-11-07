param([string]$Python='python', [string]$FixtureDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$folder=if ($FixtureDirectory) { (Resolve-Path -LiteralPath $FixtureDirectory).Path } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/svg-backdrop-compositing')) }
$source=Join-Path $folder 'control.docx';$capture=Join-Path $folder 'capture.emf';$native=Join-Path $folder 'native.emf'
$word=New-Object -ComObject Word.Application;$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong source document'}
 [byte[]]$bytes=$doc.InlineShapes.Item(1).Range.EnhMetaFileBits
 [IO.File]::WriteAllBytes($capture,$bytes)
 Write-Output ('Captured reference build '+$word.Build+' first inline range')
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
Push-Location $PSScriptRoot
try{& $Python -c 'from pathlib import Path; import sys; from extract_svg_viewport_metafiles import extract; Path(sys.argv[2]).write_bytes(extract(Path(sys.argv[1]).read_bytes()))' $capture $native;if($LASTEXITCODE -ne 0){throw 'Metafile extraction failed'}}finally{Pop-Location}
$meta=[System.Drawing.Imaging.Metafile]::new($native);$bitmap=[System.Drawing.Bitmap]::new(1200,900);$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try{$graphics.Clear([System.Drawing.Color]::White);$graphics.DrawImage($meta,[System.Drawing.Rectangle]::new(0,0,1200,900));$bitmap.Save((Join-Path $folder 'gdi.png'),[System.Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$bitmap.Dispose();$meta.Dispose()}
