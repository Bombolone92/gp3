param(
 [Parameter(Mandatory)][string]$Source,
 [Parameter(Mandatory)][string]$Cases,
 [Parameter(Mandatory)][string]$OutputRoot,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256
)
# Observe an exact already-opened visible textless control. No selection, source
# edits, saves, explicit repagination, font-program reads, document opens or application quits.
$ErrorActionPreference='Stop'
$rowSource=(Resolve-Path -LiteralPath $Source).Path
$rowCases=(Resolve-Path -LiteralPath $Cases).Path
$rowOutput=[IO.Path]::GetFullPath($OutputRoot)
$expected=$ExpectedSha256.ToLowerInvariant()
function SourceHash {
 $stream=[IO.File]::Open($rowSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
 $algorithm=[Security.Cryptography.SHA256]::Create()
 try {([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
 finally {$algorithm.Dispose();$stream.Dispose()}
}
if((SourceHash) -ne $expected){throw 'Wrong source bytes'}
$caseList=Get-Content -LiteralPath $rowCases -Raw | ConvertFrom-Json
if(-not $caseList.Count){throw 'No row cases'}
if(Test-Path -LiteralPath $rowOutput){throw 'Use a fresh capture directory'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$sourceStream=[IO.File]::Open($rowSource,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
$package=[IO.Compression.ZipArchive]::new($sourceStream,[IO.Compression.ZipArchiveMode]::Read,$true)
try {
 $part=$package.GetEntry('word/document.xml')
 if(-not $part){throw 'Missing document part'}
 $reader=[IO.StreamReader]::new($part.Open())
 try {$xml=[xml]$reader.ReadToEnd()} finally {$reader.Dispose()}
 $ns=[Xml.XmlNamespaceManager]::new($xml.NameTable)
 $ns.AddNamespace('w','http://schemas.openxmlformats.org/wordprocessingml/2006/main')
 if($xml.SelectNodes('//w:t',$ns).Count){throw 'Use a textless owned control'}
 $tables=$xml.SelectNodes('//w:tbl',$ns)
 if($tables.Count -ne $caseList.Count){throw 'Expected one table per case'}
 for($i=0;$i -lt $caseList.Count;$i++){
  $rows=$tables[$i].SelectNodes('w:tr',$ns)
  if($rows.Count -ne 1 -or $rows[0].SelectNodes('w:tc',$ns).Count -ne 1){throw 'Expected a single-row single-cell control'}
  $height=$rows[0].SelectSingleNode('w:trPr/w:trHeight',$ns)
  if($height.GetAttribute('hRule',$ns.LookupNamespace('w')) -ne 'exact' -or [int]$height.GetAttribute('val',$ns.LookupNamespace('w')) -ne $caseList[$i].heightTwips){throw 'Wrong authored row dimensions'}
 }
} finally {$package.Dispose();$sourceStream.Dispose()}
. (Join-Path $PSScriptRoot 'find_owned_native_document.ps1')
$doc=Find-OwnedWordDocument $rowSource
try {
 if(-not $doc.Saved -or -not $doc.Application.Visible -or -not $doc.ActiveWindow.Visible){throw 'Control must be visible and Saved'}
 if($doc.Tables.Count -ne $caseList.Count){throw 'Wrong native table count'}
 $viewBefore=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 $observations=@()
 for($i=1;$i -le $caseList.Count;$i++){
  $table=$doc.Tables.Item($i)
  $row=$table.Rows.Item(1)
  $cell=$table.Cell(1,1)
  $range=$cell.Range
  try {
   if([int]$range.Information(3) -ne $i){throw "Wrong native case page $i"}
   # Information is the cell text range position, not a painted border box.
   # The reference application can return -1 when the requested position is unavailable; retain it.
   $observations+=@{index=$i-1;page=$i;rowHeightPt=[double]$row.Height;
    rowHeightRule=[int]$row.HeightRule;cellHeightPt=[double]$cell.Height;
    rangePageXPt=[double]$range.Information(5);rangePageYPt=[double]$range.Information(6);
    rangeTextBoundaryXPt=[double]$range.Information(7);rangeTextBoundaryYPt=[double]$range.Information(8)}
  } finally {
   foreach($value in @($range,$cell,$row,$table)){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($value)}
  }
  if($i % 20 -eq 0){Write-Output "Observed $i row metadata records"}
 }
 if((SourceHash) -ne $expected -or -not $doc.Saved){throw 'Source changed'}
 $viewAfter=@{type=[int]$doc.ActiveWindow.View.Type;zoomPercent=[int]$doc.ActiveWindow.View.Zoom.Percentage}
 if($viewBefore.type -ne $viewAfter.type -or $viewBefore.zoomPercent -ne $viewAfter.zoomPercent){throw 'View changed during observation'}
 [void][IO.Directory]::CreateDirectory($rowOutput)
 @{sourceSha256=$expected;casesSha256=(Get-FileHash -LiteralPath $rowCases).Hash.ToLowerInvariant();
  sourceUnchanged=$true;savedBefore=$true;savedAfter=$doc.Saved;referenceBuild=$doc.Application.Build;
  viewBefore=$viewBefore;viewAfter=$viewAfter;
  scope='Native reference row/cell height properties and cell text-range Information positions; not painted border bounds, screen glyphs or PDF coordinates';
  method='Read-only metadata observation of the exact already-opened visible owned source; no source save or UI changes';rows=$observations} |
  ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $rowOutput 'native-row-layout.json') -Encoding utf8
 Write-Output "Observed $($observations.Count) native row metadata records; source unchanged"
} finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
