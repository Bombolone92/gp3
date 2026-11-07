param([Parameter(Mandatory=$true)][string]$SourceFullPath,[Parameter(Mandatory=$true)][string]$OutputDirectory,[int]$ExpectedTables=36)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceFullPath).Path
$destination=(Resolve-Path -LiteralPath $OutputDirectory).Path
$word=New-Object -ComObject Word.Application
$word.Visible=$false;$word.DisplayAlerts=0;$doc=$null
try {
 $doc=$word.Documents.Open($source,$false,$true)
 if($ExpectedTables -lt 1 -or $doc.FullName -ne $source -or $doc.Tables.Count -ne $ExpectedTables){throw 'Unexpected source or table count'}
 Write-Output ('Opened read-only with reference build '+$word.Build)
 $doc.Repaginate()
 for($i=1;$i -le $ExpectedTables;$i++){
  [IO.File]::WriteAllBytes((Join-Path $destination ('native-table-'+$i+'.emf')),[byte[]]$doc.Tables.Item($i).Range.EnhMetaFileBits)
  Write-Output ('Captured table '+$i)
 }
 @{referenceBuild=$word.Build;tables=$doc.Tables.Count;readOnly=$doc.ReadOnly} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination 'capture.json')
}finally{try{if($doc){$doc.Close([ref]0)}}finally{$word.Quit([ref]0)}}
