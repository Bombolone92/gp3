param([Parameter(Mandatory=$true)][string]$SourceFullPath,[Parameter(Mandatory=$true)][string]$OutputPrefix)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$prefix=[IO.Path]::GetFullPath($OutputPrefix)
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source){throw 'The reference application opened a different document'}
 Write-Output ('Confirmed open in the reference application: '+$doc.FullName)
 $doc.Repaginate();$doc.Bookmarks.ShowHidden=$true
 $results=@()
 foreach($mark in $doc.Bookmarks){
  $range=$mark.Range
  $mark.Select()
  $cells=@()
  $selectedCellCount=$word.Selection.Cells.Count
  for($index=1;$index -le $selectedCellCount;$index++){$cell=$word.Selection.Cells.Item($index);$cells += [pscustomobject]@{row=$cell.RowIndex;column=$cell.ColumnIndex;text=$cell.Range.Text}}
  $results += [pscustomobject]@{name=$mark.Name;column=$mark.Column;start=$range.Start;end=$range.End;text=$range.Text;rangeCellCount=$range.Cells.Count;selectionType=$word.Selection.Type;selectedCellCount=$selectedCellCount;selectedText=$word.Selection.Text;selectedCells=$cells}
 }
 $doc.ExportAsFixedFormat($prefix+'.pdf',17)
 $record=[pscustomobject]@{referenceVersion=$word.Version;referenceBuild=$word.Build;pages=$doc.ComputeStatistics(2);sourceSha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower();pdfSha256=(Get-FileHash -LiteralPath ($prefix+'.pdf') -Algorithm SHA256).Hash.ToLower();bookmarks=$results}
 $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($prefix+'-ranges.json') -Encoding UTF8
 Write-Output ('Pages: '+$record.pages+'; bookmarks: '+$results.Count)
}finally{if($null -ne $doc){$doc.Close([ref]0)};$word.Quit([ref]0)}
