param([string]$FixtureDirectory,[int]$FirstPage=13,[int]$LastPage=20)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$folder=if($FixtureDirectory){(Resolve-Path -LiteralPath $FixtureDirectory).Path}else{[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../tests/fixtures/shadow-raster-sampling'))}
$source=Join-Path $folder 'source.docx'
$word=New-Object -ComObject Word.Application
$word.Visible=$false; $word.DisplayAlerts=0; $doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'Wrong source'}
 $doc.Repaginate()
 $pageCount=$doc.ComputeStatistics(2)
 if($FirstPage -lt 1 -or $LastPage -lt $FirstPage -or $LastPage -gt $pageCount){throw 'Invalid page range'}
 foreach($index in $FirstPage..$LastPage) {
  $start=$doc.GoTo(1,1,$index).Start
  $end=if($index -eq $pageCount){$doc.Content.End}else{$doc.GoTo(1,1,($index+1)).Start}
  $range=$doc.Range($start,($end-1)); $path=Join-Path $folder ('shadow-color-'+$index+'.emf')
  [IO.File]::WriteAllBytes($path,[byte[]]$range.EnhMetaFileBits)
  $meta=[System.Drawing.Imaging.Metafile]::new($path)
  $bitmap=[System.Drawing.Bitmap]::new($meta.Width,$meta.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {
   $graphics.Clear([System.Drawing.Color]::White)
   $graphics.DrawImage($meta,[System.Drawing.Rectangle]::new(0,0,$bitmap.Width,$bitmap.Height))
   $bitmap.Save((Join-Path $folder ('shadow-color-'+$index+'.png')),[System.Drawing.Imaging.ImageFormat]::Png)
  }finally{$graphics.Dispose();$bitmap.Dispose();$meta.Dispose()}
 }
 Write-Output ('Captured '+($LastPage-$FirstPage+1)+' page ranges with reference build '+$word.Build)
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
