param(
  [Parameter(Mandatory=$true)][string]$SourceFullPath,
  [Parameter(Mandatory=$true)][string]$OutputJson,
  [string]$OutputDocx,
  [int[]]$Zooms=@(75,100,125,150,200)
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$destination=[IO.Path]::GetFullPath($OutputJson)
$normalized=if($OutputDocx){[IO.Path]::GetFullPath($OutputDocx)}else{$null}
if($destination -eq $source -or $normalized -eq $source){throw 'Outputs must not overwrite the source.'}
if($normalized -and $normalized -eq $destination){throw 'JSON and DOCX outputs must have different paths.'}
if(!$Zooms.Count -or @($Zooms|Where-Object {$_ -lt 10 -or $_ -gt 500}).Count){throw 'Choose zoom percentages from 10 to 500.'}
$before=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()
$word=New-Object -ComObject Word.Application
$word.Visible=$false
$word.DisplayAlerts=0
$document=$null
try {
  $document=$word.Documents.Open($source,$false,$true)
  if($document.FullName -ne $source){throw 'The reference application opened another source.'}
  $document.Repaginate()
  $observations=@()
  foreach($zoom in $Zooms){
    $document.ActiveWindow.View.Zoom.Percentage=$zoom
    $rows=@()
    for($i=1;$i -le $document.Tables.Count;$i++){
      $table=$document.Tables.Item($i)
      if($table.Rows.Count -ne 1 -or $table.Columns.Count -ne 1){throw 'This diagnostic requires single-cell tables.'}
      if(!$table.Rows.WrapAroundText){throw 'This diagnostic requires floating tables.'}
      $cell=$table.Cell(1,1)
      $range=$cell.Range.Duplicate
      $range.Collapse(1)
      $x=[double]$range.Information(5);$y=[double]$range.Information(6)
      if($x -lt 0 -or $y -lt 0){throw 'The reference application did not return usable range coordinates.'}
      $rows+= [ordered]@{
        id=$i;rangeStart=$range.Start;x=$x;y=$y
        rowHeight=[double]$table.Rows.Item(1).Height;cellWidth=[double]$cell.Width
        horizontalPosition=[double]$table.Rows.HorizontalPosition
        verticalPosition=[double]$table.Rows.VerticalPosition
        padding=@([double]$cell.LeftPadding,[double]$cell.TopPadding,[double]$cell.RightPadding,[double]$cell.BottomPadding)
        lineWidths=@([int]$cell.Borders.Item(-1).LineWidth,[int]$cell.Borders.Item(-2).LineWidth,[int]$cell.Borders.Item(-3).LineWidth,[int]$cell.Borders.Item(-4).LineWidth)
      }
    }
    $observations+= [ordered]@{zoom=$document.ActiveWindow.View.Zoom.Percentage;tables=$rows}
  }
  if($normalized){$document.SaveAs2($normalized,16)}
  if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $before){throw 'The source changed during observation.'}
  [ordered]@{sourceSha256=$before;version=$word.Version;build=$word.Build;observations=$observations}|
    ConvertTo-Json -Depth 8|Set-Content -LiteralPath $destination -Encoding utf8
  Write-Output "Recorded $($observations.Count) zooms and $($document.Tables.Count) tables; original source unchanged."
} finally {
  try{if($null -ne $document){$document.Close([ref]0)}}finally{$word.Quit([ref]0)}
}
