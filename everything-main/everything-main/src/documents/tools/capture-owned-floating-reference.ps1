param([Parameter(Mandatory=$true)][string]$SourcePath,[Parameter(Mandatory=$true)][string]$ManifestPath,[Parameter(Mandatory=$true)][string]$OutputDirectory)
# Run with Windows PowerShell (powershell.exe), after the document opener confirms
# this exact source. Active-object lookup deliberately never activates a file.
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($SourcePath)
$root=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $root){throw 'Output already exists'}
$expected=(Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json).sourceSha256
function SourceHash {$stream=[IO.File]::Open($source,'Open','Read','ReadWrite');try{(Get-FileHash -InputStream $stream).Hash.ToLowerInvariant()}finally{$stream.Dispose()}}
if((SourceHash) -ne $expected){throw 'Wrong source'}
. ./tools/export_owned_native_pdf.ps1
$app=$null;$doc=$null
try {
 $app=[Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
 foreach($candidate in $app.Documents) {
  if([string]$candidate.FullName -eq $source){$doc=$candidate;break}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($candidate)
 }
 if($null -eq $doc){throw 'Run the document opener first; the exact source is not already open'}
 if($doc.FullName -ne $source -or -not $doc.Saved -or -not $doc.Application.Visible){throw 'Wrong clean visible source'}
 $view=[int]$doc.ActiveWindow.View.Type;$zoom=[int]$doc.ActiveWindow.View.Zoom.Percentage
 $start=[int]$doc.ActiveWindow.Selection.Start;$end=[int]$doc.ActiveWindow.Selection.End
 $pages=$doc.ActiveWindow.Panes.Item(1).Pages
 [void][IO.Directory]::CreateDirectory($root)
 $captures=@();for($i=1;$i -le $pages.Count;$i++){ $emf=Join-Path $root "page-$i.emf";[IO.File]::WriteAllBytes($emf,[byte[]]$pages.Item($i).EnhMetaFileBits);$captures+=@{page=$i;sha256=(Get-FileHash -LiteralPath $emf).Hash.ToLowerInvariant();widthPt=$pages.Item($i).Width;heightPt=$pages.Item($i).Height} }
 $pdf=Join-Path $root 'native.pdf';[OwnedWordPdfExport]::Export($doc,$pdf)
 if((SourceHash) -ne $expected -or -not $doc.Saved -or [int]$doc.ActiveWindow.View.Type -ne $view -or [int]$doc.ActiveWindow.View.Zoom.Percentage -ne $zoom -or [int]$doc.ActiveWindow.Selection.Start -ne $start -or [int]$doc.ActiveWindow.Selection.End -ne $end){throw 'Native/source state changed'}
 @{sourceSha256=$expected;sourceUnchanged=$true;visible=$true;savedBefore=$true;savedAfter=$true;viewUnchanged=$true;zoomUnchanged=$true;selectionUnchanged=$true;referenceBuild=[string]$doc.Application.Build;captures=$captures;paragraphs=$doc.Paragraphs.Count;pdfSha256=(Get-FileHash -LiteralPath $pdf).Hash.ToLowerInvariant();method='Guarded compiled native export on exact already-opened manually authored control; page metafiles and PDF, no font programs decoded'} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'capture.json') -Encoding utf8
 Write-Output "Captured $($pages.Count) native pages; source and native state unchanged"
}finally{
 if($null -ne $doc){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
 if($null -ne $app){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)}
}
