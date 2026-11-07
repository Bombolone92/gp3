param([Parameter(Mandatory=$true)][string]$SourceFullPath,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$destination=(Resolve-Path -LiteralPath $OutputDirectory).Path
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($doc.FullName -ne $source -or $doc.Tables.Count -ne 8){throw 'Expected the original eight-table phase control'}
 $doc.Repaginate()
 for($i=1;$i -le 8;$i++){
  $table=$doc.Tables.Item($i)
  $from=if($i -eq 1){0}else{$doc.Tables.Item($i-1).Range.End}
  [IO.File]::WriteAllBytes((Join-Path $destination ('native-table-'+$i+'.emf')),[byte[]]$table.Range.EnhMetaFileBits)
  [IO.File]::WriteAllBytes((Join-Path $destination ('native-page-'+$i+'.emf')),[byte[]]$doc.Range($from,$table.Range.End).EnhMetaFileBits)
 }
 Write-Output ('Captured eight paired ranges with reference build '+$word.Build)
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
